import { resolveOpenAICompatibleModelCapacity } from "@boltpocket/agent-runtime";

import {
  normalizeModelBaseUrl,
  normalizeModelThinkingLevel,
  type ModelThinkingLevel,
} from "./model-config-validation.ts";
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_PROVIDER_KIND,
} from "./codex-provider-constants.ts";

export const MODEL_PROVIDER_KINDS = [
  "openai-compatible",
  OPENAI_CODEX_PROVIDER_KIND,
] as const;
export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];

export const MODEL_PROVIDER_PROTOCOLS = [
  "chat-completions",
  "responses",
] as const;
export type ModelProviderProtocol = (typeof MODEL_PROVIDER_PROTOCOLS)[number];

export const MODEL_ROUTE_ROLES = [
  "main",
  "delegate",
  "vision",
  "imageGeneration",
  "videoGeneration",
] as const;
export type ModelRouteRole = (typeof MODEL_ROUTE_ROLES)[number];

export const MODEL_PURPOSES = [
  "chat",
  "delegate",
  "vision",
  "imageGeneration",
  "videoGeneration",
] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export type ModelCapabilities = Readonly<{
  chat: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
}>;

export type ModelProviderProfile = Readonly<{
  id: string;
  name: string;
  kind: ModelProviderKind;
  protocol: ModelProviderProtocol;
  baseUrl: string;
}>;

export type ModelProfile = Readonly<{
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  contextWindow: number;
  purposes: readonly ModelPurpose[];
  capabilities: ModelCapabilities;
}>;

export type ModelRoutes = Readonly<{
  main: string;
  delegate?: string;
  vision?: string;
  imageGeneration?: string;
  videoGeneration?: string;
}>;

export type PublicModelRegistry = Readonly<{
  schema: 6;
  providers: readonly ModelProviderProfile[];
  models: readonly ModelProfile[];
  routes: ModelRoutes;
  thinkingLevel: ModelThinkingLevel;
}>;

export type ModelRegistrySummary = PublicModelRegistry & {
  providerKeyStatus: Readonly<Record<string, boolean>>;
};

export type RoutedModelRuntimeConfig = Readonly<{
  provider: ModelProviderProfile;
  profile: ModelProfile;
  apiKey: string;
  authIdentity?: string;
  fetch?: typeof fetch;
  thinkingLevel: ModelThinkingLevel;
}>;

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = Object.freeze({
  chat: true,
  tools: true,
  vision: true,
  reasoning: true,
  imageGeneration: false,
  videoGeneration: false,
});

export const MIN_MODEL_CONTEXT_WINDOW = 16_384;
export const MAX_MODEL_CONTEXT_WINDOW = 2_000_000;

export function defaultModelContextWindow(modelId: string) {
  return Math.min(
    MAX_MODEL_CONTEXT_WINDOW,
    Math.max(
      MIN_MODEL_CONTEXT_WINDOW,
      resolveOpenAICompatibleModelCapacity(modelId).contextWindow,
    ),
  );
}

export function normalizeModelContextWindow(value: unknown, modelId: string) {
  const candidate = value ?? defaultModelContextWindow(modelId);
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < MIN_MODEL_CONTEXT_WINDOW ||
    candidate > MAX_MODEL_CONTEXT_WINDOW
  ) {
    throw new Error(
      `模型上下文窗口必须为 ${MIN_MODEL_CONTEXT_WINDOW} 到 ${MAX_MODEL_CONTEXT_WINDOW} tokens。`,
    );
  }
  return candidate;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_PROVIDERS = 12;
const MAX_MODELS = 96;
const CAPABILITY_KEYS = [
  "chat",
  "tools",
  "vision",
  "reasoning",
  "imageGeneration",
  "videoGeneration",
] as const satisfies readonly (keyof ModelCapabilities)[];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式无效。`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`${label}包含不支持的字段。`);
  }
}

function safeId(value: unknown, label: string) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label}编号无效。`);
  }
  return value;
}

function visibleText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength || CONTROL_CHARACTERS.test(normalized)) {
    throw new Error(`${label}内容无效。`);
  }
  return normalized;
}

