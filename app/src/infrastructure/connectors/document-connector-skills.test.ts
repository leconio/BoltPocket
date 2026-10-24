import assert from "node:assert/strict";
import test from "node:test";

import type { ConnectionItem, SkillItem } from "@/domain/models";

import {
  connectorDocumentSkillsForRun,
  mergeRunSkills,
} from "./document-connector-skills.ts";

function connection(id: string, projectId = "project-1"): ConnectionItem {
  return {
    id,
    projectId,
    name: "fixture",
    account: "private@example.com",
    scope: "Private title",
    status: "connected",
    resourceCount: 1,
    access: "persistent",
    writeMode: "recoverable",
  };
}

test("connector-owned Skills mount by project connection with exact prompt bindings", () => {
  const skills = connectorDocumentSkillsForRun({
    projectId: "project-1",
    connections: [
      connection("google-slides-account-1"),
      connection("notion-account-1"),
      connection("google-docs-other", "project-2"),
    ],
    bindings: [
      {
        provider: "google-slides",
        url: "https://docs.google.com/presentation/d/presentation_1234567890/edit",
        connectorId: "google-slides-account-1",
        resourceId: "google-slide-resource-1",
      },
      {
        provider: "notion",
        url: "https://app.notion.com/p/11111111222243338444555555555555",
        connectorId: "notion-account-1",
        resourceId: "notion-page-resource-1",
      },
    ],
  });

  assert.deepEqual(
    skills.map((skill) => skill.id),
    ["google-workspace-documents", "notion-documents"],
  );
  assert.ok(skills.every((skill) => skill.scope === "project"));
  assert.match(skills[0]!.content, /google-slide-resource-1/u);
  assert.match(skills[1]!.content, /notion-page-resource-1/u);
  const serialized = JSON.stringify(skills);
  assert.doesNotMatch(serialized, /private@example\.com|Private title/u);
});

test("connector Skill bindings fail closed outside the active project", () => {
  assert.throws(
    () =>
      connectorDocumentSkillsForRun({
        projectId: "project-1",
        connections: [connection("notion-other", "project-2")],
        bindings: [
          {
            provider: "notion",
            url: "https://www.notion.so/11111111222243338444555555555555",
            connectorId: "notion-other",
            resourceId: "notion-page-resource-1",
          },
        ],
      }),
    /\u4e0d\u5c5e\u4e8e\u5f53\u524d\u9879\u76ee/u,
  );
});

test("connector-owned Skill definitions override same-id catalog entries", () => {
  const stale: SkillItem = {
    id: "notion-documents",
    name: "stale",
    description: "stale",
    content: "stale",
    risk: "read",
    enabled: true,
    scope: "project",
    projectIds: ["project-1"],
  };
  const fresh = { ...stale, name: "connector-owned", risk: "propose" as const };

  assert.deepEqual(mergeRunSkills([stale], [fresh]), [fresh]);
});
