import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleWorkspaceDocumentsSkill } from "./google-workspace-documents-skill.ts";

const binding = {
  provider: "google-sheets" as const,
  sourceUrl:
    "https://docs.google.com/spreadsheets/d/spreadsheet_1234567890/edit?usp=sharing#gid=42",
  connectorId: "google-sheets-account-1",
  resourceId: "google-sheet-resource-1",
};

test("Google Workspace Skill embeds only a canonical host-validated link binding", () => {
  const skill = createGoogleWorkspaceDocumentsSkill([binding]);

  assert.equal(skill.id, "google-workspace-documents");
  assert.match(skill.description, /Google Docs/u);
  assert.match(
    skill.content,
    /https:\/\/docs\.google\.com\/spreadsheets\/d\/spreadsheet_1234567890#gid=42/u,
  );
  assert.doesNotMatch(skill.content, /usp=sharing/u);
  assert.match(skill.content, /google-sheet-resource-1/u);
});

test("Google Workspace Skill rejects mismatched providers and unbounded bindings", () => {
  assert.throws(() =>
    createGoogleWorkspaceDocumentsSkill([
      {
        ...binding,
        provider: "google-docs",
      },
    ]),
  );
  assert.throws(() =>
    createGoogleWorkspaceDocumentsSkill(
      Array.from({ length: 5 }, () => binding),
    ),
  );
});
