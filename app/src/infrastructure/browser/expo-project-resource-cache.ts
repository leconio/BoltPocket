import { extractBoundedZipArchive } from "@boltpocket/project-shell-extras/zip";
import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import resourceArchiveModule from "../../../assets/h5-resources-v1.zip";
import {
  BUILT_IN_PROJECT_RESOURCE_PACKS,
  builtInProjectResourcePack,
  H5_RESOURCE_BUNDLE,
  isBuiltInProjectResourcePackId,
  type BuiltInProjectResourceFile,
  type BuiltInProjectResourcePackId,
} from "@/domain/builtin-project-resources";

type BundleMarker = Readonly<{
  schema: 1;
  archiveSha256: string;
  archiveByteLength: number;
}>;

export type MaterializedProjectResources = Readonly<{
  packCount: number;
  fileCount: number;
  byteLength: number;
}>;

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

function marker(): BundleMarker {
  return Object.freeze({
    schema: 1,
    archiveSha256: H5_RESOURCE_BUNDLE.sha256,
    archiveByteLength: H5_RESOURCE_BUNDLE.byteLength,
  });
}

function isMarker(value: unknown): value is BundleMarker {
  const expected = marker();
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as BundleMarker).schema === expected.schema &&
    (value as BundleMarker).archiveSha256 === expected.archiveSha256 &&
    (value as BundleMarker).archiveByteLength === expected.archiveByteLength,
  );
}

function expectedFiles() {
  const expected = new Map<string, BuiltInProjectResourceFile>();
  for (const pack of BUILT_IN_PROJECT_RESOURCE_PACKS) {
    for (const file of pack.files) {
      expected.set(`${pack.id}/${file.path}`, file);
    }
  }
  return expected;
}

function nestedFile(root: Directory, path: string) {
  const segments = path.split("/");
  const fileName = segments.pop()!;
  const parent = segments.reduce(
    (current, segment) => new Directory(current, segment),
    root,
  );
  return { file: new File(parent, fileName), parent };
}

function uniquePackIds(ids: readonly BuiltInProjectResourcePackId[]) {
  const unique = [...new Set(ids)];
  if (
    unique.length !== ids.length ||
    unique.some((id) => !isBuiltInProjectResourcePackId(id))
  ) {
    throw new Error("项目内置资源授权无效。");
  }
  return unique;
}

export class ExpoProjectResourceCache {
  readonly #container = new Directory(Paths.cache, "boltpocket", "h5-resources");
  readonly #bundleRoot = new Directory(this.#container, "v1");
  readonly #files = new Directory(this.#bundleRoot, "files");
  readonly #marker = new File(this.#bundleRoot, "bundle.json");
  #queue = Promise.resolve();
  #ready = false;

  prepare(): Promise<void> {
    const operation = this.#queue.then(() => this.#ensureBundle());
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async materialize(
    ids: readonly BuiltInProjectResourcePackId[],
    destination: Directory,
  ): Promise<MaterializedProjectResources> {
    const packIds = uniquePackIds(ids);
    await this.prepare();
    destination.create({ idempotent: true, intermediates: true });
    let fileCount = 0;
    let byteLength = 0;
    for (const packId of packIds) {
      const pack = builtInProjectResourcePack(packId);
      const targetPack = new Directory(destination, packId);
      targetPack.create({ idempotent: true, intermediates: true });
      for (const descriptor of pack.files) {
        const source = this.#file(packId, descriptor.path);
        const target = nestedFile(targetPack, descriptor.path);
        target.parent.create({ idempotent: true, intermediates: true });
        await source.copy(target.file, { overwrite: true });
        fileCount += 1;
        byteLength += descriptor.byteLength;
      }
    }
    return Object.freeze({
      packCount: packIds.length,
      fileCount,
      byteLength,
    });
  }

  async fileUri(
    packId: BuiltInProjectResourcePackId,
    path: string,
  ): Promise<string> {
    await this.prepare();
    const descriptor = this.#descriptor(packId, path);
    const file = this.#file(packId, descriptor.path);
    if (!file.exists) throw new Error("内置资源文件不存在。");
    return file.uri;
  }

  async readText(
    packId: BuiltInProjectResourcePackId,
    path: string,
  ): Promise<string> {
    const descriptor = this.#descriptor(packId, path);
    if (
      !descriptor.mimeType.startsWith("text/") &&
      descriptor.mimeType !== "application/json" &&
      descriptor.mimeType !== "application/xml"
    ) {
      throw new Error("这个内置资源不是文本文件。");
    }
    await this.prepare();
    return this.#file(packId, descriptor.path).text();
  }

  async readBase64(
    packId: BuiltInProjectResourcePackId,
    path: string,
  ): Promise<string> {
    const descriptor = this.#descriptor(packId, path);
    await this.prepare();
    const file = this.#file(packId, descriptor.path);
    if (!file.exists || file.size !== descriptor.byteLength) {
      throw new Error("内置资源文件不存在或不完整。");
    }
    return file.base64();
  }

  #descriptor(packId: BuiltInProjectResourcePackId, path: string) {
    const descriptor = builtInProjectResourcePack(packId).files.find(
      (file) => file.path === path,
    );
    if (!descriptor) throw new Error("内置资源路径无效。");
    return descriptor as BuiltInProjectResourceFile;
  }

