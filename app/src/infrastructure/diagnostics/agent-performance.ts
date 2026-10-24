import {
  beginAgentPerformanceInterval,
  endAgentPerformanceInterval,
  type AgentRunPerformanceOutcome,
} from "@boltpocket/expo-performance-diagnostics";

let nextInterval = 0;

/**
 * Counts only execution mechanics. Prompt text, model output, tool arguments,
 * MCP results, identifiers and credentials never enter the diagnostics path.
 */
export class AgentPerformanceProbe {
  readonly #intervalId = `agent-run-${++nextInterval}`;
  #modelDeltaCount = 0;
  #modelDeltaCharacters = 0;
  #uiFlushCount = 0;
  #toolEventCount = 0;
  #finished = false;

  constructor() {
    beginAgentPerformanceInterval(this.#intervalId);
  }

  recordModelDelta(characterCount: number) {
    this.#modelDeltaCount += 1;
    this.#modelDeltaCharacters += Math.max(0, characterCount);
  }

  recordUiFlush() {
    this.#uiFlushCount += 1;
  }

  recordToolEvent() {
    this.#toolEventCount += 1;
  }

  finish(outcome: AgentRunPerformanceOutcome) {
    if (this.#finished) return;
    this.#finished = true;
    endAgentPerformanceInterval(this.#intervalId, {
      outcome,
      modelDeltaCount: this.#modelDeltaCount,
      modelDeltaCharacters: this.#modelDeltaCharacters,
      uiFlushCount: this.#uiFlushCount,
      toolEventCount: this.#toolEventCount,
    });
  }
}