function capabilities(value: unknown): ModelCapabilities {
  const candidate = record(value, "模型能力");
  exactKeys(candidate, CAPABILITY_KEYS, "模型能力");
  const result = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => {
      if (typeof candidate[key] !== "boolean") {
        throw new Error("模型能力必须是明确的布尔值。");
      }
      return [key, candidate[key]];
    }),
  ) as ModelCapabilities;
  if (result.tools && !result.chat) {
    throw new Error("支持工具调用的模型必须同时支持对话。 ");
  }
  if (result.vision && !result.chat) {
    throw new Error("图片识别模型必须同时支持对话。 ");
  }
  return result;
}

function purposes(value: unknown): readonly ModelPurpose[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("模型至少需要选择一个用途。");
  }
  const result = value.map((item) => {
    if (
      typeof item !== "string" ||
      !MODEL_PURPOSES.includes(item as ModelPurpose)
    ) {
      throw new Error("模型用途无效。");
    }
    return item as ModelPurpose;
  });
  if (new Set(result).size !== result.length) {
    throw new Error("模型用途不能重复。");
  }
  return result;
}

function legacyPurposes(
  profile: Pick<ModelProfile, "id" | "capabilities">,
  routes: ModelRoutes,
): readonly ModelPurpose[] {
  const result: ModelPurpose[] = [];
  if (profile.capabilities.chat && profile.capabilities.tools) {
    result.push("chat");
  }
  if (routes.delegate === profile.id) result.push("delegate");
  if (profile.capabilities.vision) result.push("vision");
  if (profile.capabilities.imageGeneration) result.push("imageGeneration");
  if (profile.capabilities.videoGeneration) result.push("videoGeneration");
  return result;
}

function purposeForRoute(role: ModelRouteRole): ModelPurpose {
  return role === "main" ? "chat" : role;
}

function assertPurposeCapabilities(profile: ModelProfile) {
  for (const purpose of profile.purposes) {
    if (
      (purpose === "chat" || purpose === "delegate") &&
      (!profile.capabilities.chat || !profile.capabilities.tools)
    ) {
      throw new Error(
        purpose === "delegate"
          ? "协作模型必须支持对话和工具调用。"
          : "日常对话模型必须支持对话和工具调用。",
      );
    }
    if (
      purpose === "vision" &&
      (!profile.capabilities.chat || !profile.capabilities.vision)
    ) {
      throw new Error("图片理解模型必须支持图片输入。");
    }
    if (
      purpose === "imageGeneration" &&
      !profile.capabilities.imageGeneration
    ) {
      throw new Error("图片生成用途需要对应的模型能力。");
    }
    if (
      purpose === "videoGeneration" &&
      !profile.capabilities.videoGeneration
    ) {
      throw new Error("视频生成用途需要对应的模型能力。");
    }
  }
}

function routeId(value: unknown, label: string, required: boolean) {
  if (value === undefined && !required) return undefined;
  return safeId(value, label);
}

