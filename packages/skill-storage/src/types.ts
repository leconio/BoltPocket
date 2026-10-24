export type BundleFile = Readonly<{
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  executable: boolean;
  mimeType: string;
  byteLength: number;
  sha256: string;
}>;

export interface SkillBundleStore {
  putBundle(bundleSha256: string, files: readonly BundleFile[]): Promise<void>;
  getBundle(bundleSha256: string): Promise<readonly BundleFile[]>;
  deleteBundle(bundleSha256: string): Promise<void>;
}

export type BundleStoreConfig = Readonly<{
  kind: "local" | "s3";
  localDirectory?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
}>;
