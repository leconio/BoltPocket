import assert from "node:assert/strict";
import test from "node:test";

import { zipSync } from "fflate";

import { decodeZipTextEntry, extractBoundedZipArchive } from "./zip.ts";

const limits = {
  maxArchiveBytes: 1024 * 1024,
  maxEntries: 32,
  maxEntryBytes: 128 * 1024,
  maxExtractedBytes: 256 * 1024,
  maxPathBytes: 256,
};

test("bounded ZIP extraction returns normalized file entries", () => {
  const archive = zipSync({
    "owner-repo-sha/README.md": new TextEncoder().encode("# Fixture\n"),
    "owner-repo-sha/src/index.ts": new TextEncoder().encode(
      "export const answer = 42;\n",
    ),
  });

  const entries = extractBoundedZipArchive(archive, limits);
  assert.deepEqual(
    entries.map((entry) => [entry.name, decodeZipTextEntry(entry)]),
    [
      ["owner-repo-sha/README.md", "# Fixture\n"],
      ["owner-repo-sha/src/index.ts", "export const answer = 42;\n"],
    ],
  );
});

test("bounded ZIP extraction rejects traversal before returning files", () => {
  const archive = zipSync({
    "../escape.txt": new TextEncoder().encode("unsafe"),
  });
  assert.throws(
    () => extractBoundedZipArchive(archive, limits),
    /unsafe path/iu,
  );
});

test("bounded ZIP extraction stops expansion beyond the configured limit", () => {
  const archive = zipSync({
    "repo/large.txt": new TextEncoder().encode("x".repeat(32 * 1024)),
  });
  assert.throws(
    () =>
      extractBoundedZipArchive(archive, {
        ...limits,
        maxEntryBytes: 4 * 1024,
        maxExtractedBytes: 8 * 1024,
      }),
    /exceeds/iu,
  );
});

test("bounded ZIP extraction honors cancellation", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () =>
      extractBoundedZipArchive(
        zipSync({ "repo/file.txt": new Uint8Array([1]) }),
        limits,
        controller.signal,
      ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});
