import assert from "node:assert/strict";
import test from "node:test";

import { namespacedStorageKey } from "./storage-namespace.ts";

test("storage namespaces preserve global keys and isolate regional records", () => {
  assert.equal(namespacedStorageKey("session-v1"), "session-v1");
  assert.equal(
    namespacedStorageKey("session-v1", "china-mainland"),
    "session-v1.china-mainland",
  );
  assert.throws(() => namespacedStorageKey("session-v1", "../invalid"));
});
