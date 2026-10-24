import assert from "node:assert/strict";
import test from "node:test";

import { createTextDiffLines, getDiffStats } from "./text-diff.ts";

test("builds a deterministic line diff and counts actual changes", () => {
  const lines = createTextDiffLines(
    "resource.txt",
    "第一行\n旧内容\n最后一行\n",
    "第一行\n新内容\n补充内容\n最后一行\n",
  );

  assert.deepEqual(getDiffStats(lines), {
    additions: 2,
    deletions: 1,
    changes: 3,
  });
  assert.ok(lines.some((line) => line.text === "-旧内容"));
  assert.ok(lines.some((line) => line.text === "+新内容"));
});
