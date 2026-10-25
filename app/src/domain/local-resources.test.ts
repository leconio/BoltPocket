import assert from "node:assert/strict";
import test from "node:test";
import { isLocalResourceStorage } from "./local-resources.ts";

test("legacy cloud resources never become writable local files after removing hosted connectors", () => {
  for (const kind of [
    "memory",
    "project-workspace",
    "native-file",
    "source-file",
  ] as const) {
    assert.equal(isLocalResourceStorage(kind), true);
  }
  for (const kind of [
    "google-doc",
    "google-sheet",
    "google-slide",
    "notion-page",
  ] as const) {
    assert.equal(isLocalResourceStorage(kind), false);
  }
});
