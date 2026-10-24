import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_PROVIDER_KIND,
} from "./codex-provider-constants.ts";
import type {
  ModelProviderKind,
  ModelProviderProtocol,
} from "./model-profile-registry.ts";

export const CUSTOM_MODEL_PROVIDER_PRESET_ID = "custom" as const;

export type ModelProviderPresetNote =
  | "openai-compatible-models-only"
  | "model-or-endpoint-id"
  | "glm-standard-billing"
  | "glm-coding-plan-billing"
  | "volcengine-coding-plan-billing"
  | "volcengine-agent-plan-key";

export const MODEL_PROVIDER_PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
    kind: "openai-compatible",
  },
  {
    id: "openai-codex",
    name: "Codex",
    baseUrl: OPENAI_CODEX_BASE_URL,
    protocol: "responses",
    kind: OPENAI_CODEX_PROVIDER_KIND,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "moonshot-cn",
    name: "Moonshot AI CN",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "qwen",
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "openai-compatible-models-only",
  },
  {
    id: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "glm-standard-billing",
  },
  {
    id: "glm-coding-plan",
    name: "GLM Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "glm-coding-plan-billing",
  },
  {
    id: "volcengine-ark",
    name: "Volcengine Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "model-or-endpoint-id",
  },
  {
    id: "volcengine-ark-coding-plan",
    name: "Volcengine Ark Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "volcengine-coding-plan-billing",
  },
  {
    id: "volcengine-ark-agent-plan",
    name: "Volcengine Ark Agent Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "volcengine-agent-plan-key",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ModelProviderProtocol;
  kind: ModelProviderKind;
  note?: ModelProviderPresetNote;
}[];

export type ModelProviderPreset = (typeof MODEL_PROVIDER_PRESETS)[number];
export type ModelProviderPresetId =
  ModelProviderPreset["id"] | typeof CUSTOM_MODEL_PROVIDER_PRESET_ID;

type ProviderPresetFields = Readonly<{
  name: string;
  baseUrl: string;
  protocol: ModelProviderProtocol;
  kind: ModelProviderKind;
}>;

export type ModelProviderPresetSelection = ProviderPresetFields &
  Readonly<{
    presetId: ModelProviderPresetId;
    apiKeyDraft: string;
    hasStoredApiKey: boolean;
    apiKeyNeedsReplacement: boolean;
  }>;

export function modelProviderPresetById(
  id: ModelProviderPresetId,
): ModelProviderPreset | undefined {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function inferModelProviderPresetId(
  provider: ProviderPresetFields,
): ModelProviderPresetId {
  return (
    MODEL_PROVIDER_PRESETS.find(
      (preset) =>
        preset.baseUrl === provider.baseUrl &&
        preset.protocol === provider.protocol &&
        preset.kind === provider.kind,
    )?.id ?? CUSTOM_MODEL_PROVIDER_PRESET_ID
  );
}

export function applyModelProviderPreset(
  current: ModelProviderPresetSelection,
  presetId: ModelProviderPresetId,
): ModelProviderPresetSelection {
  if (presetId === CUSTOM_MODEL_PROVIDER_PRESET_ID) {
    if (current.kind === "openai-compatible") return { ...current, presetId };
    return {
      ...current,
      presetId,
      kind: "openai-compatible",
      apiKeyDraft: "",
      apiKeyNeedsReplacement: current.hasStoredApiKey,
    };
  }
  const preset = modelProviderPresetById(presetId);
  if (!preset) return { ...current, presetId: CUSTOM_MODEL_PROVIDER_PRESET_ID };
  const endpointChanged =
    current.baseUrl !== preset.baseUrl ||
    current.protocol !== preset.protocol ||
    current.kind !== preset.kind;
  return {
    ...current,
    presetId,
    name: preset.name,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    kind: preset.kind,
    ...(endpointChanged
      ? {
          apiKeyDraft: "",
          apiKeyNeedsReplacement:
            current.apiKeyNeedsReplacement || current.hasStoredApiKey,
        }
      : {}),
  };
}
