import { Type } from "typebox";

import {
  createOpenAICompatiblePiRuntime,
  type ModelStreamMetrics,
  type RuntimeTool,
} from "../src/index.ts";

const apiKey = process.env.BOLTPOCKET_TEST_API_KEY;
const baseUrl = process.env.BOLTPOCKET_TEST_BASE_URL;
const modelId = process.env.BOLTPOCKET_TEST_MODEL;

function sanitizeError(value: string) {
  return value
    .replace(/ak-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api_?key|token)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 1_000);
}

if (!apiKey || !baseUrl || !modelId) {
  throw new Error(
    "BOLTPOCKET_TEST_API_KEY, BOLTPOCKET_TEST_BASE_URL and BOLTPOCKET_TEST_MODEL are required.",
  );
}

const parameters = Type.Object({
  target: Type.String(),
  before: Type.String(),
  after: Type.String(),
  reason: Type.String(),
});
const proposalTool: RuntimeTool<typeof parameters> = {
  name: "propose_text_change",
  label: "Propose text change",
  description:
    "Create a deterministic text change proposal for user review. This never writes the target.",
  risk: "propose",
  parameters,
  execute: async (input) => ({
    content: "The text change proposal is ready for user review.",
    details: input,
  }),
};

const streamMetrics: ModelStreamMetrics[] = [];
const runtime = createOpenAICompatiblePiRuntime({
  apiKey,
  baseUrl,
  modelId,
  onModelStreamMetrics: (metrics) => streamMetrics.push(metrics),
});
const sessionId = `real-model-${Date.now()}`;
await runtime.createSession({
  id: sessionId,
  systemPrompt: [
    "You are the BoltPocket test agent.",
    "For the next user request, call propose_text_change exactly once.",
    "Never claim that content was written; the tool only creates a proposal.",
    "After the tool result, answer with one short sentence.",
  ].join("\n"),
  tools: [proposalTool],
});

const eventTypes: string[] = [];
runtime.subscribe(sessionId, (event) => eventTypes.push(event.type));
const result = await runtime.send(
  sessionId,
  "Change project/plan.txt from 'draft' to 'ready for review'. Use the proposal tool.",
);

try {
  if (result.status !== "completed") {
    throw new Error(
      `Real-model run failed (${result.status}): ${sanitizeError(result.error ?? "unknown error")}`,
    );
  }
  if (
    !result.toolExecutions.some(
      (execution) =>
        execution.toolName === "propose_text_change" && !execution.isError,
    )
  ) {
    throw new Error("The model did not complete the proposal tool call.");
  }

  process.stdout.write(
    `${JSON.stringify({
      status: result.status,
      toolCalls: result.toolExecutions.length,
      streamed: eventTypes.includes("text_delta"),
      eventCount: eventTypes.length,
      sourceDeltaEventCount: streamMetrics.reduce(
        (total, metrics) => total + metrics.sourceDeltaEventCount,
        0,
      ),
      deliveredDeltaEventCount: streamMetrics.reduce(
        (total, metrics) => total + metrics.deliveredDeltaEventCount,
        0,
      ),
      coalescedDeltaEventCount: streamMetrics.reduce(
        (total, metrics) => total + metrics.coalescedDeltaEventCount,
        0,
      ),
    })}\n`,
  );
} finally {
  await runtime.destroySession(sessionId);
}
