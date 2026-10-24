import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { DownloadedSkill } from "@/application/ports/downloaded-skills";
import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";
import { BOLTPOCKET_MARKET_SOURCE } from "@/infrastructure/capabilities/skill-market-client";
import {
  PROTECTED_MARKET_SKILL_PLACEHOLDER,
  ProtectedMarketSkillRepository,
} from "@/infrastructure/capabilities/protected-market-skill-repository";
import { hydrateProtectedMarketSkillsForRun } from "./protected-market-skills.ts";

const document = [
  "---",
  "name: project-review",
  'title: "Project review"',
  'description: "Review a project."',
  "risk: read",
  "---",
  "",
  "# Workflow",
  "",
  "Review the current project.",
].join("\n");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const download: DownloadedSkill = {
  autoUpdate: false,
  catalogId: "project-review",
  installedAt: "2026-08-16T08:00:00.000Z",
  projectId: null,
  resourcePath: "skills/project-review/SKILL.md",
  revision: "1-aabbcc",
  sha256: digest(document),
  skillId: "project-review",
  sourceId: BOLTPOCKET_MARKET_SOURCE.id,
  updatedAt: "2026-08-16T08:00:00.000Z",
};

test("run hydration decrypts only enabled protected Skill placeholders", async () => {
  const repository = new ProtectedMarketSkillRepository(
    new InMemoryDurableDocumentStore(),
    async (value) => digest(value),
  );
  await repository.save({
    id: download.skillId,
    revision: download.revision,
    sha256: download.sha256,
    skillDocument: document,
    source: { ...BOLTPOCKET_MARKET_SOURCE, entryId: download.catalogId },
  });
  const result = await hydrateProtectedMarketSkillsForRun({
    downloads: [download],
    repository,
    skills: [
      {
        content: PROTECTED_MARKET_SKILL_PLACEHOLDER,
        description: "Review a project.",
        enabled: true,
        id: "project-review",
        name: "Project review",
        projectIds: [],
        risk: "read",
        scope: "global",
      },
      {
        content: "Ordinary instructions",
        description: "Ordinary",
        enabled: true,
        id: "ordinary",
        name: "Ordinary",
        projectIds: [],
        risk: "read",
        scope: "global",
      },
    ],
  });
  assert.equal(result.protectedSkillCount, 1);
  assert.deepEqual(result.protectedSkillIds, ["project-review"]);
  assert.equal(
    result.skills[0]?.content,
    "# Workflow\n\nReview the current project.",
  );
  assert.equal(result.skills[1]?.content, "Ordinary instructions");
});

test("run hydration fails closed when protected metadata is missing", async () => {
  const repository = new ProtectedMarketSkillRepository(
    new InMemoryDurableDocumentStore(),
    async (value) => digest(value),
  );
  await assert.rejects(
    hydrateProtectedMarketSkillsForRun({
      downloads: [],
      repository,
      skills: [
        {
          content: PROTECTED_MARKET_SKILL_PLACEHOLDER,
          description: "Review a project.",
          enabled: true,
          id: "project-review",
          name: "Project review",
          projectIds: [],
          risk: "read",
          scope: "global",
        },
      ],
    }),
    /metadata is missing/u,
  );
});
