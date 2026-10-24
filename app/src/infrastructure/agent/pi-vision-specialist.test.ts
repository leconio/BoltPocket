import assert from "node:assert/strict";
import test from "node:test";

import { PiVisionSpecialist } from "./pi-vision-specialist.ts";

function textStream(content: string) {
  const chunks = [
    {
      id: "vision-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "vision-model",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        },
      ],
    },
    {
      id: "vision-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "vision-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

test("vision specialist creates an ephemeral no-tool Pi session with only selected images", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    assert.equal(request.stream, true);
    return textStream("可见文字是 TIMEOUT。");
  };
  const specialist = new PiVisionSpecialist({
    locale: () => "en",
    modelConfigProvider: async () => ({
      baseUrl: "https://vision.example/v1",
      model: "vision-model",
      apiKey: "fixture-key",
      contextWindow: 128_000,
      thinkingLevel: "medium",
      providerId: "provider-vision",
      providerKind: "openai-compatible",
      protocol: "chat-completions",
      modelProfileId: "model-vision",
      capabilities: {
        chat: true,
        tools: false,
        vision: true,
        reasoning: false,
        imageGeneration: false,
        videoGeneration: false,
      },
    }),
  });

  try {
    const result = await specialist.analyze({
      taskId: "run-one:tool-one",
      parentRunId: "run-one",
      conversationId: "conversation-one",
      projectId: "project-one",
      question: "读取错误提示",
      attachments: [
        {
          id: "image-one",
          kind: "image",
          uri: "file:///image-one.png",
          name: "image-one.png",
          mimeType: "image/png",
          base64: "aW1hZ2U=",
        },
      ],
    });
    assert.deepEqual(result, {
      content: "可见文字是 TIMEOUT。",
      modelRef: "provider-vision:model-vision",
    });
    assert.equal(requests.length, 1);
    assert.equal(Object.hasOwn(requests[0]!, "tools"), false);
    const serialized = JSON.stringify(requests[0]);
    assert.match(serialized, /data:image\/png;base64,aW1hZ2U=/u);
    assert.match(serialized, /读取错误提示/u);
    assert.match(
      serialized,
      /Reply in English unless the user asks otherwise/u,
    );
    assert.doesNotMatch(serialized, /Reply in Simplified Chinese/u);
    assert.doesNotMatch(serialized, /project-one|conversation-one/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