export function validatePublicModelRegistry(
  value: unknown,
): PublicModelRegistry {
  const candidate = record(value, "模型配置");
  exactKeys(
    candidate,
    ["schema", "providers", "models", "routes", "thinkingLevel"],
    "模型配置",
  );
  if (
    candidate.schema !== 2 &&
    candidate.schema !== 3 &&
    candidate.schema !== 4 &&
    candidate.schema !== 5 &&
    candidate.schema !== 6
  ) {
    throw new Error("模型配置版本无效。");
  }
  const legacySchema = candidate.schema === 2;
  const legacyProviderSchema = candidate.schema < 4;
  const legacyContextSchema = candidate.schema < 5;
  if (
    !Array.isArray(candidate.providers) ||
    candidate.providers.length === 0 ||
    candidate.providers.length > MAX_PROVIDERS
  ) {
    throw new Error(`模型服务数量必须为 1 到 ${MAX_PROVIDERS} 个。`);
  }
  if (
    !Array.isArray(candidate.models) ||
    candidate.models.length === 0 ||
    candidate.models.length > MAX_MODELS
  ) {
    throw new Error(`模型数量必须为 1 到 ${MAX_MODELS} 个。`);
  }

  const providerIds = new Set<string>();
  const providers = candidate.providers.map((rawProvider) => {
    const provider = record(rawProvider, "模型服务");
    exactKeys(
      provider,
      legacyProviderSchema
        ? ["id", "name", "kind", "baseUrl"]
        : ["id", "name", "kind", "protocol", "baseUrl"],
      "模型服务",
    );
    const id = safeId(provider.id, "模型服务");
    if (providerIds.has(id)) throw new Error("模型服务编号重复。 ");
    providerIds.add(id);
    if (
      typeof provider.kind !== "string" ||
      !MODEL_PROVIDER_KINDS.some((kind) => kind === provider.kind)
    ) {
      throw new Error("模型服务类型不受支持。 ");
    }
    const protocol = legacyProviderSchema
      ? "chat-completions"
      : provider.protocol;
    if (
      typeof protocol !== "string" ||
      !MODEL_PROVIDER_PROTOCOLS.includes(protocol as ModelProviderProtocol)
    ) {
      throw new Error("模型服务接口协议不受支持。 ");
    }
    const kind = provider.kind as ModelProviderKind;
    const normalizedBaseUrl = normalizeModelBaseUrl(provider.baseUrl);
    if (
      kind === OPENAI_CODEX_PROVIDER_KIND &&
      (protocol !== "responses" || normalizedBaseUrl !== OPENAI_CODEX_BASE_URL)
    ) {
      throw new Error("Codex 登录只支持官方 ChatGPT Codex 服务。");
    }
    return {
      id,
      name: visibleText(provider.name, "模型服务名称", 80),
      kind,
      protocol: protocol as ModelProviderProtocol,
      baseUrl: normalizedBaseUrl,
    };
  });

  const modelIds = new Set<string>();
  let models = candidate.models.map((rawModel) => {
    const model = record(rawModel, "模型");
    exactKeys(
      model,
      legacySchema
        ? ["id", "providerId", "name", "modelId", "capabilities"]
        : legacyContextSchema
          ? ["id", "providerId", "name", "modelId", "purposes", "capabilities"]
          : [
              "id",
              "providerId",
              "name",
              "modelId",
              "contextWindow",
              "purposes",
              "capabilities",
            ],
      "模型",
    );
    const id = safeId(model.id, "模型");
    if (modelIds.has(id)) throw new Error("模型编号重复。 ");
    modelIds.add(id);
    const providerId = safeId(model.providerId, "模型服务");
    if (!providerIds.has(providerId)) {
      throw new Error("模型指向了不存在的服务。 ");
    }
    const modelId = visibleText(model.modelId, "模型 ID", 256);
    return {
      id,
      providerId,
      name: visibleText(model.name, "模型名称", 120),
      modelId,
      contextWindow: normalizeModelContextWindow(
        legacyContextSchema ? undefined : model.contextWindow,
        modelId,
      ),
      purposes: legacySchema
        ? ([] as readonly ModelPurpose[])
        : purposes(model.purposes),
      capabilities: capabilities(model.capabilities),
    };
  });

  const routesValue = record(candidate.routes, "模型路由");
  if (
    Object.keys(routesValue).some(
      (key) => !MODEL_ROUTE_ROLES.includes(key as ModelRouteRole),
    )
  ) {
    throw new Error("模型路由包含不支持的字段。 ");
  }
  const routes: ModelRoutes = {
    main: routeId(routesValue.main, "默认对话模型", true)!,
    ...(routeId(routesValue.delegate, "协作模型", false)
      ? {
          delegate: routeId(routesValue.delegate, "协作模型", false),
        }
      : {}),
    ...(routeId(routesValue.vision, "图片识别模型", false)
      ? { vision: routeId(routesValue.vision, "图片识别模型", false) }
      : {}),
    ...(routeId(routesValue.imageGeneration, "图片生成模型", false)
      ? {
          imageGeneration: routeId(
            routesValue.imageGeneration,
            "图片生成模型",
            false,
          ),
        }
      : {}),
    ...(routeId(routesValue.videoGeneration, "视频生成模型", false)
      ? {
          videoGeneration: routeId(
            routesValue.videoGeneration,
            "视频生成模型",
            false,
          ),
        }
      : {}),
  };
  if (legacySchema) {
    models = models
      .map((profile) => ({
        ...profile,
        purposes: legacyPurposes(profile, routes),
      }))
      .filter((profile) => profile.purposes.length > 0);
  }
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider] as const),
  );
  for (const profile of models) {
    if (
      providersById.get(profile.providerId)?.kind ===
        OPENAI_CODEX_PROVIDER_KIND &&
      (profile.capabilities.imageGeneration ||
        profile.capabilities.videoGeneration ||
        profile.purposes.includes("imageGeneration") ||
        profile.purposes.includes("videoGeneration"))
    ) {
      throw new Error("Codex 服务不支持图片或视频生成用途。");
    }
  }
  for (const profile of models) assertPurposeCapabilities(profile);
  for (const [role, modelId] of Object.entries(routes) as [
    ModelRouteRole,
    string,
  ][]) {
    const model = models.find((item) => item.id === modelId);
    if (!model) throw new Error("模型路由指向了不存在的模型。 ");
    if (
      role === "main" &&
      (!model.capabilities.chat || !model.capabilities.tools)
    ) {
      throw new Error("默认对话模型必须支持对话和工具调用。 ");
    }
    if (
      role === "delegate" &&
      (!model.capabilities.chat || !model.capabilities.tools)
    ) {
      throw new Error("协作模型必须支持对话和工具调用。 ");
    }
    if (role === "vision" && !model.capabilities.vision) {
      throw new Error("图片识别路由必须选择支持视觉的模型。 ");
    }
    if (role === "imageGeneration" && !model.capabilities.imageGeneration) {
      throw new Error("图片生成路由必须选择图片生成模型。 ");
    }
    if (role === "videoGeneration" && !model.capabilities.videoGeneration) {
      throw new Error("视频生成路由必须选择视频生成模型。 ");
    }
    if (!model.purposes.includes(purposeForRoute(role))) {
      throw new Error("模型路由与已选择的用途不一致。 ");
    }
  }

  return {
    schema: 6,
    providers,
    models,
    routes,
    thinkingLevel: normalizeModelThinkingLevel(candidate.thinkingLevel),
  };
}

