import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import type { GeneratedVideoAttachment } from "@/domain/models";
import {
  MAX_GENERATED_VIDEO_BYTES,
  type GeneratedVideoStorageInput,
  type GeneratedVideoStoragePort,
} from "@/infrastructure/model-config/openai-compatible-video-generation";

function safeScopeId(value: string) {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
  return normalized || "unscoped";
}

function isMp4Header(bytes: Uint8Array) {
  return (
    bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
  );
}
const MAX_GENERATED_VIDEO_STORAGE_BYTES = 768 * 1024 * 1024;
const MANAGED_VIDEO_PATH =
  /^(?:project|conversation)-[A-Za-z0-9._-]{1,120}\/generated-video-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp4$/iu;

export class ExpoGeneratedVideoStore implements GeneratedVideoStoragePort {
  readonly #root = new Directory(Paths.document, "boltpocket", "generated-videos");
  #managedBytes: number | null = null;

  #managedBytesAfterAdding(sizeBytes: number) {
    return this.#managedBytes === null
      ? managedBytes(this.#root)
      : this.#managedBytes + sizeBytes;
  }

  async saveFromUrl(
    input: GeneratedVideoStorageInput,
  ): Promise<GeneratedVideoAttachment> {
    const scope = new Directory(
      this.#root,
      input.projectId
        ? `project-${safeScopeId(input.projectId)}`
        : `conversation-${safeScopeId(input.conversationId)}`,
    );
    scope.create({ idempotent: true, intermediates: true });
    const id = `generated-video-${randomUUID()}`;
    const name = `${id}.mp4`;
    const destination = new File(scope, name);
    try {
      const file = await File.downloadFileAsync(
        input.downloadUrl,
        destination,
        {
          signal: input.signal,
        },
      );
      const sizeBytes = file.size ?? 0;
      if (sizeBytes <= 0 || sizeBytes > MAX_GENERATED_VIDEO_BYTES) {
        throw new Error("视频文件大小不受支持。");
      }
      const reader = file.stream().getReader();
      const first = await reader.read();
      await reader.cancel();
      if (!first.value || !isMp4Header(first.value)) {
        throw new Error("下载结果不是受支持的 MP4 视频。");
      }
      const nextManagedBytes = this.#managedBytesAfterAdding(sizeBytes);
      if (nextManagedBytes > MAX_GENERATED_VIDEO_STORAGE_BYTES) {
        throw new Error("生成视频存储空间已达上限，请删除不再需要的对话。");
      }
      this.#managedBytes = nextManagedBytes;
      return {
        id,
        kind: "generated-video",
        uri: file.uri,
        name,
        mimeType: "video/mp4",
        sizeBytes,
        ...(input.durationSeconds
          ? { durationSeconds: input.durationSeconds }
          : {}),
        providerName: input.providerName,
        modelId: input.modelId,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  }

  async delete(attachments: readonly GeneratedVideoAttachment[]) {
    const rootUri = `${this.#root.uri.replace(/\/+$/u, "")}/`;
    for (const attachment of attachments) {
      const relativePath = attachment.uri.startsWith(rootUri)
        ? attachment.uri.slice(rootUri.length)
        : "";
      if (!MANAGED_VIDEO_PATH.test(relativePath)) {
        throw new Error("生成视频不属于 App 管理目录，无法安全删除。");
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

export const generatedVideoStore = new ExpoGeneratedVideoStore();
