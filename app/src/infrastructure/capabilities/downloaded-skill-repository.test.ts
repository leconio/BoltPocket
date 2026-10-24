import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";
import { DownloadedSkillRepository } from "./downloaded-skill-repository.ts";

const item = {
  autoUpdate: true,
  catalogId: "project-review",
  installedAt: "2026-08-13T08:00:00.000Z",
  projectId: "project-1",
  resourcePath: "skills/project-review/SKILL.md",
  revision: "2026.08.13.1",
  sha256: "a".repeat(64),
  skillId: "project-review",
  sourceId: "boltpocket",
  updatedAt: "2026-08-13T08:00:00.000Z",
} as const;

test("downloaded Skill repository upserts only minimal source metadata", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new DownloadedSkillRepository(store);
  await repository.save(item);
  await repository.save({
    ...item,
    autoUpdate: false,
    revision: "2026.08.13.2",
    updatedAt: "2026-08-13T09:00:00.000Z",
  });
  assert.deepEqual(await repository.list(), [
    {
      ...item,
      autoUpdate: false,
      revision: "2026.08.13.2",
      updatedAt: "2026-08-13T09:00:00.000Z",
    },
  ]);
  await repository.remove(item.projectId, item.skillId);
  assert.deepEqual(await repository.list(), []);
});

test("installed inventory metadata is distinct from every project copy", async () => {
  const repository = new DownloadedSkillRepository(
    new InMemoryDurableDocumentStore(),
  );
  const inventoryItem = { ...item, projectId: null };

  await repository.save(item);
  await repository.save(inventoryItem);

  assert.deepEqual(await repository.list(), [inventoryItem, item]);
  await repository.remove(null, item.skillId);
  assert.deepEqual(await repository.list(), [item]);
});

test("downloaded Skill repository fails closed on malformed records", async () => {
  const store = new InMemoryDurableDocumentStore();
  await store.write(
    "skills:downloads:manifest:v1",
    JSON.stringify({
      version: 2,
      items: [{ ...item, resourcePath: "../outside/SKILL.md" }],
    }),
  );
  await assert.rejects(
    new DownloadedSkillRepository(store).list(),
    /清单无效/u,
  );
});

test("downloaded Skill repository migrates first-party version one records", async () => {
  const store = new InMemoryDurableDocumentStore();
  const { sourceId: _sourceId, ...legacy } = item;
  await store.write(
    "skills:downloads:manifest:v1",
    JSON.stringify({ items: [legacy], version: 1 }),
  );
  assert.deepEqual(await new DownloadedSkillRepository(store).list(), [item]);
});

test("downloaded Skill repository serializes concurrent saves", async () => {
  const repository = new DownloadedSkillRepository(
    new InMemoryDurableDocumentStore(),
  );
  await Promise.all([
    repository.save(item),
    repository.save({
      ...item,
      catalogId: "release-check",
      resourcePath: "skills/release-check/SKILL.md",
      skillId: "release-check",
    }),
  ]);

  assert.deepEqual(
    (await repository.list()).map((entry) => entry.skillId),
    ["project-review", "release-check"],
  );
});