export function legacyModelRegistry(input: {
  baseUrl: string;
  model: string;
  thinkingLevel: ModelThinkingLevel;
}): PublicModelRegistry {
  return validatePublicModelRegistry({
    schema: 6,
    providers: [
      {
        id: "provider-default",
        name: "默认服务",
        kind: "openai-compatible",
        protocol: "chat-completions",
        baseUrl: input.baseUrl,
      },
    ],
    models: [
      {
        id: "model-default",
        providerId: "provider-default",
        name: input.model,
        modelId: input.model,
        contextWindow: defaultModelContextWindow(input.model),
        purposes: ["chat", "vision"],
        capabilities: DEFAULT_MODEL_CAPABILITIES,
      },
    ],
    routes: { main: "model-default", vision: "model-default" },
    thinkingLevel: input.thinkingLevel,
  });
}

export function resolvePublicModelRoute(
  registry: PublicModelRegistry,
  role: ModelRouteRole,
) {
  const modelId = registry.routes[role];
  if (!modelId) return undefined;
  const profile = registry.models.find((model) => model.id === modelId);
  if (!profile) throw new Error("模型路由已经失效。 ");
  const provider = registry.providers.find(
    (candidate) => candidate.id === profile.providerId,
  );
  if (!provider) throw new Error("模型服务已经失效。 ");
  return { provider, profile };
}

export function resolvePublicModelProfile(
  registry: PublicModelRegistry,
  modelProfileId: string,
) {
  const profile = registry.models.find((model) => model.id === modelProfileId);
  if (!profile) throw new Error("模型已经被删除，请重新选择。");
  const provider = registry.providers.find(
    (candidate) => candidate.id === profile.providerId,
  );
  if (!provider) throw new Error("模型服务已经被删除，请重新选择。");
  return { provider, profile };
}

export function providerApiKeyStorageKey(providerId: string) {
  return `boltpocket.model.provider-key.v2.${safeId(providerId, "模型服务")}`;
}
