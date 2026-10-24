import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { mimeTypeFor, sha256BytesHex, strictUtf8 } from "./helpers.js";
import type { BundleFile, SkillBundleStore } from "./types.js";

/**
 * Stores bundles on the local filesystem under
 * `${directory}/${bundleSha256}/${relativePath}`. Each bundle is a directory
 * of its files, mirroring the S3 key layout so the user can browse and
 * maintain bundles on disk. Writes are atomic (temp dir + rename).
 */
export class LocalFileBundleStore implements SkillBundleStore {
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }

  async putBundle(
    bundleSha256: string,
    files: readonly BundleFile[],
  ): Promise<void> {
    const targetDir = join(this.directory, bundleSha256);
    // Idempotent: if the bundle dir already exists with content, skip.
    if (await this.isDirectory(targetDir)) {
      const existing = await this.readBundleDir(bundleSha256);
      if (existing.length === files.length) return;
    }

    const tempDir = join(
      this.directory,
      `${bundleSha256}.tmp-${randomBytes(8).toString("hex")}`,
    );
    await mkdir(tempDir, { recursive: true });

    for (const file of files) {
      const filePath = join(tempDir, file.path);
      // Create parent dirs for nested paths.
      const lastSlash = filePath.lastIndexOf("/");
      if (lastSlash > tempDir.length) {
        await mkdir(filePath.slice(0, lastSlash), { recursive: true });
      }
      const bytes =
        file.encoding === "utf8"
          ? Buffer.from(file.content, "utf8")
          : Buffer.from(file.content, "base64");
      await writeFile(filePath, bytes);
    }

    // Atomic-ish swap: remove target if exists, then rename temp → target.
    await rm(targetDir, { recursive: true, force: true });
    await rename(tempDir, targetDir);
  }

  async getBundle(bundleSha256: string): Promise<readonly BundleFile[]> {
    return this.readBundleDir(bundleSha256);
  }

  async deleteBundle(bundleSha256: string): Promise<void> {
    const dir = join(this.directory, bundleSha256);
    await rm(dir, { recursive: true, force: true });
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      const s = await stat(path);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private async readBundleDir(
    bundleSha256: string,
  ): Promise<readonly BundleFile[]> {
    const bundleDir = join(this.directory, bundleSha256);
    const files: BundleFile[] = [];
    await this.walk(bundleDir, bundleDir, files);
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  }

  private async walk(
    baseDir: string,
    currentDir: string,
    files: BundleFile[],
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }
    for (const name of entries) {
      const fullPath = join(currentDir, name);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await this.walk(baseDir, fullPath, files);
      } else {
        const bytes = await readFile(fullPath);
        const relativePath = fullPath.slice(baseDir.length + 1);
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
    }
  }
}
