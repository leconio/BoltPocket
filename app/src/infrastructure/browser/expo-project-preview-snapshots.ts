import { randomUUID } from "expo-crypto";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import {
  startProjectPreviewServer,
  stopProjectPreviewServer,
} from "@boltpocket/expo-project-preview-server";

import type {
  CreateProjectPreviewInput,
  ProjectPreviewSnapshot,
  ProjectPreviewSnapshotPort,
} from "@/application/ports/project-preview";

import {
  encodeProjectPreviewPath,
  prepareProjectPreview,
} from "./project-preview-policy";
import { h5RuntimeCache } from "./expo-h5-runtime-cache";
import { h5RuntimeAssetsForManifest } from "./h5-runtime-registry";

function byteHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(bytes: Uint8Array) {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  return byteHex(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, copied),
  );
}

export class ExpoProjectPreviewSnapshotService implements ProjectPreviewSnapshotPort {
  readonly #root = new Directory(Paths.cache, "boltpocket", "project-previews");
  readonly #directories = new Map<string, Directory>();
  #initialized = false;

  async create(
    input: CreateProjectPreviewInput,
  ): Promise<ProjectPreviewSnapshot> {
    this.#initialize();
    const id = randomUUID().replaceAll("-", "").toLowerCase();
    const runtimeBasePath =
      Platform.OS === "ios" ? `/${id}/runtime/` : "/runtime/";
    const prepared = prepareProjectPreview(input, {
      runtimeBasePath,
    });
    const contentFiles = await Promise.all(
      prepared.files.map(async (file) => ({
        path: file.relativePath,
        byteLength: file.byteLength,
        sha256:
          file.encoding === "base64"
            ? file.sha256!
            : await sha256(new TextEncoder().encode(file.content)),
      })),
    );
    const contentSha256 = await sha256(
      new TextEncoder().encode(JSON.stringify(contentFiles)),
    );
    const runtime = await h5RuntimeCache.prepare(
      h5RuntimeAssetsForManifest(prepared.manifest),
    );
    const enabledResources = new Set(input.enabledResourcePackIds ?? []);
    const requestedResources = prepared.manifest.resources ?? [];
    const unavailable = requestedResources.filter(
      (packId) => !enabledResources.has(packId),
    );
    if (unavailable.length > 0) {
      throw new Error(`当前项目没有启用内置资源：${unavailable.join("、")}`);
    }
    const directory = new Directory(this.#root, id);
    try {
      directory.create({ intermediates: true });
      for (const previewFile of prepared.files) {
        const segments = previewFile.relativePath.split("/");
        const fileName = segments.pop()!;
        const parent = segments.reduce(
          (current, segment) => new Directory(current, segment),
          directory,
        );
        parent.create({ idempotent: true, intermediates: true });
        const file = new File(parent, fileName);
        file.create();
        file.write(
          previewFile.content,
          previewFile.encoding === "base64" ? { encoding: "base64" } : {},
        );
        if (
          previewFile.encoding === "base64" &&
          (file.size !== previewFile.byteLength ||
            (await sha256(await file.bytes())) !== previewFile.sha256)
        ) {
          throw new Error(`项目二进制资源校验失败：${previewFile.path}`);
        }
      }
      const copiedResourceFiles = prepared.files.filter(
        (file) => file.encoding === "base64",
      );
      const resources = {
        packCount: new Set(
          copiedResourceFiles.flatMap((file) =>
            file.source?.kind === "builtin-h5-resource"
              ? [file.source.packId]
              : [],
          ),
        ).size,
        fileCount: copiedResourceFiles.length,
        byteLength: copiedResourceFiles.reduce(
          (total, file) => total + file.byteLength,
          0,
        ),
      };
      const entry = encodeProjectPreviewPath(prepared.displayPath);
      const url =
        Platform.OS === "ios"
          ? `${await startProjectPreviewServer(id, directory.uri, runtime.rootUri)}${entry}`
          : `https://preview-${id}.boltpocket.invalid/content/${entry}`;
      this.#directories.set(id, directory);
      return {
        id,
        projectId: input.projectId,
        entryPath: prepared.entryPath,
        displayPath: prepared.displayPath,
        url,
        rootUri: directory.uri,
        fileCount: prepared.files.length,
        byteLength: prepared.byteLength,
        contentSha256,
        app: prepared.manifest,
        runtime: {
          assetCount: runtime.assetCount,
          byteLength: runtime.byteLength,
        },
        resources,
        createdAt: Date.now(),
      };
    } catch (error) {
      if (directory.exists) directory.delete();
      throw error;
    }
  }

  async release(snapshotId: string) {
    const directory = this.#directories.get(snapshotId);
    this.#directories.delete(snapshotId);
    try {
      if (Platform.OS === "ios") {
        await stopProjectPreviewServer(snapshotId);
      }
    } finally {
      if (directory?.exists) directory.delete();
    }
  }

  #initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#root.create({ idempotent: true, intermediates: true });
    for (const item of this.#root.list()) {
      if (item instanceof Directory && item.exists) item.delete();
    }
  }
}

export const projectPreviewSnapshots = new ExpoProjectPreviewSnapshotService();
