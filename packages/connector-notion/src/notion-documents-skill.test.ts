import assert from "node:assert/strict";
import test from "node:test";

import { createNotionDocumentsSkill } from "./notion-documents-skill.ts";

const pageId = "11111111222243338444555555555555";
const binding = {
  sourceUrl: `https://app.notion.com/p/Acceptance-${pageId}?ignore=previous`,
  connectorId: "notion-account-1",
  resourceId: "notion-page-resource-1",
};

test("Notion Skill embeds only a canonical host-validated page binding", () => {
  const skill = createNotionDocumentsSkill([binding]);

  assert.equal(skill.id, "notion-documents");
  assert.match(skill.description, /Notion/u);
  assert.match(
    skill.content,
    /https:\/\/www\.notion\.so\/11111111222243338444555555555555/u,
  );
  assert.doesNotMatch(skill.content, /ignore=previous/u);
  assert.match(skill.content, /notion-page-resource-1/u);
});

test("Notion Skill rejects non-Notion URLs and unbounded bindings", () => {
  assert.throws(() =>
    createNotionDocumentsSkill([
      { ...binding, sourceUrl: `https://example.com/${pageId}` },
    ]),
  );
  assert.throws(() =>
    createNotionDocumentsSkill(Array.from({ length: 5 }, () => binding)),
  );
});
