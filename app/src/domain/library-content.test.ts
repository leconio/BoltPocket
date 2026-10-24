import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GLOBAL_MEMORY_CHARACTERS,
  validateEditableLibraryContent,
} from "./library-content.ts";

test("editable library content accepts Markdown and rejects unsafe or empty text", () => {
  assert.equal(
    validateEditableLibraryContent("skill", "# 检查\n\n- 读取项目。"),
    "# 检查\n\n- 读取项目。",
  );
  assert.throws(
    () => validateEditableLibraryContent("memory", "   "),
    /不能为空/u,
  );
  assert.throws(
    () => validateEditableLibraryContent("skill", "safe\0secret"),
    /纯文本/u,
  );
  assert.throws(
    () =>
      validateEditableLibraryContent(
        "memory",
        "记".repeat(MAX_GLOBAL_MEMORY_CHARACTERS + 1),
      ),
    /不能超过/u,
  );
});
