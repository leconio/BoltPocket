import type { DiffLine, DiffStats } from "./models.ts";

type Operation = {
  kind: "context" | "addition" | "deletion";
  value: string;
};

function splitLines(content: string) {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function diffOperations(before: string[], after: string[]): Operation[] {
  const lengths = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  );

  for (
    let beforeIndex = before.length - 1;
    beforeIndex >= 0;
    beforeIndex -= 1
  ) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(
              lengths[beforeIndex + 1]![afterIndex]!,
              lengths[beforeIndex]![afterIndex + 1]!,
            );
    }
  }

  const operations: Operation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < before.length || afterIndex < after.length) {
    if (
      beforeIndex < before.length &&
      afterIndex < after.length &&
      before[beforeIndex] === after[afterIndex]
    ) {
      operations.push({ kind: "context", value: before[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const shouldAdd =
      afterIndex < after.length &&
      (beforeIndex >= before.length ||
        lengths[beforeIndex]![afterIndex + 1]! >=
          lengths[beforeIndex + 1]![afterIndex]!);

    if (shouldAdd) {
      operations.push({ kind: "addition", value: after[afterIndex]! });
      afterIndex += 1;
    } else {
      operations.push({ kind: "deletion", value: before[beforeIndex]! });
      beforeIndex += 1;
    }
  }

  return operations;
}

export function createTextDiffLines(
  target: string,
  beforeContent: string,
  afterContent: string,
): DiffLine[] {
  const before = splitLines(beforeContent);
  const after = splitLines(afterContent);

  return [
    { kind: "meta", text: `--- before/${target}` },
    { kind: "meta", text: `+++ after/${target}` },
    {
      kind: "meta",
      text: `@@ -1,${before.length} +1,${after.length} @@`,
    },
    ...diffOperations(before, after).map<DiffLine>((operation) => ({
      kind: operation.kind,
      text: `${
        operation.kind === "addition"
          ? "+"
          : operation.kind === "deletion"
            ? "-"
            : " "
      }${operation.value}`,
    })),
  ];
}

export function getDiffStats(lines: readonly DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "addition") additions += 1;
    else if (line.kind === "deletion") deletions += 1;
  }
  return { additions, deletions, changes: additions + deletions };
}

export function getProposalDiffStats(
  hunks: readonly { lines: readonly DiffLine[] }[],
): DiffStats {
  return hunks.reduce<DiffStats>(
    (total, hunk) => {
      const stats = getDiffStats(hunk.lines);
      return {
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
        changes: total.changes + stats.changes,
      };
    },
    { additions: 0, deletions: 0, changes: 0 },
  );
}
