import assert from "node:assert/strict";

import { Type } from "typebox";

import type { RuntimeTool } from "../src/contracts.ts";
import { createOpenAICompatiblePiRuntime } from "../src/openai-compatible.ts";

const apiKey = process.env.ARK_API_KEY?.trim();
if (!apiKey) throw new Error("ARK_API_KEY is required.");

const parameters = Type.Object(
  { a: Type.Integer(), b: Type.Integer() },
  { additionalProperties: false },
);
let executed = "";
const multiply: RuntimeTool<typeof parameters> = {
  name: "multiply",
  label: "Multiply",
  description: "Multiply two integers exactly.",
  risk: "read",
  parameters,
  execute: async ({ a, b }) => {
    executed = `${a}×${b}`;
    return { content: String(a * b), details: { a, b } };
  },
};

const runtime = createOpenAICompatiblePiRuntime({
  baseUrl:
    process.env.ARK_BASE_URL?.trim() ??
    "https://ark.cn-beijing.volces.com/api/plan/v3",
  apiKey,
  modelId: process.env.ARK_MODEL?.trim() ?? "doubao-seed-2.0-pro",
  protocol: "responses",
  supportsImages: false,
  reasoning: true,
  supportsReasoningEffort: true,
  providerTimeoutMs: 120_000,
});

try {
  await runtime.createSession({
    id: "ark-responses-live-smoke",
    systemPrompt:
      "You must use multiply for arithmetic. Return a short final answer.",
    tools: [multiply],
    thinkingLevel: "medium",
  });
  const result = await runtime.send(
    "ark-responses-live-smoke",
    "必须调用 multiply 计算 7 乘 8，然后给出结果。",
  );
  assert.equal(result.status, "completed");
  assert.equal(executed, "7×8");
  assert.equal(result.toolExecutions.length, 1);
  assert.match(result.text, /56/u);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      protocol: "responses",
      tool: "multiply",
      toolResult: executed,
      response: result.text,
    })}\n`,
  );
} finally {
  await runtime
    .destroySession("ark-responses-live-smoke")
    .catch(() => undefined);
}
