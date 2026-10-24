const DEFAULT_MARKDOWN_CHUNK_CHARACTERS = 2_000;

function splitPlainBlock(block: string, maximum: number) {
  const chunks: string[] = [];
  let remaining = block;
  while (remaining.length > maximum) {
    const minimumBreak = Math.floor(maximum * 0.55);
    const newline = remaining.lastIndexOf("\n", maximum);
    const whitespace = remaining.lastIndexOf(" ", maximum);
    const candidate = Math.max(newline, whitespace);
    const cut = candidate >= minimumBreak ? candidate + 1 : maximum;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitFencedBlock(block: string, maximum: number) {
  const lines = block.split("\n");
  const opening = lines[0] ?? "";
  const marker = /^\s*(`{3,}|~{3,})/u.exec(opening)?.[1];
  if (!marker || lines.length < 3) return splitPlainBlock(block, maximum);
  const last = lines.at(-1)?.trim() ?? "";
  if (last !== marker) return splitPlainBlock(block, maximum);
  const body = lines.slice(1, -1).join("\n");
  const wrapperLength = opening.length + marker.length + 2;
  const bodyMaximum = Math.max(256, maximum - wrapperLength);
  return splitPlainBlock(body, bodyMaximum).map(
    (part) => `${opening}\n${part}\n${marker}`,
  );
}

function markdownBlocks(value: string) {
  const blocks: string[] = [];
  const current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const block = current.join("\n").trim();
    current.length = 0;
    if (block) blocks.push(block);
  };

  for (const line of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
    current.push(line);
    if (marker && !fence) fence = marker[0];
    else if (marker && fence && marker[0] === fence) fence = null;
    if (!fence && !line.trim()) flush();
  }
  flush();
  return blocks;
}

/**
 * Splits a completed response into independently renderable Markdown windows.
 * Fenced code is closed and reopened when it is the only oversized block.
 */
export function chunkMarkdown(
  value: string,
  maximum = DEFAULT_MARKDOWN_CHUNK_CHARACTERS,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 512) {
    throw new Error("Markdown chunk size is invalid.");
  }
  const blocks = markdownBlocks(value).flatMap((block) =>
    block.length > maximum
      ? /^\s*(`{3,}|~{3,})/u.test(block)
        ? splitFencedBlock(block, maximum)
        : splitPlainBlock(block, maximum)
      : [block],
  );
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (current && next.length > maximum) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
