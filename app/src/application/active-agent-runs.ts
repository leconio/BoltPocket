import { MAX_ACTIVE_CONVERSATION_RUNS } from "@/domain/app-state";

export type AgentRunTermination =
  "cancelled" | "interrupted" | "timeout" | null;

export type LiveAgentRun = {
  runId: string;
  conversationId: string;
  controller: AbortController;
  termination: AgentRunTermination;
};

export type ReserveAgentRunResult =
  | { accepted: true; run: LiveAgentRun }
  | { accepted: false; reason: "already-active" | "capacity" };

/**
 * Synchronous ownership for live runs. Reserving before any await prevents two
 * nearly simultaneous sends from both observing the same free fourth slot.
 */
export class ActiveAgentRunRegistry {
  readonly #runs = new Map<string, LiveAgentRun>();

  reserve(run: LiveAgentRun): ReserveAgentRunResult {
    if (this.#runs.has(run.conversationId)) {
      return { accepted: false, reason: "already-active" };
    }
    if (this.#runs.size >= MAX_ACTIVE_CONVERSATION_RUNS) {
      return { accepted: false, reason: "capacity" };
    }
    this.#runs.set(run.conversationId, run);
    return { accepted: true, run };
  }

  get(conversationId: string) {
    return this.#runs.get(conversationId) ?? null;
  }

  release(conversationId: string, controller?: AbortController) {
    const run = this.#runs.get(conversationId);
    if (!run || (controller && run.controller !== controller)) return null;
    this.#runs.delete(conversationId);
    return run;
  }

  abort(
    conversationId: string,
    termination: Exclude<AgentRunTermination, null>,
  ) {
    const run = this.#runs.get(conversationId);
    if (!run) return null;
    run.termination = termination;
    run.controller.abort();
    return run;
  }

  abortAll(termination: Exclude<AgentRunTermination, null>) {
    const runs = this.values();
    for (const run of runs) {
      run.termination = termination;
      run.controller.abort();
    }
    return runs;
  }

  conversationIds() {
    return [...this.#runs.keys()];
  }

  values() {
    return [...this.#runs.values()];
  }

  get size() {
    return this.#runs.size;
  }
}