  #file(packId: BuiltInProjectResourcePackId, path: string) {
    return nestedFile(new Directory(this.#files, packId), path).file;
  }

  async #ensureBundle() {
    if (this.#ready) return;
    this.#container.create({ idempotent: true, intermediates: true });
    if (await this.#existingBundleIsValid()) {
      this.#removeOtherCopies();
      this.#ready = true;
      return;
    }
    if (this.#bundleRoot.exists) this.#bundleRoot.delete();
    this.#removeOtherCopies();
    const staging = new Directory(this.#container, `temporary-${randomUUID()}`);
    try {
      const entries = await this.#readAndValidateArchive();
      const stagingFiles = new Directory(staging, "files");
      stagingFiles.create({ intermediates: true });
      for (const entry of entries) {
        const target = nestedFile(stagingFiles, entry.name);
        target.parent.create({ idempotent: true, intermediates: true });
        target.file.create();
        target.file.write(entry.data);
      }
      const stagingMarker = new File(staging, "bundle.json");
      stagingMarker.create();
      stagingMarker.write(JSON.stringify(marker()));
      await staging.move(this.#bundleRoot);
    } catch (error) {
      if (staging.exists) staging.delete();
      throw error;
    }
    if (!(await this.#existingBundleIsValid())) {
      if (this.#bundleRoot.exists) this.#bundleRoot.delete();
      throw new Error("内置 H5 资源解压后校验失败。");
    }
    this.#removeOtherCopies();
    this.#ready = true;
  }

  async #readAndValidateArchive() {
    const asset = Asset.fromModule(resourceArchiveModule);
    await asset.downloadAsync();
    if (!asset.localUri?.startsWith("file:")) {
      throw new Error("内置 H5 资源不可用。");
    }
    const archive = new File(asset.localUri);
    if (!archive.exists || archive.size !== H5_RESOURCE_BUNDLE.byteLength) {
      throw new Error("内置 H5 资源 ZIP 不完整。");
    }
    const bytes = await archive.bytes();
    if ((await sha256(bytes)) !== H5_RESOURCE_BUNDLE.sha256) {
      throw new Error("内置 H5 资源 ZIP 校验失败。");
    }
    const entries = extractBoundedZipArchive(bytes, H5_RESOURCE_BUNDLE.limits);
    const expected = expectedFiles();
    if (entries.length !== expected.size) {
      throw new Error("内置 H5 资源目录不完整。");
    }
    for (const entry of entries) {
      const descriptor = expected.get(entry.name);
      if (
        !descriptor ||
        descriptor.byteLength !== entry.data.byteLength ||
        descriptor.sha256 !== (await sha256(entry.data))
      ) {
        throw new Error(`内置 H5 资源校验失败：${entry.name}`);
      }
      expected.delete(entry.name);
    }
    if (expected.size > 0) throw new Error("内置 H5 资源目录不完整。");
    return entries;
  }

  async #existingBundleIsValid() {
    if (
      !this.#bundleRoot.exists ||
      !this.#files.exists ||
      !this.#marker.exists
    ) {
      return false;
    }
    try {
      const parsed: unknown = JSON.parse(this.#marker.textSync());
      if (!isMarker(parsed)) return false;
      for (const [path, descriptor] of expectedFiles()) {
        const file = nestedFile(this.#files, path).file;
        if (
          !file.exists ||
          file.size !== descriptor.byteLength ||
          (await sha256(await file.bytes())) !== descriptor.sha256
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  #removeOtherCopies() {
    for (const item of this.#container.list()) {
      if (item.name !== this.#bundleRoot.name && item.exists) item.delete();
    }
  }
}

export const projectResourceCache = new ExpoProjectResourceCache();
