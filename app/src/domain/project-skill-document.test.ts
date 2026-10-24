import assert from "node:assert/strict";
import test from "node:test";

import { validateProjectSkillDocument } from "./project-skill-document.ts";

const valid = [
  "---",
  "name: release-check",
  'title: "Release check"',
  'description: "Verify a release."',
  "risk: read",
  "---",
  "",
  "# Steps",
  "",
  "Verify the project.",
  "",
].join("\n");

test("project Skill validation binds frontmatter name to its directory", () => {
  assert.equal(
    validateProjectSkillDocument("skills/release-check/SKILL.md", valid).valid,
    true,
  );
  assert.equal(
    validateProjectSkillDocument("skills/different/SKILL.md", valid).valid,
    false,
  );
  assert.equal(
    validateProjectSkillDocument(
      "skills/release-check/SKILL.md",
      "# No frontmatter",
    ).valid,
    false,
  );
});
