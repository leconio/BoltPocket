import { createHash } from "node:crypto";

import type { BundleFile } from "./types.js";

/**
 * Deterministic fingerprint string for a bundle. The bundle sha256 is computed
 * over this string so identical file sets produce identical bundle hashes
 * (content-addressed deduplication).
 */
export function bundleFingerprint(files: readonly BundleFile[]): string {
  return JSON.stringify(
    files.map((file) => ({
      byteLength: file.byteLength,
      encoding: file.encoding,
      executable: file.executable,
      mimeType: file.mimeType,
      path: file.path,
      sha256: file.sha256,
    })),
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256BytesHex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  mjs: "text/javascript",
  pdf: "application/pdf",
  png: "image/png",
  py: "text/x-python",
  svg: "image/svg+xml",
  ts: "text/typescript",
  txt: "text/plain",
  webp: "image/webp",
  yaml: "application/yaml",
  yml: "application/yaml",
};

export function mimeTypeFor(path: string, textFile: boolean): string {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  return (
    MIME_TYPES[extension] ??
    (textFile ? "text/plain" : "application/octet-stream")
  );
}

/**
 * Returns the UTF-8 string if the bytes are valid UTF-8 (round-trip clean, no
 * NUL), else null. Used to decide whether a file is stored as utf8 text or
 * base64.
 */
export function strictUtf8(bytes: Buffer): string | null {
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").compare(bytes) === 0 &&
    !decoded.includes("\0")
    ? decoded
    : null;
}
