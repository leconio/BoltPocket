import type {
  AgentActivityItem,
  ChatMessage,
  CollaborationTask,
} from "@/domain/models";
import { createStore, type StoreApi } from "zustand/vanilla";

export type LiveAgentOutputSnapshot = Readonly<{
  runId: string | null;
  startedAt: number | null;
  status: string;
  activity: readonly AgentActivityItem[];
  collaboration: readonly CollaborationTask[];
}>;

const EMPTY_LIVE_AGENT_OUTPUT: LiveAgentOutputSnapshot = Object.freeze({
  runId: null,
  startedAt: null,
  status: "",
  activity: Object.freeze([]),
  collaboration: Object.freeze([]),
});

type LiveAgentOutputPatch = Partial<
  Pick<LiveAgentOutputSnapshot, "status" | "activity">
>;

type LiveAgentOutputSlot = {
  readonly api: StoreApi<LiveAgentOutputSnapshot>;
  readonly publicApi: StoreApi<LiveAgentOutputSnapshot>;
  subscribers: number;
  terminal: boolean;
};

/**
 * Ephemeral streaming output deliberately lives outside AppState. A token
 * update must not invalidate every AppContext consumer or enter persistence.
 */
export class LiveAgentOutputStore {
  readonly #slots = new Map<string, LiveAgentOutputSlot>();

  store(conversationId: string): StoreApi<LiveAgentOutputSnapshot> {
    return this.#slot(conversationId).publicApi;
  }

  start(
    conversationId: string,
    runId: string,
    status = "",
    startedAt = Date.now(),
  ) {
    const snapshot: LiveAgentOutputSnapshot = {
      runId,
      startedAt,
      status,
      activity: [],
      collaboration: [],
    };
    const slot = this.#slot(conversationId);
    slot.terminal = false;
    slot.api.setState(snapshot, true);
  }

  updateCollaboration(
    conversationId: string,
    runId: string,
    task: CollaborationTask,
  ) {
    const slot = this.#slots.get(conversationId);
    if (!slot) return false;
    const current = slot.api.getState();
    if (!current || current.runId !== runId) return false;
    const index = current.collaboration.findIndex(
      (item) => item.id === task.id,
    );
    const collaboration = [...current.collaboration];
    if (index === -1) {
      if (collaboration.length >= 3) return false;
      collaboration.push({ ...task });
    } else {
      collaboration[index] = { ...task };
    }
    slot.api.setState({ ...current, collaboration }, true);
    return true;
  }

  update(conversationId: string, runId: string, patch: LiveAgentOutputPatch) {
    const slot = this.#slots.get(conversationId);
    if (!slot) return false;
    const current = slot.api.getState();
    if (!current || current.runId !== runId) return false;
    const activity = patch.activity?.filter((item) => item.kind !== "thinking");
    const next = {
      ...current,
      ...patch,
      ...(activity ? { activity } : {}),
    };
    if (next.status === current.status && next.activity === current.activity) {
      return true;
    }
    slot.api.setState(next, true);
    return true;
  }

  clear(conversationId: string, runId: string) {
    const slot = this.#slots.get(conversationId);
    if (!slot) return false;
    const current = slot.api.getState();
    if (!current || current.runId !== runId) return false;
    slot.terminal = true;
    slot.api.setState(EMPTY_LIVE_AGENT_OUTPUT, true);
    this.#releaseTerminalSlot(conversationId, slot);
    return true;
  }

  clearAll() {
    for (const [conversationId, slot] of this.#slots) {
      slot.terminal = true;
      slot.api.setState(EMPTY_LIVE_AGENT_OUTPUT, true);
      this.#releaseTerminalSlot(conversationId, slot);
    }
  }

  snapshot(conversationId: string): LiveAgentOutputSnapshot {
    return (
      this.#slots.get(conversationId)?.api.getState() ?? EMPTY_LIVE_AGENT_OUTPUT
    );
  }

  subscribe(conversationId: string, listener: () => void) {
    return this.store(conversationId).subscribe(listener);
  }

  activeStoreCount() {
    return this.#slots.size;
  }

  #slot(conversationId: string): LiveAgentOutputSlot {
    const current = this.#slots.get(conversationId);
    if (current) return current;

    const api = createStore<LiveAgentOutputSnapshot>()(
      () => EMPTY_LIVE_AGENT_OUTPUT,
    );
    const slot = {
      api,
      subscribers: 0,
      terminal: true,
    } as LiveAgentOutputSlot;
    const publicApi: StoreApi<LiveAgentOutputSnapshot> = {
      getInitialState: api.getInitialState,
      getState: api.getState,
      setState: api.setState,
      subscribe: (listener) => {
        slot.subscribers += 1;
        const unsubscribe = api.subscribe(listener);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          unsubscribe();
          slot.subscribers -= 1;
          this.#releaseTerminalSlot(conversationId, slot);
        };
      },
    };
    Object.assign(slot, { publicApi });
    this.#slots.set(conversationId, slot);
    return slot;
  }

  #releaseTerminalSlot(conversationId: string, slot: LiveAgentOutputSlot) {
    if (
      slot.terminal &&
      slot.subscribers === 0 &&
      this.#slots.get(conversationId) === slot
    ) {
      this.#slots.delete(conversationId);
    }
  }
}

export function partialAssistantMessageFromLiveOutput(
  snapshot: LiveAgentOutputSnapshot,
  status: "failed" | "cancelled" | "interrupted",
  finishedAt = Date.now(),
): ChatMessage | undefined {
  const activity = snapshot.activity.filter((item) => item.kind !== "thinking");
  if (!snapshot.runId || activity.length === 0) return undefined;
  const unfinishedToolStatus = status === "failed" ? "failed" : "cancelled";
  return {
    id: `assistant-${snapshot.runId}-partial`,
    role: "assistant",
    content: "",
    execution: {
      status,
      durationMs: Math.max(0, finishedAt - (snapshot.startedAt ?? finishedAt)),
      activity: activity.map((item) =>
        (item.kind === "tool" || item.kind === "context") &&
        item.status === "running"
          ? { ...item, status: unfinishedToolStatus }
          : { ...item },
      ),
    },
  };
}
