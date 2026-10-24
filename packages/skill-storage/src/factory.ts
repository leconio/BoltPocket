import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalFileBundleStore } from "./local-file-bundle-store.js";
import { S3BundleStore } from "./s3-bundle-store.js";
import type { BundleStoreConfig, SkillBundleStore } from "./types.js";

const DEFAULT_LOCAL_DIR = join(tmpdir(), "boltpocket-skill-bundles");

/**
 * Creates a `SkillBundleStore` from config. `local` writes to a directory on
 * disk (created if missing); `s3` uses the AWS SDK against a configurable
 * endpoint. Both implementations use the same `{sha}/{relativePath}` key
 * layout so switching backends only changes config.
 */
export function createBundleStore(config: BundleStoreConfig): SkillBundleStore {
  if (config.kind === "s3") {
    if (config.s3Bucket === undefined) {
      throw new Error("s3Bucket is required for the s3 bundle store.");
    }
    return new S3BundleStore({
      bucket: config.s3Bucket,
      ...(config.s3Endpoint !== undefined
        ? { endpoint: config.s3Endpoint }
        : {}),
      ...(config.s3Region !== undefined ? { region: config.s3Region } : {}),
      ...(config.s3AccessKeyId !== undefined
        ? { accessKeyId: config.s3AccessKeyId }
        : {}),
      ...(config.s3SecretAccessKey !== undefined
        ? { secretAccessKey: config.s3SecretAccessKey }
        : {}),
      ...(config.s3ForcePathStyle !== undefined
        ? { forcePathStyle: config.s3ForcePathStyle }
        : {}),
    });
  }

  const dir = config.localDirectory ?? DEFAULT_LOCAL_DIR;
  mkdirSync(dir, { recursive: true });
  return new LocalFileBundleStore(dir);
}
