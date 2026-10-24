import assert from "node:assert/strict";
import test from "node:test";

import {
  selectProjectMemories,
  selectProjectSkills,
} from "./project-context.ts";
import type { MemoryItem, SkillItem } from "../domain/models.ts";

const memoryItems: MemoryItem[] = [
  {
    id: "global",
    text: "全局记忆",
    scope: "global",
    source: "test",
  },
  {
    id: "launch",
    text: "发布项目记忆",
    scope: "project",
    source: "test",
    projectIds: ["launch"],
  },
  {
    id: "support",
    text: "支持项目记忆",
    scope: "project",
    source: "test",
    projectIds: ["support"],
  },
];

const skillItems: SkillItem[] = [
  {
    id: "planning",
    name: "规划",
    description: "规划项目",
    content: "按依赖顺序规划项目，不修改资源。",
    risk: "read",
    enabled: true,
    scope: "global",
    projectIds: [],
  },
  {
    id: "rewrite",
    name: "改写",
    description: "提出改写",
    content: "读取目标后生成可审阅的文字 Diff。",
    risk: "propose",
    enabled: true,
    scope: "project",
    projectIds: ["launch", "support"],
  },
];

test("project context includes global memory and only its scoped memory", () => {
  assert.deepEqual(
    selectProjectMemories(memoryItems, "launch").map((item) => item.id),
    ["global", "launch"],
  );
});

test("project context includes only enabled in-scope Skills", () => {
  assert.deepEqual(
    selectProjectSkills(skillItems, { planning: false }, "launch", {
      rewrite: true,
    }).map((item) => item.id),
    ["rewrite"],
  );
  assert.deepEqual(
    selectProjectSkills(skillItems, { planning: true }, null, {
      rewrite: true,
    }),
    [],
  );
  assert.deepEqual(
    selectProjectSkills(skillItems, undefined, "launch", undefined).map(
      (item) => item.id,
    ),
    ["planning", "rewrite"],
  );

  assert.deepEqual(
    selectProjectSkills(skillItems, { planning: false }, "launch", {
      planning: true,
      rewrite: false,
    }).map((item) => item.id),
    ["planning"],
  );
  assert.deepEqual(
    selectProjectSkills(skillItems, { planning: true }, "launch", {
      planning: false,
      rewrite: true,
    }).map((item) => item.id),
    ["rewrite"],
  );
});
