import assert from "node:assert/strict";
import test from "node:test";

import {
  getDiffHunkToggleAction,
  isDiffHunkAccepted,
  toggleRejectedDiffHunk,
} from "./diff-review-selection.ts";

test("Diff items default to accepted, so their first action is reject", () => {
  const rejected: string[] = [];

  assert.equal(isDiffHunkAccepted(rejected, "hunk-a"), true);
  assert.equal(getDiffHunkToggleAction(true), "reject");
});

test("reject and accept actions toggle only the selected Diff item", () => {
  const rejected = toggleRejectedDiffHunk([], "hunk-b");

  assert.deepEqual(rejected, ["hunk-b"]);
  assert.equal(isDiffHunkAccepted(rejected, "hunk-b"), false);
  assert.equal(getDiffHunkToggleAction(false), "accept");
  assert.deepEqual(toggleRejectedDiffHunk(rejected, "hunk-b"), []);
});
