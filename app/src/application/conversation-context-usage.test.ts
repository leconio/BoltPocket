import assert from "node:assert/strict";
import test from "node:test";

import {
  contextUsageProgress,
  contextWindowOptionAtPosition,
  estimateConversationContextTokens,
  formatCompactTokenCount,
  MODEL_CONTEXT_WINDOW_OPTIONS,
  nearestContextWindowOption,
} from "./conversation-context-usage.ts";

test("context usage progress is empty at zero and closes only at full capacity", () => {
  assert.equal(contextUsageProgress(0, 128_000), 0);
  assert.equal(contextUsageProgress(64_000, 128_000), 0.5);
  assert.equal(contextUsageProgress(128_000, 128_000), 1);
  assert.equal(contextUsageProgress(150_000, 128_000), 1);
  assert.equal(contextUsageProgress(-1, 128_000), 0);
  assert.equal(contextUsageProgress(10, 0), 0);
});

test("context-window helpers keep compact labels and supported slider values", () => {
  assert.equal(formatCompactTokenCount(128_000), "128K");
  assert.equal(formatCompactTokenCount(1_047_576), "1.05M");
  assert.equal(nearestContextWindowOption(130_000), 128_000);
});

test("context-window slider positions use the visible track and clamp continuously", () => {
  const first = MODEL_CONTEXT_WINDOW_OPTIONS[0]!;
  const last = MODEL_CONTEXT_WINDOW_OPTIONS.at(-1)!;
  assert.equal(contextWindowOptionAtPosition(4, 4, 320), first);
  assert.equal(contextWindowOptionAtPosition(-200, 4, 320), first);
  assert.equal(contextWindowOptionAtPosition(324, 4, 320), last);
  assert.equal(contextWindowOptionAtPosition(900, 4, 320), last);

  const middleIndex = Math.round((MODEL_CONTEXT_WINDOW_OPTIONS.length - 1) / 2);
  assert.equal(
    contextWindowOptionAtPosition(164, 4, 320),
    MODEL_CONTEXT_WINDOW_OPTIONS[middleIndex],
  );
});

test("conversation fallback estimation is bounded to visible durable content", () => {
  assert.equal(
    estimateConversationContextTokens([
      { id: "user-1", role: "user", content: "x".repeat(400) },
      { id: "assistant-1", role: "assistant", content: "done" },
    ]),
    165,
  );
});
