import { createHash } from "node:crypto";

import {
  MAX_BUNDLE_FILE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_PATH_BYTES,
  MAX_BUNDLE_TOTAL_BYTES,
  MAX_SKILL_BYTES,
} from "./limits.js";
import { mimeTypeFor, sha256BytesHex, strictUtf8 } from "./helpers.js";
import type { BundleFile } from "./types.js";

export type BundleFileInput = Readonly<{
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}>;

export type BundleFileBytesInput = Readonly<{
  path: string;
  bytes: Uint8Array;
  executable?: boolean;
}>;

export class BundleValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BundleValidationError";
    this.code = code;
  }
}

/**
 * Validates raw publish input files and builds typed `BundleFile[]` with
 * per-file sha256, byteLength, mimeType, and encoding. Enforces path safety,
 * file count, per-file size, total size, and SKILL.md presence.
 */
export function validateBundleFiles(input: unknown): readonly BundleFile[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BundleValidationError(
      "invalid_bundle",
      "files must be a non-empty array.",
    );
  }
  const decoded: BundleFileBytesInput[] = [];
  for (const raw of input) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as BundleFileInput).path !== "string" ||
      typeof (raw as BundleFileInput).content !== "string"
    ) {
      throw new BundleValidationError(
        "invalid_bundle",
        "each file must have a path and content string.",
      );
    }
    const entry = raw as BundleFileInput;
    const encoding = entry.encoding ?? "utf8";
    if (encoding !== "utf8" && encoding !== "base64") {
      throw new BundleValidationError(
        "invalid_bundle",
        "file encoding must be utf8 or base64.",
      );
    }
    decoded.push({
      path: entry.path,
      bytes:
        encoding === "utf8"
          ? Buffer.from(entry.content, "utf8")
          : decodeCanonicalBase64(entry.content),
      executable: entry.executable === true,
    });
  }

  return validateBundleFileBytes(decoded);
}

/**
 * Validates in-memory bundle bytes. Archive import uses this path so binary
 * supporting files never need to be coerced through UTF-8 text.
 */
export function validateBundleFileBytes(
  input: readonly BundleFileBytesInput[],
): readonly BundleFile[] {
  if (input.length === 0) {
    throw new BundleValidationError(
      "invalid_bundle",
      "files must be a non-empty array.",
    );
  }
  if (input.length > MAX_BUNDLE_FILES) {
    throw new BundleValidationError(
      "bundle_too_many_files",
      `bundles support at most ${MAX_BUNDLE_FILES} files.`,
    );
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;
  const files: BundleFile[] = [];
  let hasSkillMd = false;

  for (const entry of input) {
    const path = normalizeBundlePath(entry.path);
    if (seenPaths.has(path)) {
      throw new BundleValidationError(
        "invalid_bundle_path",
        `duplicate path: ${path}`,
      );
    }
    seenPaths.add(path);
    if (path === "SKILL.md") hasSkillMd = true;

    const contentBytes = Buffer.from(entry.bytes);
    if (contentBytes.byteLength > MAX_BUNDLE_FILE_BYTES) {
      throw new BundleValidationError(
        "bundle_file_too_large",
        `file ${path} exceeds ${MAX_BUNDLE_FILE_BYTES} bytes.`,
      );
    }
    totalBytes += contentBytes.byteLength;
    if (totalBytes > MAX_BUNDLE_TOTAL_BYTES) {
      throw new BundleValidationError(
        "bundle_too_large",
        `bundle total exceeds ${MAX_BUNDLE_TOTAL_BYTES} bytes.`,
      );
    }

    const text = strictUtf8(contentBytes);
    const isText = text !== null;
    if (path === "SKILL.md" && !isText) {
      throw new BundleValidationError(
        "invalid_bundle",
        "SKILL.md must be a UTF-8 text file.",
      );
    }
    if (path === "SKILL.md" && contentBytes.byteLength > MAX_SKILL_BYTES) {
      throw new BundleValidationError(
        "skill_too_large",
        `SKILL.md exceeds ${MAX_SKILL_BYTES} bytes.`,
      );
    }

    files.push({
      path,
      content: isText ? text : contentBytes.toString("base64"),
      encoding: isText ? "utf8" : "base64",
      executable: entry.executable === true,
      mimeType: mimeTypeFor(path, isText),
      byteLength: contentBytes.byteLength,
      sha256: sha256BytesHex(contentBytes),
    });
  }

  if (!hasSkillMd) {
    throw new BundleValidationError(
      "missing_skill_md",
      "SKILL.md is required in the bundle.",
    );
  }
  // Sort by path ascending for deterministic fingerprinting.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

function normalizeBundlePath(value: string): string {
  const path = value.normalize("NFC");
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.length === 0 ||
    Buffer.byteLength(path, "utf8") > MAX_BUNDLE_PATH_BYTES
  ) {
    throw new BundleValidationError(
      "invalid_bundle_path",
      `path is invalid: ${value}`,
    );
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment === "__proto__" ||
        segment === "constructor" ||
        segment === "prototype",
    )
  ) {
    throw new BundleValidationError(
      "invalid_bundle_path",
      `path contains invalid segments: ${value}`,
    );
  }
  return path;
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    throw new BundleValidationError(
      "invalid_bundle",
      "base64 file content is invalid.",
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new BundleValidationError(
      "invalid_bundle",
      "base64 file content is invalid.",
    );
  }
  return bytes;
}

/**
 * Extracts the text content of a file from a bundle by path. Returns null if
 * the file is not present. Throws if the file is base64-encoded (binary).
 */
export function extractTextFile(
  files: readonly BundleFile[],
  path: string,
): string | null {
  const file = files.find((f) => f.path === path);
  if (file === undefined) return null;
  if (file.encoding === "base64") {
    throw new BundleValidationError(
      "invalid_bundle",
      `${path} must be a text file.`,
    );
  }
  return file.content;
}

/** Recomputes the per-file sha256 from stored content (integrity check). */
export function verifyFileSha256(file: BundleFile): boolean {
  const bytes =
    file.encoding === "utf8"
      ? Buffer.from(file.content, "utf8")
      : Buffer.from(file.content, "base64");
  return createHash("sha256").update(bytes).digest("hex") === file.sha256;
}
