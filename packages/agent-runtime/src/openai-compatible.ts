import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamSimple as streamSimpleCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { streamSimple as streamSimpleCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamSimpleResponses } from "@earendil-works/pi-ai/api/openai-responses";

import {
  PiAgentRuntime,
  type PiAgentRuntimeOptions,
} from "./pi-agent-runtime.ts";
import type { RuntimeSessionPersistencePort } from "./contracts.ts";
import {
  UPSTREAM_OPENAI_CODEX_MODEL_CAPACITIES,
  UPSTREAM_OPENAI_MODEL_CAPACITIES,
} from "./upstream-openai-model-capacities.generated.ts";
import {
  coalesceAssistantMessageStream,
  type ModelStreamMetrics,
} from "./model-stream-coalescing.ts";

export const OPENAI_CODEX_RUNTIME_BASE_URL =
  "https://chatgpt.com/backend-api" as const;
export type OpenAIProviderKind = "openai-compatible" | "openai-codex";

export type OpenAICompatibleRuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Selects API-key-compatible OpenAI transport or personal Codex OAuth. */
  providerKind?: OpenAIProviderKind;
  /** OpenAI-compatible text protocol exposed by this provider. */
  protocol?: "chat-completions" | "responses";
  contextWindow?: number;
  maxTokens?: number;
  supportsImages?: boolean;
  /** Marks the custom model as reasoning-capable for Pi's thinking levels. */
  reasoning?: boolean;
  /** Whether the endpoint accepts OpenAI-style `reasoning_effort`. */
  supportsReasoningEffort?: boolean;
  /** Per-request timeout. The app-level run timeout remains the outer bound. */
  providerTimeoutMs?: number;
  /** Upstream provider retries for pre-stream transient failures. */
  providerMaxRetries?: number;
  /** Reject provider-requested retry delays above this mobile-safe bound. */
  providerMaxRetryDelayMs?: number;
  /** Upstream coding-agent retries after a retryable assistant-turn failure. */
  assistantMaxRetries?: number;
  /** Base delay for assistant-turn and summarization retries. */
  assistantRetryBaseDelayMs?: number;
  /**
   * Minimum interval between Pi delta updates. Adjacent deltas are concatenated
   * exactly; zero disables coalescing. Defaults to one second for the app's
   * final-answer UI.
   */
  modelEventCoalescingIntervalMs?: number;
  /** Optional content-free counters and timings for each provider stream. */
  onModelStreamMetrics?: (metrics: ModelStreamMetrics) => void;
  contextMaintenance?: PiAgentRuntimeOptions["contextMaintenance"];
  /** Test/host transport injection; production defaults to the platform fetch. */
  fetch?: typeof globalThis.fetch;
  sessionPersistence?: RuntimeSessionPersistencePort;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_MAX_RETRIES = 2;
const DEFAULT_PROVIDER_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_ASSISTANT_MAX_RETRIES = 3;
const DEFAULT_ASSISTANT_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_MODEL_EVENT_COALESCING_INTERVAL_MS = 1_000;
const GENERIC_CONTEXT_WINDOW = 128_000;
const GENERIC_MAX_TOKENS = 8_192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function omitReasoningSummary(
  payload: unknown,
  mode: "codex" | "responses" | "none",
) {
  if (mode === "none" || !isRecord(payload) || !isRecord(payload.reasoning)) {
    return payload;
  }
  const reasoning = { ...payload.reasoning };
  // Providers disagree on whether `off` or `null` is valid. Omitting summary is
  // the portable way to avoid requesting readable reasoning while retaining
  // effort and opaque encrypted continuity for later tool/model turns.
  delete reasoning.summary;
  return {
    ...payload,
    reasoning,
  };
}

/**
 * Reuse the React Native-safe generated view of Pi's pinned model catalog when
 * a custom OpenAI-compatible endpoint exposes a known model. Unknown endpoints
 * retain conservative generic limits.
 */
