import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDurableDocumentStore } from "../persistence/document-store.ts";
import { BrowserBookmarkRepository } from "./browser-bookmark-repository.ts";

test("browser bookmarks round-trip through the durable document boundary", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new BrowserBookmarkRepository(store);
  const bookmarks = [
    {
      id: "bookmark-one",
      title: "Example",
      url: "https://example.com/docs",
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ];

  await repository.save(bookmarks);
  assert.deepEqual(await repository.load(), bookmarks);
});

test("browser bookmarks fail closed for malformed stored state", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new BrowserBookmarkRepository(store);
  await store.write("browser:bookmarks:v1", "{not-json");
  await assert.rejects(repository.load(), /无法读取/u);
});
