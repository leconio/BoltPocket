import assert from "node:assert/strict";
import test from "node:test";

import { SkillMarketPublisherBlocklist } from "./skill-market-publisher-blocklist.ts";
import {
  InMemoryDurableDocumentStore,
  type DurableDocumentStore,
} from "../persistence/document-store.ts";

function memoryStore(): DurableDocumentStore {
  return new InMemoryDurableDocumentStore();
}

test("persists stable publisher blocks without duplicate identifiers", async () => {
  const blocklist = new SkillMarketPublisherBlocklist(memoryStore());
  const id = "publisher-boltpocket-official";
  let changes = 0;
  const unsubscribe = blocklist.subscribe(() => {
    changes += 1;
  });
  await blocklist.setBlocked(id, true);
  await blocklist.setBlocked(id, true);
  assert.deepEqual(await blocklist.list(), [id]);
  assert.equal(await blocklist.isBlocked(id), true);
  await blocklist.setBlocked(id, false);
  unsubscribe();
  await blocklist.setBlocked(id, true);
  assert.deepEqual(await blocklist.list(), [id]);
  assert.equal(changes, 3);
});
