import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTextFileAttachmentsToPrompt,
  assertChatAttachmentCapacity,
  ChatFileAttachmentError,
  createChatTextFileAttachment,
} from "./chat-file-attachment.ts";

test("a selected text file becomes bounded untrusted Agent context", () => {
  const attachment = createChatTextFileAttachment({
    id: "file-one",
    uri: "file:///notes.md",
    name: "notes.md",
    mimeType: "text/markdown",
    text: "# Notes\n\nInspect this data.",
  });

  assert.equal(attachment.kind, "file");
  assert.equal(attachment.sizeBytes, 27);
  assert.match(
    appendTextFileAttachmentsToPrompt("总结文件", [attachment]),
    /总结文件[\s\S]*待分析数据[\s\S]*附件 1：notes\.md[\s\S]*# Notes/u,
  );
});

test("file attachments reject unsupported, binary and oversized input", () => {
  for (const input of [
    { name: "archive.zip", text: "zip" },
    { name: "notes.txt", text: "bad\0data" },
    { name: "notes.txt", text: "x".repeat(64 * 1024 + 1) },
  ]) {
    assert.throws(
      () =>
        createChatTextFileAttachment({
          id: "file-invalid",
          uri: `file:///${input.name}`,
          ...input,
        }),
      ChatFileAttachmentError,
    );
  }
});

test("draft attachment count and aggregate file bytes stay bounded", () => {
  assert.throws(
    () =>
      assertChatAttachmentCapacity([
        { kind: "image" },
        { kind: "image" },
        { kind: "image" },
        { kind: "image" },
      ]),
    /最多添加 4 个附件/u,
  );
  assert.throws(
    () =>
      assertChatAttachmentCapacity(
        [
          { kind: "file", sizeBytes: 64 * 1024 },
          { kind: "file", sizeBytes: 64 * 1024 },
        ],
        {
          id: "third",
          kind: "file",
          uri: "file:///third.txt",
          name: "third.txt",
          mimeType: "text/plain",
          text: "x",
          sizeBytes: 1,
        },
      ),
    /合计不能超过 128 KB/u,
  );
  assert.throws(
    () =>
      assertChatAttachmentCapacity(
        [{ kind: "image", sizeBytes: 12 * 1024 * 1024 }],
        { kind: "image", sizeBytes: 9 * 1024 * 1024 },
      ),
    /图片合计不能超过 20 MB/u,
  );
});
