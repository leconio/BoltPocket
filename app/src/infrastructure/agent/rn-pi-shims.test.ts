import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCost as upstreamCalculateCost,
  clampThinkingLevel as upstreamClampThinkingLevel,
} from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/models.js";
import { EventStream as UpstreamEventStream } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js";
import { isContextOverflow as upstreamIsContextOverflow } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js";
import { retryAssistantCall as upstreamRetryAssistantCall } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/retry.js";
import { contentText as upstreamContentText } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/text.js";
import { uuidv7 as upstreamUuidv7 } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/uuid.js";
import { validateToolArguments as upstreamValidateToolArguments } from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/utils/validation.js";
import {
  compact as upstreamCompact,
  estimateContextTokens as upstreamEstimateContextTokens,
  estimateTokens as upstreamEstimateTokens,
  prepareCompaction as upstreamPrepareCompaction,
} from "../../../../packages/agent-runtime/node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js";

import {
  EventStream,
  contentText,
  isContextOverflow,
  retryAssistantCall,
  uuidv7,
  validateToolArguments,
} from "./rn-pi-ai-shim.ts";
import { calculateCost, clampThinkingLevel } from "./rn-pi-ai-models-shim.ts";
import {
  compact,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
} from "./rn-pi-agent-core-shim.ts";

test("the React Native Pi barrel directly re-exports pinned upstream primitives", () => {
  assert.equal(compact, upstreamCompact);
  assert.equal(estimateContextTokens, upstreamEstimateContextTokens);
  assert.equal(estimateTokens, upstreamEstimateTokens);
  assert.equal(prepareCompaction, upstreamPrepareCompaction);
  assert.equal(EventStream, UpstreamEventStream);
  assert.equal(contentText, upstreamContentText);
  assert.equal(isContextOverflow, upstreamIsContextOverflow);
  assert.equal(retryAssistantCall, upstreamRetryAssistantCall);
  assert.equal(uuidv7, upstreamUuidv7);
  assert.equal(validateToolArguments, upstreamValidateToolArguments);
});

test("the two isolated models helpers stay behavior-compatible with upstream", () => {
  const model = {
    reasoning: true,
    cost: {
      input: 2,
      output: 4,
      cacheRead: 1,
      cacheWrite: 3,
      tiers: [
        {
          inputTokensAbove: 1_000,
          input: 4,
          output: 8,
          cacheRead: 2,
          cacheWrite: 6,
        },
      ],
    },
    thinkingLevelMap: { max: null },
  };
  const usage = {
    input: 1_200,
    output: 300,
    cacheRead: 50,
    cacheWrite: 20,
    cacheWrite1h: 5,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const localUsage = structuredClone(usage);
  const upstreamUsage = structuredClone(usage);

  assert.deepEqual(
    calculateCost(model, localUsage),
    upstreamCalculateCost(model as never, upstreamUsage as never),
  );
  assert.deepEqual(localUsage, upstreamUsage);
  assert.equal(
    clampThinkingLevel(model, "max"),
    upstreamClampThinkingLevel(model as never, "max"),
  );
});
