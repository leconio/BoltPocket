import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeNotionMarkdown } from "./notion-markdown.ts";

test("Notion markdown canonicalization matches block whitespace round-tripping", () => {
  assert.equal(
    canonicalizeNotionMarkdown("# 标题\r\n\r\n正文  \r\n\r\n"),
    "# 标题\n正文",
  );
});

test("Notion markdown canonicalization preserves fenced-code interiors", () => {
  assert.equal(
    canonicalizeNotionMarkdown("说明\n\n```ts\nconst x = 1;  \n\n```\n\n结束"),
    "说明\n```ts\nconst x = 1;  \n\n```\n结束",
  );
});
