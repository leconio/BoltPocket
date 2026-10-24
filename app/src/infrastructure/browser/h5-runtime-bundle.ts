import type { BoundedZipArchiveEntry } from "@boltpocket/project-shell-extras/zip";

import {
  H5_RUNTIME_ASSETS,
  h5RuntimeCacheFileName,
} from "./h5-runtime-registry";

const BUNDLED_ASSETS = Object.freeze(Object.values(H5_RUNTIME_ASSETS));
const MAX_BUNDLED_ASSET_BYTES = Math.max(
  ...BUNDLED_ASSETS.map((asset) => asset.byteLength),
);
const TOTAL_BUNDLED_ASSET_BYTES = BUNDLED_ASSETS.reduce(
  (total, asset) => total + asset.byteLength,
  0,
);

export const H5_RUNTIME_BUNDLE_LIMITS = Object.freeze({
  maxArchiveBytes: 4 * 1024 * 1024,
  maxEntries: BUNDLED_ASSETS.length,
  maxEntryBytes: MAX_BUNDLED_ASSET_BYTES,
  maxExtractedBytes: TOTAL_BUNDLED_ASSET_BYTES,
  maxPathBytes: 96,
});

export function h5RuntimeBundleAssetsByFileName() {
  return new Map(
    BUNDLED_ASSETS.map((asset) => [h5RuntimeCacheFileName(asset), asset]),
  );
}

export async function validateH5RuntimeBundleEntries(
  entries: readonly BoundedZipArchiveEntry[],
  digest: (bytes: Uint8Array) => Promise<string>,
) {
  const expected = h5RuntimeBundleAssetsByFileName();
  if (entries.length !== expected.size) {
    throw new Error("H5 离线运行时文件数量不正确。");
  }
  for (const entry of entries) {
    const asset = expected.get(entry.name);
    if (!asset || entry.data.byteLength !== asset.byteLength) {
      throw new Error("H5 离线运行时清单不匹配。");
    }
    if ((await digest(entry.data)) !== asset.sha256) {
      throw new Error("H5 离线运行时完整性校验失败。");
    }
    expected.delete(entry.name);
  }
  if (expected.size > 0) {
    throw new Error("H5 离线运行时缺少必要文件。");
  }
  return entries;
}
