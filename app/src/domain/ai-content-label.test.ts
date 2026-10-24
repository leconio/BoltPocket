import assert from "node:assert/strict";
import test from "node:test";

import { labeledAiGeneratedText } from "./ai-content-label.ts";

test("assistant text keeps an explicit AI label when copied", () => {
  assert.equal(
    labeledAiGeneratedText("完成。", "AI 生成内容"),
    "完成。\n\n【AI 生成内容】",
  );
});
