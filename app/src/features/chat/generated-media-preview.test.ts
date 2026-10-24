import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "../../domain/models.ts";
import {
  findGeneratedMediaAttachment,
  mediaReadAccessRoot,
} from "./generated-media-preview.ts";

const messages: ChatMessage[] = [
  {
    id: "assistant-one",
    role: "assistant",
    content: "已生成。",
    context: [],
    attachments: [
      {
        id: "generated-image-one",
        kind: "generated-image",
        uri: "file:///documents/generated/image-one.png",
        name: "image-one.png",
        mimeType: "image/png",
        sizeBytes: 1_024,
        providerName: "Fixture",
        modelId: "image-model",
        createdAt: "2026-08-09T12:00:00.000Z",
      },
      {
        id: "generated-video-one",
        kind: "generated-video",
        uri: "file:///documents/generated/video-one.mp4",
        name: "video-one.mp4",
        mimeType: "video/mp4",
        sizeBytes: 4_096,
        durationSeconds: 4,
        providerName: "Fixture",
        modelId: "video-model",
        createdAt: "2026-08-09T12:00:00.000Z",
      },
    ],
  },
];

test("generated image and video attachments resolve only inside their message", () => {
  assert.equal(
    findGeneratedMediaAttachment(
      messages,
      "assistant-one",
      "generated-image-one",
    )?.kind,
    "generated-image",
  );
  assert.equal(
    findGeneratedMediaAttachment(
      messages,
      "assistant-one",
      "generated-video-one",
    )?.kind,
    "generated-video",
  );
  assert.equal(
    findGeneratedMediaAttachment(
      messages,
      "another-message",
      "generated-video-one",
    ),
    null,
  );
});

test("video preview grants file access only to the containing directory", () => {
  assert.equal(
    mediaReadAccessRoot("file:///documents/generated/video-one.mp4"),
    "file:///documents/generated/",
  );
});
