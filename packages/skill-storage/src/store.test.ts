import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LocalFileBundleStore,
  bundleFingerprint,
  sha256Hex,
  validateBundleFiles,
} from "./index.js";
import type { BundleFile } from "./index.js";

function makeFiles(): readonly BundleFile[] {
  return validateBundleFiles([
    { path: "SKILL.md", content: "---\nname: test\n---\nbody" },
    { path: "README.md", content: "# readme" },
    { path: "scripts/run.sh", content: "echo hi", executable: true },
  ]);
}

describe("LocalFileBundleStore", () => {
  it("round-trips a multi-file bundle with nested paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-store-"));
    const store = new LocalFileBundleStore(dir);
    const files = makeFiles();
    const bundleSha = sha256Hex(bundleFingerprint(files));

    await store.putBundle(bundleSha, files);

    // Directory layout: {sha}/{relativePath}
    assert.ok(existsSync(join(dir, bundleSha, "SKILL.md")));
    assert.ok(existsSync(join(dir, bundleSha, "README.md")));
    assert.ok(existsSync(join(dir, bundleSha, "scripts", "run.sh")));

    const fetched = await store.getBundle(bundleSha);
    assert.equal(fetched.length, 3);
    const skill = fetched.find((f) => f.path === "SKILL.md");
    assert.ok(skill);
    assert.equal(skill!.content, "---\nname: test\n---\nbody");
    assert.equal(skill!.encoding, "utf8");
    assert.equal(skill!.mimeType, "text/markdown");

    const script = fetched.find((f) => f.path === "scripts/run.sh");
    assert.ok(script);
    assert.equal(script!.mimeType, "text/plain");
    // sha256 round-trips
    assert.equal(
      skill!.sha256,
      files.find((f) => f.path === "SKILL.md")!.sha256,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent on repeated putBundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-store-"));
    const store = new LocalFileBundleStore(dir);
    const files = makeFiles();
    const bundleSha = sha256Hex(bundleFingerprint(files));

    await store.putBundle(bundleSha, files);
    await store.putBundle(bundleSha, files); // should not throw
    const fetched = await store.getBundle(bundleSha);
    assert.equal(fetched.length, 3);

    rmSync(dir, { recursive: true, force: true });
  });

  it("deletes a bundle directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-store-"));
    const store = new LocalFileBundleStore(dir);
    const files = makeFiles();
    const bundleSha = sha256Hex(bundleFingerprint(files));

    await store.putBundle(bundleSha, files);
    assert.ok(existsSync(join(dir, bundleSha)));
    await store.deleteBundle(bundleSha);
    assert.ok(!existsSync(join(dir, bundleSha)));

    rmSync(dir, { recursive: true, force: true });
  });

  it("getBundle returns empty for missing bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-store-"));
    const store = new LocalFileBundleStore(dir);
    const fetched = await store.getBundle("nonexistent-sha");
    assert.equal(fetched.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("validateBundleFiles", () => {
  it("rejects missing SKILL.md", () => {
    assert.throws(
      () => validateBundleFiles([{ path: "README.md", content: "x" }]),
      (err: Error) =>
        err instanceof Error && /SKILL\.md is required/.test(err.message),
    );
  });

  it("rejects path traversal", () => {
    assert.throws(
      () =>
        validateBundleFiles([
          { path: "SKILL.md", content: "x" },
          { path: "../etc/passwd", content: "x" },
        ]),
      (err: Error) =>
        err instanceof Error && /invalid segments/.test(err.message),
    );
  });

  it("rejects duplicate paths", () => {
    assert.throws(
      () =>
        validateBundleFiles([
          { path: "SKILL.md", content: "x" },
          { path: "SKILL.md", content: "y" },
        ]),
      (err: Error) =>
        err instanceof Error && /duplicate path/.test(err.message),
    );
  });

  it("accepts canonical base64 for arbitrary binary supporting files", () => {
    const binary = Buffer.from([0, 255, 18, 99]);
    const files = validateBundleFiles([
      { path: "SKILL.md", content: "# Skill" },
      {
        path: "assets/model.unknown",
        content: binary.toString("base64"),
        encoding: "base64",
      },
    ]);
    const asset = files.find((file) => file.path === "assets/model.unknown");
    assert.ok(asset);
    assert.equal(asset.encoding, "base64");
    assert.equal(asset.content, binary.toString("base64"));
    assert.equal(asset.byteLength, binary.byteLength);
    assert.equal(asset.mimeType, "application/octet-stream");
  });

  it("rejects non-canonical base64 and control characters in paths", () => {
    assert.throws(
      () =>
        validateBundleFiles([
          { path: "SKILL.md", content: "# Skill" },
          { path: "asset.bin", content: "%%%", encoding: "base64" },
        ]),
      /base64 file content is invalid/u,
    );
    assert.throws(
      () =>
        validateBundleFiles([
          { path: "SKILL.md", content: "# Skill" },
          { path: "bad\u0000name.bin", content: "value" },
        ]),
      /path is invalid/u,
    );
  });

  it("rejects too many files", () => {
    const files = [{ path: "SKILL.md", content: "x" }];
    for (let i = 0; i < 256; i++) {
      files.push({ path: `file${i}.txt`, content: "x" });
    }
    assert.throws(
      () => validateBundleFiles(files),
      (err: Error) =>
        err instanceof Error && /at most 256 files/.test(err.message),
    );
  });
});
