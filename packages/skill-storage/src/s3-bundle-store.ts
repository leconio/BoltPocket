import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { mimeTypeFor, sha256BytesHex, strictUtf8 } from "./helpers.js";
import type { BundleFile, SkillBundleStore } from "./types.js";

type S3Config = Readonly<{
  endpoint?: string;
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}>;

/**
 * S3-compatible bundle store. Each file is an object keyed by
 * `${bundleSha256}/${relativePath}`. Not exercised in tests until the user
 * provides real S3 credentials; constructed via the factory when
 * `kind === "s3"`.
 */
export class S3BundleStore implements SkillBundleStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      ...(config.region !== undefined ? { region: config.region } : {}),
      ...(config.forcePathStyle === true ? { forcePathStyle: true } : {}),
      ...(config.accessKeyId !== undefined &&
      config.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async putBundle(
    bundleSha256: string,
    files: readonly BundleFile[],
  ): Promise<void> {
    for (const file of files) {
      const bytes =
        file.encoding === "utf8"
          ? Buffer.from(file.content, "utf8")
          : Buffer.from(file.content, "base64");
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: `${bundleSha256}/${file.path}`,
          Body: bytes,
          ContentType: file.mimeType,
        }),
      );
    }
  }

  async getBundle(bundleSha256: string): Promise<readonly BundleFile[]> {
    const list = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${bundleSha256}/`,
      }),
    );
    const objects = list.Contents ?? [];
    const files: BundleFile[] = [];
    for (const obj of objects) {
      if (obj.Key === undefined) continue;
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
      );
      const body = await response.Body?.transformToByteArray();
      if (body === undefined) continue;
      const bytes = Buffer.from(body);
      const relativePath = obj.Key.slice(`${bundleSha256}/`.length);
      const decoded = strictUtf8(bytes);
      const isText = decoded !== null;
      files.push({
        path: relativePath,
        content: isText ? decoded! : bytes.toString("base64"),
        encoding: isText ? "utf8" : "base64",
        executable: false,
        mimeType: mimeTypeFor(relativePath, isText),
        byteLength: bytes.byteLength,
        sha256: sha256BytesHex(bytes),
      });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  }

  async deleteBundle(bundleSha256: string): Promise<void> {
    const list = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${bundleSha256}/`,
      }),
    );
    const objects = (list.Contents ?? []).filter((o) => o.Key !== undefined);
    if (objects.length === 0) return;
    // Delete in batches of 1000 (S3 limit).
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000).map((o) => ({
        Key: o.Key!,
      }));
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch },
        }),
      );
    }
  }
}
