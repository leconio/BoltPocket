import {
  PiAgentRuntime,
  type PiAgentRuntimeOptions,
  type RuntimeSessionPersistencePort,
} from "@boltpocket/agent-runtime";
import { nativePayload } from "./native-bolt-payload";
import { nativeInferenceProgress } from "./native-inference-progress";
import {
  localOutputTokens,
  MAX_LOCAL_OUTPUT_TOKENS,
} from "./native-output-budget";
import {
  EventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import Native from "@boltpocket/expo-bolt-runtime";
import { Platform } from "react-native";
import {
  artifactSpec,
  localModelById,
  LOCAL_MODELS,
  DEFAULT_LOCAL_MODEL_ID,
  type LocalModel,
} from "../model-config/local-model-catalog";
import {
  LOCAL_BASE_URL,
  LOCAL_CONTEXT_WINDOW,
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
  memory_metric?: "phys_footprint" | "rss";
  android_pss_mib?: number;
  android_graphics_pss_mib?: number;
  visible_ttft_ms?: number;
  submit_to_visible_ms?: number;
  tool_calls?: { id: string; name: string; arguments: string }[];
};
let loaded: Promise<void> | undefined;
let loadedArtifact: string | undefined;
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

function loadModel(model: LocalModel) {
  const identity = model.sha256;
  if (loadedArtifact !== identity) {
    loaded = undefined;
    loadedArtifact = identity;
  }
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
    void Native.loadModelArtifact(
      artifactSpec(model),
      Platform.OS === "ios" ? model.iosGpuLayers : model.androidGpuLayers,
    ).catch((error: unknown) => {
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
    const artifact = LOCAL_MODELS.find(
      (artifact) => artifact.modelId === model.id,
    );
    if (!artifact) throw new Error("Unknown local model");
    if (sessionId && (!loaded || loadedArtifact !== artifact.sha256))
      nativeInferenceProgress.loading(sessionId, tag);
    await loadModel(artifact);
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
      JSON.stringify({
        ...nativePayload(context),
        cache_prompt: cachePrompt,
        sampling: artifact.sampling,
      }),
      localOutputTokens(options?.maxTokens),
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
  modelProfileId = DEFAULT_LOCAL_MODEL_ID as string,
) {
  const artifact = localModelById(modelProfileId);
  const model: Model<"openai-completions"> = {
    id: artifact.modelId,
    name: artifact.name,
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: LOCAL_BASE_URL,
    reasoning: false,
    input: ["text"],
    contextWindow: LOCAL_CONTEXT_WINDOW,
    maxTokens: MAX_LOCAL_OUTPUT_TOKENS,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return new PiAgentRuntime({
    model,
    streamFn: (model, context, options) =>
      nativeStream(model, context, { ...options, sessionId }),
    sessionPersistence,
  });
}
