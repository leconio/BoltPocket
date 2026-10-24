import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { PiTextSpecialist } from "./pi-text-specialist.ts";

function textStream(content: string) {
  const chunks = [
    {
      id: "delegate-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "delegate-model",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        },
      ],
    },
    {
      id: "delegate-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "delegate-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

test("text specialist creates a fresh role-scoped Pi session with only delegated tools and task", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    assert.equal(request.stream, true);
    return textStream("结论是 TIMEOUT。");
  };
  const specialist = new PiTextSpecialist({
    locale: () => "en",
    modelConfigProvider: async () => ({
      baseUrl: "https://delegate.example/v1",
      model: "delegate-model",
      apiKey: "fixture-key",
      contextWindow: 128_000,
      thinkingLevel: "medium",
      providerId: "provider-delegate",
      providerKind: "openai-compatible",
      protocol: "chat-completions",
      modelProfileId: "model-delegate",
      capabilities: {
        chat: true,
        tools: true,
        vision: false,
        reasoning: false,
        imageGeneration: false,
        videoGeneration: false,
      },
    }),
  });

  try {
    const result = await specialist.execute({
      taskId: "run-one:tool-one:alpha",
      parentRunId: "run-one",
      conversationId: "conversation-private",
      projectId: "project-private",
      role: "scout",
      instruction: "在项目中查找请求超时处理，并归纳故障类别。",
      tools: [
        {
          name: "read",
          label: "Read",
          description: "Read an authorized project file.",
          risk: "read",
          parameters: Type.Object({ path: Type.String() }),
          execute: async () => ({ content: "fixture", details: {} }),
        },
      ],
    });
    assert.deepEqual(result, {
      content: "结论是 TIMEOUT。",
      modelRef: "provider-delegate:model-delegate",
      toolActivity: [],
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(
      (requests[0]!.tools as { function: { name: string } }[]).map(
        (tool) => tool.function.name,
      ),
      ["read"],
    );
    const serialized = JSON.stringify(requests[0]);
    assert.match(serialized, /查找请求超时处理|project scout/iu);
    assert.doesNotMatch(serialized, /project-private|conversation-private/u);
    assert.match(serialized, /do not inherit the parent conversation/iu);
    assert.match(
      serialized,
      /Reply in English unless the user asks otherwise/u,
    );
    assert.doesNotMatch(serialized, /Reply in Simplified Chinese/u);
    assert.match(
      serialized,
      /credentials.*browser.*write tools.*other Agents/iu,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
