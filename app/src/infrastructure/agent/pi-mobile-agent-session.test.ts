import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRunInput } from "@/application/ports/agent-runtime";

import {
  createContextReferences,
  createSessionResources,
  createSessionSystemPrompt,
} from "./pi-mobile-agent-session.ts";

const input: AgentRunInput = {
  runId: "run-localized-session",
  conversationId: "conversation-localized-session",
  prompt: "Continue",
  project: {
    id: "localized-project",
    name: "Localized project",
    symbol: "LP",
    description: "",
    instructions: "Keep the result concise.",
    memoryCount: 2,
    skillCount: 2,
    connectionCount: 1,
    resourceCount: 0,
  },
  memories: [
    {
      id: "memory-one",
      text: "First preference",
      scope: "project",
      source: "MEMORY.md",
      projectIds: ["localized-project"],
    },
    {
      id: "memory-two",
      text: "Second preference",
      scope: "project",
      source: "MEMORY.md",
      projectIds: ["localized-project"],
    },
  ],
  skills: [
    {
      id: "skill-one",
      name: "First Skill",
      description: "First",
      content: "# First",
      risk: "read",
      enabled: true,
      scope: "project",
      projectIds: ["localized-project"],
    },
    {
      id: "skill-two",
      name: "Second Skill",
      description: "Second",
      content: "# Second",
      risk: "read",
      enabled: true,
      scope: "project",
      projectIds: ["localized-project"],
    },
  ],
  resources: [],
  attachments: [],
};

test("the session prompt follows the selected app language", () => {
  const prompt = createSessionSystemPrompt(
    input,
    createSessionResources(input),
    false,
    false,
    false,
    false,
    false,
    false,
    [],
    null,
    null,
    "en",
  );

  assert.match(prompt, /Reply in English unless the user asks otherwise\./u);
  assert.doesNotMatch(prompt, /Reply in Simplified Chinese/u);
});

test("the session prompt keeps Skill bodies on demand and routes authoring through its Skill", () => {
  const authoringInput: AgentRunInput = {
    ...input,
    skills: [
      ...input.skills,
      {
        id: "skill-authoring",
        name: "Skill authoring",
        description: "Create and update project Skills.",
        content: "# Skill authoring\n\nValidate the staged document.",
        risk: "propose",
        enabled: true,
        scope: "global",
        projectIds: [],
      },
    ],
  };
  const prompt = createSessionSystemPrompt(
    authoringInput,
    createSessionResources(authoringInput),
    false,
    false,
    false,
    false,
    false,
    false,
    [],
    null,
    null,
    "en",
  );

  assert.doesNotMatch(prompt, /capability_catalog|Skill sources|MCP sources/u);
  assert.match(prompt, /load skill-authoring/u);
  assert.doesNotMatch(prompt, /# First|# Second|Validate the staged document/u);
  assert.match(prompt, /Specialized tools linked to that Skill are hidden/u);
});

test("product-owned context references follow the selected app language", () => {
  assert.deepEqual(createContextReferences(input, "en"), [
    {
      id: "localized-project-memory-context",
      kind: "memory",
      label: "Memories 2",
      detail: "First preference; Second preference",
    },
    {
      id: "localized-project-skill-context",
      kind: "skill",
      label: "Skills 2",
      detail: "First Skill, Second Skill",
    },
    {
      id: "localized-project-connection-context",
      kind: "connection",
      label: "Connections 1",
      detail: "Limited to the current project’s authorized scope",
    },
  ]);
});
