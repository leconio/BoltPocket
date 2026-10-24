import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { nativePayload } from "./native-bolt-payload.ts";

const assistant: AssistantMessage = {
  role: "assistant",
  api: "openai-completions",
  provider: "on-device-llama",
  model: "test",
  timestamp: 1,
  stopReason: "toolUse",
  content: [
    {
      type: "toolCall",
      id: "call-1",
      name: "read",
      arguments: { path: "/project/NOTES.md", offset: 10 },
    },
  ],
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

test("native transport preserves the Pi tool result and follow-up history", () => {
  const context: Context = {
    systemPrompt: "Use only the current project.",
    messages: [
      { role: "user", content: "Read my notes", timestamp: 0 },
      assistant,
      {
        role: "toolResult",
        toolName: "read",
        toolCallId: "call-1",
        content: [{ type: "text", text: "Bring an umbrella." }],
        isError: false,
        timestamp: 2,
      },
      {
        role: "user",
        content: [{ type: "text", text: "Turn that into a checklist." }],
        timestamp: 3,
      },
    ],
    tools: [],
  };
  const payload = nativePayload(context);
  assert.deepEqual(
    payload.messages.map((m) => m.role),
    ["system", "user", "assistant", "tool", "user"],
  );
  assert.deepEqual(payload.messages[2]?.tool_calls, [
    {
      id: "call-1",
      type: "function",
      function: {
        name: "read",
        arguments: '{"path":"/project/NOTES.md","offset":10}',
      },
    },
  ]);
  assert.equal(payload.messages[3]?.tool_call_id, "call-1");
  assert.equal(payload.messages[3]?.content, "Bring an umbrella.");
  assert.equal(payload.messages[4]?.content, "Turn that into a checklist.");
});

test("native text transport rejects images without a projector", () => {
  assert.throws(
    () =>
      nativePayload({
        messages: [
          {
            role: "user",
            content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
            timestamp: 0,
          },
        ],
      }),
    /vision projector/u,
  );
});
