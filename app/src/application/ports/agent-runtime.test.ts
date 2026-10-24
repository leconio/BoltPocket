import assert from "node:assert/strict";
import test from "node:test";

import { toAssistantMessage, type AgentRunOutput } from "./agent-runtime.ts";

test("assistant messages retain public process text and discard reasoning", () => {
  const output: AgentRunOutput = {
    content: "最终结果",
    activity: [
      {
        id: "legacy-thinking",
        kind: "thinking",
        content: "private chain of thought",
      },
      {
        id: "public-update",
        kind: "text",
        content: "我先读取项目上下文。",
      },
      {
        id: "read-tool",
        kind: "tool",
        label: "读取项目上下文",
        status: "completed",
      },
    ],
    context: [],
  };

  const message = toAssistantMessage("run-1", output, {
    status: "completed",
    durationMs: 1_250,
  });

  assert.equal(message.content, "最终结果");
  assert.deepEqual(message.execution?.activity, output.activity?.slice(1));
});
