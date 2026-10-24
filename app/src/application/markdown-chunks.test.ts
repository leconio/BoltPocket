import assert from "node:assert/strict";
import test from "node:test";

import { chunkMarkdown } from "./markdown-chunks.ts";

test("long Markdown is split into bounded paragraph windows", () => {
  const value = Array.from(
    { length: 80 },
    (_, index) => `## 第 ${index + 1} 节\n\n${"内容".repeat(80)}`,
  ).join("\n\n");
  const chunks = chunkMarkdown(value, 1_000);

  assert.ok(chunks.length > 4);
  assert.equal(
    chunks.every((chunk) => chunk.length <= 1_000),
    true,
  );
  assert.match(chunks[0] ?? "", /第 1 节/u);
  assert.match(chunks.at(-1) ?? "", /第 80 节/u);
});

test("an oversized fenced block is reopened as valid Markdown chunks", () => {
  const chunks = chunkMarkdown(
    `\`\`\`ts\n${"const value = 1;\n".repeat(200)}\`\`\``,
    700,
  );

  assert.ok(chunks.length > 1);
  assert.equal(
    chunks.every(
      (chunk) => chunk.startsWith("```ts\n") && chunk.endsWith("\n```"),
    ),
    true,
  );
});

test("a single very long line is split into virtual-list-sized windows", () => {
  const value = `https://example.com/?payload=${"x".repeat(20_000)}`;
  const chunks = chunkMarkdown(value);

  assert.ok(chunks.length >= 10);
  assert.equal(
    chunks.every((chunk) => chunk.length <= 2_000),
    true,
  );
  assert.equal(chunks.join(""), value);
});
