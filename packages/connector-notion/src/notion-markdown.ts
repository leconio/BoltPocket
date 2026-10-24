/**
 * Notion's Markdown API stores blocks rather than source whitespace. Empty
 * lines between blocks and trailing source whitespace do not round-trip. Keep
 * fenced-code interiors intact, and bind proposals to the form that Notion
 * returns so the Diff, provider snapshot, and receipt remain identical.
 */
export function canonicalizeNotionMarkdown(value: string) {
  const lines = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const output: string[] = [];
  let fence: "```" | "~~~" | null = null;

  for (const sourceLine of lines) {
    const line = fence ? sourceLine : sourceLine.trimEnd();
    const marker = /^\s*(```|~~~)/u.exec(line)?.[1] as
      "```" | "~~~" | undefined;
    if (fence) {
      output.push(line);
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      output.push(line);
      continue;
    }
    if (!line.trim()) continue;
    output.push(line);
  }

  return output.join("\n");
}
