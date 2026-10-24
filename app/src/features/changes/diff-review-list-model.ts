import type { DiffHunk, DiffLine } from "@/domain/models";

export const DIFF_EAGER_LINE_LIMIT = 240;
export const DIFF_LINE_SEGMENT_CHARACTERS = 1_024;

type DiffReviewListSection = {
  endIndex: number;
  expanded: boolean;
  footerIndex: number;
  hunkIndex: number;
  lineRowOffsets: Uint32Array | null;
  lineRowsStartIndex: number;
  startIndex: number;
};

export type DiffReviewListModel = {
  hunks: readonly DiffHunk[];
  sections: readonly DiffReviewListSection[];
  totalItems: number;
};

export type DiffReviewListRow =
  | { hunkIndex: number; kind: "hunk-header" }
  | { hunkIndex: number; kind: "hunk-footer" }
  | {
      hunkIndex: number;
      kind: "line-segment";
      line: DiffLine;
      lineIndex: number;
      segmentCount: number;
      segmentIndex: number;
    };

function lineSegmentCount(line: DiffLine) {
  return Math.max(
    1,
    Math.ceil(line.text.length / DIFF_LINE_SEGMENT_CHARACTERS),
  );
}

function createLineRowOffsets(lines: readonly DiffLine[]) {
  const offsets = new Uint32Array(lines.length + 1);
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) {
    total += lineSegmentCount(lines[index]!);
    if (total > 0xffff_ffff) {
      throw new Error("Diff is too large to index safely.");
    }
    offsets[index + 1] = total;
  }
  return offsets;
}

export function createDiffReviewListModel(
  hunks: readonly DiffHunk[],
  expandedLargeHunkIds: readonly string[],
): DiffReviewListModel {
  const expandedIds = new Set(expandedLargeHunkIds);
  const sections: DiffReviewListSection[] = [];
  let totalItems = 0;

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const hunk = hunks[hunkIndex]!;
    const expanded =
      hunk.lines.length <= DIFF_EAGER_LINE_LIMIT || expandedIds.has(hunk.id);
    const lineRowOffsets = expanded ? createLineRowOffsets(hunk.lines) : null;
    const lineRowCount = lineRowOffsets?.at(-1) ?? 0;
    const startIndex = totalItems;
    const lineRowsStartIndex = startIndex + 1;
    const footerIndex = lineRowsStartIndex + lineRowCount;
    const endIndex = footerIndex + 1;
    sections.push({
      endIndex,
      expanded,
      footerIndex,
      hunkIndex,
      lineRowOffsets,
      lineRowsStartIndex,
      startIndex,
    });
    totalItems = endIndex;
  }

  return { hunks, sections, totalItems };
}

function sectionForIndex(model: DiffReviewListModel, itemIndex: number) {
  let low = 0;
  let high = model.sections.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const section = model.sections[middle]!;
    if (itemIndex < section.startIndex) high = middle - 1;
    else if (itemIndex >= section.endIndex) low = middle + 1;
    else return section;
  }
  throw new Error(`Diff list index ${itemIndex} is out of range.`);
}

function lineIndexForOffset(offsets: Uint32Array, rowOffset: number) {
  let low = 0;
  let high = offsets.length - 2;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = offsets[middle]!;
    const end = offsets[middle + 1]!;
    if (rowOffset < start) high = middle - 1;
    else if (rowOffset >= end) low = middle + 1;
    else return middle;
  }
  throw new Error(`Diff line row offset ${rowOffset} is out of range.`);
}

export function resolveDiffReviewListRow(
  model: DiffReviewListModel,
  itemIndex: number,
): DiffReviewListRow {
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0) {
    throw new Error("Diff list index is invalid.");
  }
  const section = sectionForIndex(model, itemIndex);
  if (itemIndex === section.startIndex) {
    return { hunkIndex: section.hunkIndex, kind: "hunk-header" };
  }
  if (itemIndex === section.footerIndex) {
    return { hunkIndex: section.hunkIndex, kind: "hunk-footer" };
  }
  const offsets = section.lineRowOffsets;
  if (!offsets) throw new Error("Collapsed Diff unexpectedly contains rows.");
  const rowOffset = itemIndex - section.lineRowsStartIndex;
  const lineIndex = lineIndexForOffset(offsets, rowOffset);
  const segmentIndex = rowOffset - offsets[lineIndex]!;
  const line = model.hunks[section.hunkIndex]?.lines[lineIndex];
  if (!line) throw new Error("Diff line is missing from its indexed hunk.");
  return {
    hunkIndex: section.hunkIndex,
    kind: "line-segment",
    line,
    lineIndex,
    segmentCount: offsets[lineIndex + 1]! - offsets[lineIndex]!,
    segmentIndex,
  };
}

export function diffReviewListRowKey(
  model: DiffReviewListModel,
  itemIndex: number,
) {
  const row = resolveDiffReviewListRow(model, itemIndex);
  const hunkId = model.hunks[row.hunkIndex]?.id ?? String(row.hunkIndex);
  if (row.kind !== "line-segment") return `${hunkId}:${row.kind}`;
  return `${hunkId}:line:${row.lineIndex}:segment:${row.segmentIndex}`;
}

export function diffLineSegmentText(text: string, segmentIndex: number) {
  const nominalStart = segmentIndex * DIFF_LINE_SEGMENT_CHARACTERS;
  const nominalEnd = Math.min(
    text.length,
    nominalStart + DIFF_LINE_SEGMENT_CHARACTERS,
  );
  let start = nominalStart;
  let end = nominalEnd;

  // Keep a UTF-16 surrogate pair in the same visual row.
  if (
    start > 0 &&
    start < text.length &&
    text.charCodeAt(start) >= 0xdc00 &&
    text.charCodeAt(start) <= 0xdfff
  ) {
    start -= 1;
  }
  if (
    end > start &&
    end < text.length &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  return text.slice(start, end);
}
