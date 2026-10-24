import assert from "node:assert/strict";
import test from "node:test";

import type { DiffHunk } from "../../domain/models.ts";
import {
  createDiffReviewListModel,
  DIFF_EAGER_LINE_LIMIT,
  DIFF_LINE_SEGMENT_CHARACTERS,
  diffLineSegmentText,
  diffReviewListRowKey,
  resolveDiffReviewListRow,
} from "./diff-review-list-model.ts";

function hunk(id: string, lineTexts: readonly string[]): DiffHunk {
  return {
    after: "",
    baseVersion: "1",
    before: "",
    id,
    lines: lineTexts.map((text) => ({ kind: "context", text })),
    resourceId: `resource-${id}`,
    summary: "summary",
    target: `${id}.txt`,
  };
}

test("Diff list indexes thousands of rows without flattening their objects", () => {
  const lines = Array.from({ length: 5_000 }, (_, index) => `line-${index}`);
  const largeHunk = hunk("large", lines);
  const collapsed = createDiffReviewListModel([largeHunk], []);

  assert.equal(DIFF_EAGER_LINE_LIMIT < lines.length, true);
  assert.equal(collapsed.totalItems, 2);
  assert.equal(resolveDiffReviewListRow(collapsed, 0).kind, "hunk-header");
  assert.equal(resolveDiffReviewListRow(collapsed, 1).kind, "hunk-footer");

  const expanded = createDiffReviewListModel([largeHunk], [largeHunk.id]);
  assert.equal(expanded.totalItems, lines.length + 2);
  const finalLine = resolveDiffReviewListRow(expanded, lines.length);
  assert.deepEqual(finalLine, {
    hunkIndex: 0,
    kind: "line-segment",
    line: largeHunk.lines.at(-1),
    lineIndex: lines.length - 1,
    segmentCount: 1,
    segmentIndex: 0,
  });
});

test("a multi-thousand-character physical line becomes virtual rows", () => {
  const text = `+${"x".repeat(DIFF_LINE_SEGMENT_CHARACTERS * 4 + 37)}`;
  const longLineHunk = hunk("long-line", [text]);
  const model = createDiffReviewListModel([longLineHunk], []);

  assert.equal(model.totalItems, 7);
  const segments = Array.from({ length: 5 }, (_, segmentIndex) => {
    const row = resolveDiffReviewListRow(model, segmentIndex + 1);
    assert.equal(row.kind, "line-segment");
    return row.kind === "line-segment"
      ? diffLineSegmentText(row.line.text, row.segmentIndex)
      : "";
  });
  assert.equal(segments.join(""), text);
  assert.equal(
    new Set(segments.map((segment) => segment.length)).has(0),
    false,
  );
  assert.match(diffReviewListRowKey(model, 5), /segment:4$/u);
});

test("line segments preserve emoji surrogate pairs at boundaries", () => {
  const prefix = "a".repeat(DIFF_LINE_SEGMENT_CHARACTERS - 1);
  const text = `${prefix}🙂tail`;
  const model = createDiffReviewListModel([hunk("unicode", [text])], []);
  const first = resolveDiffReviewListRow(model, 1);
  const second = resolveDiffReviewListRow(model, 2);
  assert.equal(first.kind, "line-segment");
  assert.equal(second.kind, "line-segment");
  if (first.kind !== "line-segment" || second.kind !== "line-segment") return;
  assert.equal(
    diffLineSegmentText(first.line.text, first.segmentIndex) +
      diffLineSegmentText(second.line.text, second.segmentIndex),
    text,
  );
});
