import {
  PiAgentRuntime,
  type PiAgentRuntimeOptions,
  type RuntimeSessionPersistencePort,
} from "@boltpocket/agent-runtime";
import { nativePayload } from "./native-bolt-payload";
import { nativeInferenceProgress } from "./native-inference-progress";
import {
  EventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import Native from "@boltpocket/expo-bolt-runtime";
import {
  LOCAL_BASE_URL,
  LOCAL_CONTEXT_WINDOW,
  LOCAL_MODEL_ID,
  LOCAL_PROVIDER_ID,
} from "@/config/local-inference";

type StreamFn = PiAgentRuntimeOptions["streamFn"];

export type NativeMetrics = {
  type: string;
  tag?: string;
  text?: string;
  message?: string;
  cancelled?: boolean;
  prompt_tokens?: number;
  cache_reused_tokens?: number;
  tokens?: number;
  cache_origin?: string;
  output_tokens?: number;
  finish_reason?: string;
  ttft_ms?: number;
  total_ms?: number;
  decode_tok_s?: number;
  peak_memory_mib?: number;
  android_pss_mib?: number;
  android_graphics_pss_mib?: number;
  visible_ttft_ms?: number;
  submit_to_visible_ms?: number;
  tool_calls?: { id: string; name: string; arguments: string }[];
};
let loaded: Promise<void> | undefined;
let requestNumber = 0;
let nativeQueue: Promise<unknown> = Promise.resolve();
let activeTag: string | undefined;
let fixtureTag: string | undefined;
let fixtureSubmittedAt: number | undefined;
let fixtureCachePrompt = true;
export function setLocalFixtureTag(tag: string, cachePrompt = true) {
  fixtureTag = tag;
  fixtureSubmittedAt = performance.now();
  fixtureCachePrompt = cachePrompt;
  recordLocalEvent({
    type: "ui_submit",
    tag,
    timestamp: Date.now(),
    cache_prompt: cachePrompt,
  });
}
const listeners = new Set<(metrics: NativeMetrics) => void>();
export function subscribeLocalMetrics(
  listener: (metrics: NativeMetrics) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function recordLocalEvent(value: Record<string, unknown>) {
  Native.record(JSON.stringify(value));
}
export function prepareLocalModelFile() {
  return Native.prepareModelFile();
}

function loadModel() {
  loaded ??= new Promise<void>((resolve, reject) => {
    const sub = Native.addListener("onNativeEvent", ({ json }) => {
      const event = JSON.parse(json) as NativeMetrics;
      if (event.type === "loaded") {
        sub.remove();
        resolve();
      }
      if (event.type === "error") {
        sub.remove();
        loaded = undefined;
        reject(new Error(event.message));
      }
    });
    void Native.load(99).catch((error: unknown) => {
      sub.remove();
      loaded = undefined;
      reject(error);
    });
  });
  return loaded;
}

const nativeStream: StreamFn = (model, context, options) => {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === "done" || event.type === "error",
    (event) =>
      event.type === "done"
        ? event.message
        : event.type === "error"
          ? event.error
          : output,
  );
  let output: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const tag = `${fixtureTag ?? "pi"}-${++requestNumber}`;
  const sessionId = options?.sessionId;
  if (sessionId) nativeInferenceProgress.start(sessionId, tag);
  const submittedAt = fixtureSubmittedAt;
  const cachePrompt = fixtureCachePrompt;
  fixtureTag = undefined;
  fixtureSubmittedAt = undefined;
  fixtureCachePrompt = true;
  let finished = false;
  let subscription: ReturnType<typeof Native.addListener> | undefined;
  const abort = () => {
    if (activeTag === tag) Native.cancel();
  };
  const finishError = (error: unknown) => {
    if (finished) return;
    finished = true;
    if (sessionId) nativeInferenceProgress.finish(sessionId, tag);
    subscription?.remove();
    options?.signal?.removeEventListener("abort", abort);
    output = {
      ...output,
      stopReason: options?.signal?.aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    stream.push({
      type: "error",
      reason: output.stopReason === "aborted" ? "aborted" : "error",
      error: output,
    });
    stream.end(output);
  };
  const job = nativeQueue.then(async () => {
    if (options?.signal?.aborted) throw new Error("cancelled");
    activeTag = tag;
    if (sessionId && !loaded) nativeInferenceProgress.loading(sessionId, tag);
    await loadModel();
    if (options?.signal?.aborted) throw new Error("cancelled");
    const start = performance.now();
    let text = "";
    let first = true;
    let visibleLatency: number | undefined;
    let submitLatency: number | undefined;
    stream.push({ type: "start", partial: output });
    stream.push({ type: "text_start", contentIndex: 0, partial: output });
    subscription = Native.addListener("onNativeEvent", ({ json }) => {
      try {
        const event = JSON.parse(json) as NativeMetrics;
        if (event.tag !== tag) return;
        if (sessionId) nativeInferenceProgress.update(sessionId, event);
        if (event.type === "error") {
          finishError(new Error(event.message));
          return;
        }
        if (event.type === "token") {
          const next = event.text ?? "";
          if (!next || next.endsWith("\ufffd")) return;
          if (first) {
            first = false;
            const now = performance.now();
            visibleLatency = now - start;
            submitLatency =
              submittedAt === undefined ? undefined : now - submittedAt;
            recordLocalEvent({
              type: "js_first_token",
              tag,
              latency_ms: visibleLatency,
              submit_to_visible_ms: submitLatency,
            });
          }
          const delta = next.startsWith(text) ? next.slice(text.length) : next;
          text = next;
          output = { ...output, content: [{ type: "text", text }] };
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta,
            partial: output,
          });
        }
        if (event.type === "done") {
          if (event.cancelled || options?.signal?.aborted) {
            finishError(new Error("cancelled"));
            return;
          }
          text = event.text ?? text;
          const calls = event.tool_calls ?? [];
          output = {
            ...output,
            content: [{ type: "text", text }],
            usage: {
              ...output.usage,
              input: event.prompt_tokens ?? 0,
              output: event.output_tokens ?? 0,
              totalTokens:
                (event.prompt_tokens ?? 0) + (event.output_tokens ?? 0),
            },
            stopReason: calls.length
              ? "toolUse"
              : event.finish_reason === "length"
                ? "length"
                : "stop",
          };
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: text,
            partial: output,
          });
          for (const call of calls) {
            const toolCall = {
              type: "toolCall" as const,
              id: call.id || `local-${requestNumber}-${output.content.length}`,
              name: call.name,
              arguments: JSON.parse(call.arguments || "{}") as Record<
                string,
                unknown
              >,
            };
            const index = output.content.length;
            output = { ...output, content: [...output.content, toolCall] };
            stream.push({
              type: "toolcall_start",
              contentIndex: index,
              partial: output,
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: index,
              toolCall,
              partial: output,
            });
          }
          for (const listener of listeners)
            listener({
              ...event,
              visible_ttft_ms: visibleLatency,
              submit_to_visible_ms: submitLatency,
            });
          finished = true;
          subscription?.remove();
          options?.signal?.removeEventListener("abort", abort);
          stream.push({
            type: "done",
            reason: output.stopReason as "stop" | "length" | "toolUse",
            message: output,
          });
          stream.end(output);
        }
      } catch (error) {
        finishError(error);
      }
    });
    options?.signal?.addEventListener("abort", abort, { once: true });
    await Native.generate(
      JSON.stringify({ ...nativePayload(context), cache_prompt: cachePrompt }),
      Math.min(options?.maxTokens ?? 256, 256),
      tag,
    );
  });
  nativeQueue = job
    .catch(() => undefined)
    .finally(() => {
      if (activeTag === tag) activeTag = undefined;
    });
  void job.catch(finishError);
  return stream;
};

export function createNativePiRuntime(
  sessionPersistence?: RuntimeSessionPersistencePort,
  sessionId?: string,
) {
  const model: Model<"openai-completions"> = {
    id: LOCAL_MODEL_ID,
    name: "Nemotron 3.5 Bolt E4B",
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: LOCAL_BASE_URL,
    reasoning: false,
    input: ["text"],
    contextWindow: LOCAL_CONTEXT_WINDOW,
    maxTokens: 256,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return new PiAgentRuntime({
    model,
    streamFn: (model, context, options) =>
      nativeStream(model, context, { ...options, sessionId }),
    sessionPersistence,
  });
}
