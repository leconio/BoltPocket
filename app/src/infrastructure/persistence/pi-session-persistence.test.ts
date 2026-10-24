import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDurableDocumentStore } from "./document-store.ts";
import { DurablePiSessionPersistence } from "./pi-session-persistence.ts";

test("Pi session trees use an isolated encrypted-document namespace", async () => {
  const documents = new InMemoryDurableDocumentStore();
  const sessions = new DurablePiSessionPersistence(documents);

  await sessions.save("conversation-a", '{"version":1,"entries":[]}');
  await sessions.save("conversation-b", '{"version":1,"entries":[1]}');

  assert.equal(
    await sessions.load("conversation-a"),
    '{"version":1,"entries":[]}',
  );
  assert.equal(
    await sessions.load("conversation-b"),
    '{"version":1,"entries":[1]}',
  );
  await sessions.delete("conversation-a");
  assert.equal(await sessions.load("conversation-a"), undefined);
  assert.ok(await sessions.load("conversation-b"));
});

test("Pi session persistence rejects invalid IDs and oversized trees", async () => {
  const sessions = new DurablePiSessionPersistence(
    new InMemoryDurableDocumentStore(),
  );

  await assert.rejects(sessions.save("", "{}"), /会话标识无效/u);
  await assert.rejects(sessions.save("bad\0id", "{}"), /会话标识无效/u);
  await assert.rejects(
    sessions.save("oversized", "x".repeat(16 * 1024 * 1024 + 1)),
    /加密存储上限/u,
  );
});