export function resolveOpenAICompatibleModelCapacity(modelId: string) {
  const normalized = modelId.trim().toLowerCase();
  const upstream = Object.entries(UPSTREAM_OPENAI_MODEL_CAPACITIES).find(
    ([id]) => id.toLowerCase() === normalized,
  )?.[1];
  return {
    contextWindow: upstream?.contextWindow ?? GENERIC_CONTEXT_WINDOW,
    maxTokens: upstream?.maxTokens ?? GENERIC_MAX_TOKENS,
  };
}

export function listOpenAICodexModelIds(): string[] {
  return Object.keys(UPSTREAM_OPENAI_CODEX_MODEL_CAPACITIES);
}

export function resolveOpenAICodexModelCapacity(modelId: string) {
  const normalized = modelId.trim().toLowerCase();
  const upstream = Object.entries(UPSTREAM_OPENAI_CODEX_MODEL_CAPACITIES).find(
    ([id]) => id.toLowerCase() === normalized,
  )?.[1];
  return {
    contextWindow: upstream?.contextWindow ?? GENERIC_CONTEXT_WINDOW,
    maxTokens: upstream?.maxTokens ?? GENERIC_MAX_TOKENS,
    supportsImages: upstream?.supportsImages ?? true,
    reasoning: upstream?.reasoning ?? true,
    thinkingLevelMap: upstream?.thinkingLevelMap,
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return candidate;
}

const zeroCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function normalizeOpenAIBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (url.search || url.hash) {
    throw new Error(
      "OpenAI-compatible base URL cannot contain a query or hash.",
    );
  }
  if (url.pathname === "/") url.pathname = "/v1";
  return url.toString().replace(/\/$/, "");
}

