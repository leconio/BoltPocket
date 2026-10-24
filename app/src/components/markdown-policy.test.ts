import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownPreviewText,
  normalizeMarkdownUrl,
} from "./markdown-policy.ts";

test("Markdown links allow only explicit credential-free HTTP(S) URLs", () => {
  assert.equal(
    normalizeMarkdownUrl("https://example.com/docs?q=1"),
    "https://example.com/docs?q=1",
  );
  assert.equal(
    normalizeMarkdownUrl(" http://example.com/path "),
    "http://example.com/path",
  );
  assert.equal(normalizeMarkdownUrl("javascript:alert(1)"), null);
  assert.equal(normalizeMarkdownUrl("boltpocket://settings"), null);
  assert.equal(normalizeMarkdownUrl("https://user:secret@example.com"), null);
  assert.equal(normalizeMarkdownUrl("/relative/path"), null);
});

test("Markdown previews remove formatting without exposing link destinations", () => {
  const source = [
    "# **发布计划**",
    "- 阅读 [内部说明](https://private.example/path)",
    "- 检查 `READY_FOR_RELEASE`",
    "![架构图](https://images.example/diagram.png)",
  ].join("\n");

  assert.equal(
    markdownPreviewText(source),
    "发布计划 阅读 内部说明 检查 READY_FOR_RELEASE 架构图",
  );
});

test("Markdown previews preserve ordinary underscores and escaped punctuation", () => {
  assert.equal(
    markdownPreviewText("Use `project_context_read` and \\*literal\\*."),
    "Use project_context_read and *literal*.",
  );
});
