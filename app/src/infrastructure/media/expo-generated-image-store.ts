import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import type { GeneratedImageAttachment } from "@/domain/models";
import type {
  GeneratedImageStorageInput,
  GeneratedImageStoragePort,
} from "@/infrastructure/model-config/openai-compatible-image-generation";

const EXTENSION_BY_MIME: Readonly<
  Record<GeneratedImageAttachment["mimeType"], string>
> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_GENERATED_IMAGE_STORAGE_BYTES = 256 * 1024 * 1024;
const MANAGED_IMAGE_PATH =
  /^(?:project|conversation)-[A-Za-z0-9._-]{1,120}\/generated-image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/iu;

function safeScopeId(value: string) {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
  return normalized || "unscoped";
}

export class ExpoGeneratedImageStore implements GeneratedImageStoragePort {
  readonly #root = new Directory(Paths.document, "boltpocket", "generated-images");
  #managedBytes: number | null = null;

  #currentManagedBytes() {
    this.#managedBytes ??= managedBytes(this.#root);
    return this.#managedBytes;
  }

  async save(input: GeneratedImageStorageInput) {
    if (
      this.#currentManagedBytes() + input.byteLength >
      MAX_GENERATED_IMAGE_STORAGE_BYTES
    ) {
      throw new Error("生成图片存储空间已达上限，请删除不再需要的对话。");
    }
    const scope = new Directory(
      this.#root,
      input.projectId
        ? `project-${safeScopeId(input.projectId)}`
        : `conversation-${safeScopeId(input.conversationId)}`,
    );
    scope.create({ idempotent: true, intermediates: true });
    const id = `generated-image-${randomUUID()}`;
    const name = `${id}.${EXTENSION_BY_MIME[input.mimeType]}`;
    const file = new File(scope, name);
    try {
      file.create();
      file.write(input.base64, { encoding: "base64" });
      if (file.size !== input.byteLength) {
        throw new Error("图片保存后校验失败。");
      }
      this.#managedBytes = this.#currentManagedBytes() + input.byteLength;
      return {
        id,
        kind: "generated-image" as const,
        uri: file.uri,
        name,
        mimeType: input.mimeType,
        sizeBytes: input.byteLength,
        providerName: input.providerName,
        modelId: input.modelId,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    }
  }

  async delete(attachments: readonly GeneratedImageAttachment[]) {
    const rootUri = `${this.#root.uri.replace(/\/+$/u, "")}/`;
    for (const attachment of attachments) {
      const relativePath = attachment.uri.startsWith(rootUri)
        ? attachment.uri.slice(rootUri.length)
        : "";
      if (!MANAGED_IMAGE_PATH.test(relativePath)) {
        throw new Error("生成图片不属于 App 管理目录，无法安全删除。");
      }
      const file = new File(attachment.uri);
      if (file.exists) {
        const size = file.size;
        file.delete();
        if (this.#managedBytes !== null) {
          this.#managedBytes = Math.max(0, this.#managedBytes - size);
        }
      }
    }
  }
}

function managedBytes(root: Directory) {
  if (!root.exists) return 0;
  let total = 0;
  for (const scope of root.list()) {
    if (scope instanceof File) total += scope.size;
    else {
      for (const item of scope.list()) {
        if (item instanceof File) total += item.size;
      }
    }
  }
  return total;
}

export const generatedImageStore = new ExpoGeneratedImageStore();
