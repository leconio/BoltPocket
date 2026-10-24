export type NativeInferenceProgress = {
  tag: string;
  phase: "queued" | "loading" | "restoring" | "prefill" | "decoding";
  cacheOrigin?: "none" | "memory" | "disk";
  promptTokens: number;
  reusedTokens: number;
  processedTokens: number;
  totalTokens: number;
  outputTokens: number;
};

type ProgressEvent = {
  type: string;
  tag?: string;
  prompt_tokens?: number;
  cache_reused_tokens?: number;
  tokens?: number;
  cache_origin?: string;
};

const validCount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1_000_000;

/** Ephemeral counters only: no prompt, generated text or reasoning is stored. */
export class NativeInferenceProgressStore {
  readonly #states = new Map<string, NativeInferenceProgress>();
  readonly #listeners = new Map<string, Set<() => void>>();

  get(sessionId: string) {
    return this.#states.get(sessionId);
  }

  subscribe(sessionId: string, listener: () => void) {
    const listeners = this.#listeners.get(sessionId) ?? new Set<() => void>();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.#listeners.delete(sessionId);
    };
  }

  start(sessionId: string, tag: string) {
    this.#set(sessionId, {
      tag,
      phase: "queued",
      promptTokens: 0,
      reusedTokens: 0,
      processedTokens: 0,
      totalTokens: 0,
      outputTokens: 0,
    });
  }

  loading(sessionId: string, tag: string) {
    const state = this.get(sessionId);
    if (state?.tag === tag)
      this.#set(sessionId, { ...state, phase: "loading" });
  }

  update(sessionId: string, event: ProgressEvent) {
    const state = this.get(sessionId);
    if (!state || event.tag !== state.tag) return;
    if (event.type === "done" || event.type === "error") {
      this.finish(sessionId, state.tag);
    } else if (event.type === "cache_restore_begin") {
      this.#set(sessionId, { ...state, phase: "restoring" });
    } else if (event.type === "begin") {
      const total = event.prompt_tokens,
        reused = event.cache_reused_tokens;
      if (
        !validCount(total) ||
        total === 0 ||
        !validCount(reused) ||
        reused >= total
      )
        return;
      this.#set(sessionId, {
        ...state,
        phase: "prefill",
        promptTokens: total,
        reusedTokens: reused,
        totalTokens: total - reused,
        processedTokens: 0,
        cacheOrigin:
          event.cache_origin === "disk"
            ? "disk"
            : event.cache_origin === "memory"
              ? "memory"
              : "none",
      });
    } else if (
      event.type === "prefill_submitted" &&
      state.phase === "prefill"
    ) {
      if (
        event.prompt_tokens !== state.promptTokens ||
        !validCount(event.tokens) ||
        event.tokens < state.reusedTokens ||
        event.tokens > state.promptTokens
      )
        return;
      this.#set(sessionId, {
        ...state,
        processedTokens: Math.max(
          state.processedTokens,
          event.tokens - state.reusedTokens,
        ),
      });
    } else if (
      event.type === "token" &&
      validCount(event.tokens) &&
      event.tokens > state.outputTokens
    ) {
      this.#set(sessionId, {
        ...state,
        phase: "decoding",
        processedTokens: state.totalTokens,
        outputTokens: event.tokens,
      });
    }
  }

  finish(sessionId: string, tag: string) {
    if (this.get(sessionId)?.tag !== tag) return;
    this.#states.delete(sessionId);
    this.#listeners.get(sessionId)?.forEach((listener) => listener());
  }

  #set(sessionId: string, state: NativeInferenceProgress) {
    this.#states.set(sessionId, state);
    this.#listeners.get(sessionId)?.forEach((listener) => listener());
  }
}

export const nativeInferenceProgress = new NativeInferenceProgressStore();
