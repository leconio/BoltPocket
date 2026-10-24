import { extractBoundedZipArchive } from "@boltpocket/project-shell-extras/zip";
import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import runtimeArchiveModule from "../../../assets/h5-runtimes-v1.zip";
import { H5_RUNTIME_BUNDLE } from "./h5-runtime-bundle.generated";
import {
  H5_RUNTIME_BUNDLE_LIMITS,
  h5RuntimeBundleAssetsByFileName,
  validateH5RuntimeBundleEntries,
} from "./h5-runtime-bundle";
import {
  H5_RUNTIME_ASSETS,
  type H5RuntimeAsset,
  h5RuntimeCacheFileName,
} from "./h5-runtime-registry";

export const H5_RUNTIME_CACHE_LIMIT_BYTES =
  H5_RUNTIME_BUNDLE_LIMITS.maxExtractedBytes;
const BUNDLE_SCHEMA = 1;

type BundleMarker = Readonly<{
  schema: 1;
  archiveSha256: string;
  archiveByteLength: number;
  files: readonly string[];
}>;

export type H5RuntimeCacheResult = Readonly<{
  rootUri: string;
  assetCount: number;
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

function expectedFileNames() {
  return Object.values(H5_RUNTIME_ASSETS)
    .map(h5RuntimeCacheFileName)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function marker(): BundleMarker {
  return Object.freeze({
    schema: BUNDLE_SCHEMA,
    archiveSha256: H5_RUNTIME_BUNDLE.sha256,
    archiveByteLength: H5_RUNTIME_BUNDLE.byteLength,
    files: Object.freeze(expectedFileNames()),
  });
}

function validMarker(value: unknown): value is BundleMarker {
  const expected = marker();
  return (
    Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    (value as BundleMarker).schema === expected.schema &&
    (value as BundleMarker).archiveSha256 === expected.archiveSha256 &&
    (value as BundleMarker).archiveByteLength === expected.archiveByteLength &&
    Array.isArray((value as BundleMarker).files) &&
    (value as BundleMarker).files.length === expected.files.length &&
    (value as BundleMarker).files.every(
      (name, index) => name === expected.files[index],
    )
  );
}

export class ExpoH5RuntimeCache {
  readonly #container = new Directory(Paths.cache, "boltpocket", "h5-runtimes");
  readonly #bundleRoot = new Directory(this.#container, "v1");
  readonly #files = new Directory(this.#bundleRoot, "files");
  readonly #marker = new File(this.#bundleRoot, "bundle.json");
  #queue = Promise.resolve();
  #ready = false;

  prepare(assets: readonly H5RuntimeAsset[]): Promise<H5RuntimeCacheResult> {
    const operation = this.#queue.then(() => this.#prepare(assets));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #prepare(
    assets: readonly H5RuntimeAsset[],
  ): Promise<H5RuntimeCacheResult> {
    this.#validateRequestedAssets(assets);
    await this.#ensureBundle();
    return Object.freeze({
      rootUri: this.#files.uri,
      assetCount: assets.length,
      byteLength: assets.reduce((total, asset) => total + asset.byteLength, 0),
    });
  }

  #validateRequestedAssets(assets: readonly H5RuntimeAsset[]) {
    const catalog = new Map<string, H5RuntimeAsset>(
      Object.values(H5_RUNTIME_ASSETS).map((asset) => [asset.sha256, asset]),
    );
    const hashes = new Set<string>();
    for (const asset of assets) {
      const registered = catalog.get(asset.sha256);
      if (
        !registered ||
        registered.id !== asset.id ||
        registered.byteLength !== asset.byteLength ||
        hashes.has(asset.sha256)
      ) {
        throw new Error("H5 运行时清单无效。");
      }
      hashes.add(asset.sha256);
    }
  }

  async #ensureBundle() {
    if (this.#ready) return;
    this.#container.create({ idempotent: true, intermediates: true });
    if (await this.#existingBundleIsValid()) {
      this.#removeNonCurrentCopies();
      this.#ready = true;
      return;
    }
    if (this.#bundleRoot.exists) this.#bundleRoot.delete();
    this.#removeNonCurrentCopies();

    const staging = new Directory(this.#container, `temporary-${randomUUID()}`);
    try {
      const entries = await this.#readAndValidateArchive();
      const stagingFiles = new Directory(staging, "files");
      stagingFiles.create({ idempotent: false, intermediates: true });
      for (const entry of entries) {
        const file = new File(stagingFiles, entry.name);
        file.create();
        file.write(entry.data);
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
      throw new Error("H5 离线运行时解压后校验失败。");
    }
    this.#removeNonCurrentCopies();
    this.#ready = true;
  }

  async #readAndValidateArchive() {
    const asset = Asset.fromModule(runtimeArchiveModule);
    await asset.downloadAsync();
    const archiveUri = asset.localUri;
    if (!archiveUri?.startsWith("file:")) {
      throw new Error("H5 离线运行时资源不可用。");
    }
    const archive = new File(archiveUri);
    if (!archive.exists || archive.size !== H5_RUNTIME_BUNDLE.byteLength) {
      throw new Error("H5 离线运行时 ZIP 不完整。");
    }
    const bytes = await archive.bytes();
    if ((await sha256(bytes)) !== H5_RUNTIME_BUNDLE.sha256) {
      throw new Error("H5 离线运行时 ZIP 校验失败。");
    }
    const entries = extractBoundedZipArchive(bytes, H5_RUNTIME_BUNDLE_LIMITS);
    return validateH5RuntimeBundleEntries(entries, sha256);
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
      if (!validMarker(parsed)) return false;
      const expected = h5RuntimeBundleAssetsByFileName();
      const files = this.#files.list();
      if (
        files.length !== expected.size ||
        files.some((item) => !(item instanceof File))
      ) {
        return false;
      }
      for (const item of files) {
        if (!(item instanceof File)) return false;
        const asset = expected.get(item.name);
        if (
          !asset ||
          item.size !== asset.byteLength ||
          (await sha256(await item.bytes())) !== asset.sha256
        ) {
          return false;
        }
        expected.delete(item.name);
      }
      return expected.size === 0;
    } catch {
      return false;
    }
  }

  #removeNonCurrentCopies() {
    for (const item of this.#container.list()) {
      if (item.name !== this.#bundleRoot.name && item.exists) item.delete();
    }
  }
}

export const h5RuntimeCache = new ExpoH5RuntimeCache();