export function createOpenAICompatiblePiRuntime(
  config: OpenAICompatibleRuntimeConfig,
) {
  const useCodex = config.providerKind === "openai-codex";
  const normalizedBaseUrl = normalizeOpenAIBaseUrl(config.baseUrl);
  if (
    useCodex &&
    (normalizedBaseUrl !== OPENAI_CODEX_RUNTIME_BASE_URL ||
      (config.protocol !== undefined && config.protocol !== "responses"))
  ) {
    throw new Error(
      "Codex OAuth is restricted to the official ChatGPT Codex endpoint.",
    );
  }
  const codexCapacity = resolveOpenAICodexModelCapacity(config.modelId);
  const upstreamCapacity = useCodex
    ? codexCapacity
    : resolveOpenAICompatibleModelCapacity(config.modelId);
  const streamOptions = {
    timeoutMs: boundedInteger(
      config.providerTimeoutMs,
      DEFAULT_PROVIDER_TIMEOUT_MS,
      1_000,
      600_000,
      "providerTimeoutMs",
    ),
    maxRetries: boundedInteger(
      config.providerMaxRetries,
      DEFAULT_PROVIDER_MAX_RETRIES,
      0,
      5,
      "providerMaxRetries",
    ),
    maxRetryDelayMs: boundedInteger(
      config.providerMaxRetryDelayMs,
      DEFAULT_PROVIDER_MAX_RETRY_DELAY_MS,
      0,
      60_000,
      "providerMaxRetryDelayMs",
    ),
  };
  const assistantMaxRetries = boundedInteger(
    config.assistantMaxRetries,
    DEFAULT_ASSISTANT_MAX_RETRIES,
    0,
    5,
    "assistantMaxRetries",
  );
  const retry = {
    enabled: assistantMaxRetries > 0,
    maxRetries: assistantMaxRetries,
    baseDelayMs: boundedInteger(
      config.assistantRetryBaseDelayMs,
      DEFAULT_ASSISTANT_RETRY_BASE_DELAY_MS,
      0,
      60_000,
      "assistantRetryBaseDelayMs",
    ),
  };
  const modelEventCoalescingIntervalMs = boundedInteger(
    config.modelEventCoalescingIntervalMs,
    DEFAULT_MODEL_EVENT_COALESCING_INTERVAL_MS,
    0,
    5_000,
    "modelEventCoalescingIntervalMs",
  );
  const sharedModel = {
    id: config.modelId,
    name: config.modelId,
    baseUrl: normalizedBaseUrl,
    reasoning: config.reasoning ?? (useCodex ? codexCapacity.reasoning : false),
    input: ((config.supportsImages ??
    (useCodex ? codexCapacity.supportsImages : true))
      ? ["text", "image"]
      : ["text"]) as ("text" | "image")[],
    cost: zeroCost,
    contextWindow: config.contextWindow ?? upstreamCapacity.contextWindow,
    maxTokens: config.maxTokens ?? upstreamCapacity.maxTokens,
  } as const;
  const completionsModel: Parameters<typeof streamSimpleCompletions>[0] = {
    ...sharedModel,
    api: "openai-completions",
    provider: "boltpocket-openai-compatible",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort:
        config.supportsReasoningEffort ?? config.reasoning ?? false,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
    },
  };
  const responsesModel: Parameters<typeof streamSimpleResponses>[0] = {
    ...sharedModel,
    api: "openai-responses",
    // Pi preserves Responses function_call items only for providers known to
    // use OpenAI's call_id semantics. Compatible endpoints follow that wire
    // contract, so use the upstream OpenAI provider behavior here.
    provider: "openai",
    compat: {
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
      supportsStrictMode: false,
      supportsOpenAIGrammarTools: false,
      supportsToolSearch: false,
      supportsExplicitPromptCacheMode: false,
    },
  };
  const codexModel: Parameters<typeof streamSimpleCodex>[0] = {
    ...sharedModel,
    api: "openai-codex-responses",
    provider: "openai-codex",
    ...(useCodex && codexCapacity.thinkingLevelMap
      ? { thinkingLevelMap: codexCapacity.thinkingLevelMap }
      : {}),
    compat: {
      supportsOpenAIGrammarTools: true,
      supportsToolSearch: true,
    },
  };
  const useResponses = !useCodex && config.protocol === "responses";
  const model = useCodex
    ? codexModel
    : useResponses
      ? responsesModel
      : completionsModel;
  const streamFn: StreamFn = (_runtimeModel, context, options) => {
    const reasoningSummaryMode = useCodex
      ? "codex"
      : useResponses
        ? "responses"
        : "none";
    const commonOptions = {
      ...options,
      timeoutMs: options?.timeoutMs ?? streamOptions.timeoutMs,
      maxRetries: options?.maxRetries ?? streamOptions.maxRetries,
      maxRetryDelayMs:
        options?.maxRetryDelayMs ?? streamOptions.maxRetryDelayMs,
      apiKey: config.apiKey,
      fetch: config.fetch ?? options?.fetch,
      signal: options?.signal,
      onPayload: async (payload: unknown, runtimeModel: Model<Api>) => {
        const transformed = await options?.onPayload?.(payload, runtimeModel);
        return omitReasoningSummary(
          transformed === undefined ? payload : transformed,
          reasoningSummaryMode,
        );
      },
    };
    const source = useCodex
      ? streamSimpleCodex(codexModel, context, {
          ...commonOptions,
          // React Native has no dependable header-capable WebSocket constructor.
          // SSE is fully supported by the same official Codex endpoint.
          transport: "sse",
        })
      : useResponses
        ? streamSimpleResponses(responsesModel, context, commonOptions)
        : streamSimpleCompletions(completionsModel, context, commonOptions);
    return coalesceAssistantMessageStream(source, model, {
      intervalMs: modelEventCoalescingIntervalMs,
      onMetrics: config.onModelStreamMetrics,
    });
  };

  return new PiAgentRuntime({
    model,
    streamFn,
    streamOptions,
    retry,
    contextMaintenance: config.contextMaintenance,
    sessionPersistence: config.sessionPersistence,
  });
}
