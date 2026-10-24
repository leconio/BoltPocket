import {
  EventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";

type DeltaEvent = Extract<
  AssistantMessageEvent,
  { type: "text_delta" | "thinking_delta" | "toolcall_delta" }
>;

export type ModelStreamMetrics = {
  /** Wall-clock time from adapter creation until the upstream stream ended. */
  durationMs: number;
  /** Time to Pi's first parsed stream event, or null when none arrived. */
  timeToFirstEventMs: number | null;
  sourceEventCount: number;
  sourceDeltaEventCount: number;
  sourceDeltaCharacters: number;
  deliveredEventCount: number;
  deliveredDeltaEventCount: number;
  coalescedDeltaEventCount: number;
};

export type ModelStreamCoalescingOptions = {
  /** Zero preserves every upstream delta. */
  intervalMs: number;
  /** Receives counts and timings only; model content is never included. */
  onMetrics?: (metrics: ModelStreamMetrics) => void;
  /** Deterministic clock injection for tests. */
  now?: () => number;
};

function isDeltaEvent(event: AssistantMessageEvent): event is DeltaEvent {
  return (
    event.type === "text_delta" ||
    event.type === "thinking_delta" ||
    event.type === "toolcall_delta"
  );
}

function sameDeltaSegment(left: DeltaEvent, right: DeltaEvent) {
  return left.type === right.type && left.contentIndex === right.contentIndex;
}

function streamFailureMessage(
  model: Model<Api>,
  partial: AssistantMessage | undefined,
  error: unknown,
): AssistantMessage {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (partial) {
    return { ...partial, stopReason: "error", errorMessage };
  }
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

/**
 * Merges adjacent Pi delta events before Agent Core sees them. The final
 * AssistantMessage still comes from the untouched upstream stream, and delta
 * strings are concatenated exactly, so text and tool-call semantics remain
 * unchanged while React Native crosses far fewer Agent Harness boundaries.
 */
export function coalesceAssistantMessageStream(
  source: AssistantMessageEventStream,
  model: Model<Api>,
  options: ModelStreamCoalescingOptions,
): AssistantMessageEventStream {
  if (options.intervalMs === 0 && !options.onMetrics) return source;

  // Metro maps Pi's broad barrel to the mobile-safe shim, which intentionally
  // exports EventStream but not every convenience factory from the Node graph.
  const output = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === "done" || event.type === "error",
    (event) =>
      event.type === "done"
        ? event.message
        : event.type === "error"
          ? event.error
          : streamFailureMessage(model, undefined, "Unexpected stream event"),
  ) as AssistantMessageEventStream;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let firstEventAt: number | undefined;
  let sourceEventCount = 0;
  let sourceDeltaEventCount = 0;
  let sourceDeltaCharacters = 0;
  let deliveredEventCount = 0;
  let deliveredDeltaEventCount = 0;
  let pendingDelta: DeltaEvent | undefined;
  let lastDeltaFlushAt = startedAt;
  let latestPartial: AssistantMessage | undefined;

  const deliver = (event: AssistantMessageEvent) => {
    deliveredEventCount += 1;
    if (isDeltaEvent(event)) deliveredDeltaEventCount += 1;
    output.push(event);
  };
  const flushPendingDelta = (at: number) => {
    if (!pendingDelta) return;
    deliver(pendingDelta);
    pendingDelta = undefined;
    lastDeltaFlushAt = at;
  };
  const reportMetrics = () => {
    if (!options.onMetrics) return;
    const endedAt = now();
    const metrics: ModelStreamMetrics = {
      durationMs: Math.max(0, endedAt - startedAt),
      timeToFirstEventMs:
        firstEventAt === undefined
          ? null
          : Math.max(0, firstEventAt - startedAt),
      sourceEventCount,
      sourceDeltaEventCount,
      sourceDeltaCharacters,
      deliveredEventCount,
      deliveredDeltaEventCount,
      coalescedDeltaEventCount: Math.max(
        0,
        sourceDeltaEventCount - deliveredDeltaEventCount,
      ),
    };
    try {
      options.onMetrics(metrics);
    } catch {
      // Diagnostics must never affect a model run.
    }
  };

  void (async () => {
    try {
      for await (const event of source) {
        const eventAt = now();
        firstEventAt ??= eventAt;
        sourceEventCount += 1;
        if ("partial" in event) latestPartial = event.partial;

        if (isDeltaEvent(event)) {
          sourceDeltaEventCount += 1;
          sourceDeltaCharacters += event.delta.length;
          if (pendingDelta && sameDeltaSegment(pendingDelta, event)) {
            pendingDelta = {
              ...event,
              delta: pendingDelta.delta + event.delta,
            } as DeltaEvent;
          } else {
            flushPendingDelta(eventAt);
            pendingDelta = event;
          }
          if (
            options.intervalMs === 0 ||
            eventAt - lastDeltaFlushAt >= options.intervalMs
          ) {
            flushPendingDelta(eventAt);
          }
          continue;
        }

        flushPendingDelta(eventAt);
        deliver(event);
      }
      flushPendingDelta(now());
      output.end(await source.result());
    } catch (error) {
      flushPendingDelta(now());
      const failure = streamFailureMessage(model, latestPartial, error);
      deliver({ type: "error", reason: "error", error: failure });
      output.end(failure);
    } finally {
      reportMetrics();
    }
  })();

  return output;
}
