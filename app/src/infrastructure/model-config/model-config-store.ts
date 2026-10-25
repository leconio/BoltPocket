import * as SecureStore from "expo-secure-store";
import { LOCAL_INFERENCE } from "@/config/local-inference";
import { localProfileFor, localProvider, loadLocalRegistry, loadLocalRuntimeConfig } from "./local-model";
import { listOpenAICodexModelIds } from "@boltpocket/agent-runtime";

import {
  assertModelEndpointPermittedForDistribution,
  assertModelPermittedForDistribution,
  loadComplianceConfig,
} from "@/config/compliance";
import { createMutableSingleFlightLoader } from "@/infrastructure/persistence/single-flight-loader";

import {
  probeModelCapabilities,
  type ModelCapabilityProbeOptions,
  type ModelCapabilityProbeResult,
} from "./model-capability-probe.ts";
import {
  testModelConnection,
  type ModelConnectionResult,
  type ModelConnectionTestOptions,
} from "./model-connection.ts";
import {
  discoverModelNames,
  type ModelDiscoveryOptions,
} from "./model-discovery.ts";
import {
  type ModelThinkingLevel,
  type ModelRuntimeConfig,
  type PublicModelConfig,
  normalizeModelBaseUrl,
  validateModelConfig,
  validatePublicModelConfig,
} from "./model-config-validation.ts";
import {
  CodexDeviceOAuthError,
  type CodexAuthorization,
} from "./codex-device-oauth.ts";
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_PROVIDER_KIND,
} from "./codex-provider-constants.ts";
import { codexDeviceOAuth } from "./expo-codex-device-oauth.ts";
import {
  legacyModelRegistry,
  providerApiKeyStorageKey,
  resolvePublicModelProfile,
  resolvePublicModelRoute,
  validatePublicModelRegistry,
  type ModelCapabilities,
  type ModelProviderKind,
  type ModelProviderProfile,
  type ModelRegistrySummary,
  type ModelRouteRole,
  type PublicModelRegistry,
  type RoutedModelRuntimeConfig,
} from "./model-profile-registry.ts";

const LEGACY_PUBLIC_CONFIG_KEY = "boltpocket.model.public.v1";
const LEGACY_API_KEY_KEY = "boltpocket.model.api-key.v1";
const REGISTRY_CONFIG_KEY = "boltpocket.model.registry.v2";
const KEYCHAIN_SERVICE = "dev.boltpocket.app.model-config";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: KEYCHAIN_SERVICE,
};

export const MODEL_API_KEY_MASK = "••••••••••••";

export type ModelConfigSummary = PublicModelConfig & {
  contextWindow: number;
  hasApiKey: boolean;
  apiKeyMask: typeof MODEL_API_KEY_MASK | null;
};

export type SaveModelConfigInput = PublicModelConfig & {
  /** Omit to keep the currently saved key. A supplied value replaces it. */
  apiKey?: string;
};

export type SaveModelRegistryInput = Readonly<{
  registry: PublicModelRegistry;
  /** Omitted provider ids keep their current key. */
  apiKeys?: Readonly<Record<string, string | undefined>>;
}>;

export type ResolvedModelRuntimeConfig = ModelRuntimeConfig & {
  contextWindow: number;
  providerId: string;
  providerKind: ModelProviderKind;
  protocol: "chat-completions" | "responses";
  modelProfileId: string;
  capabilities: ModelCapabilities;
  /** Stable account identity keeps runtime sessions across token rotations. */
  authIdentity?: string;
  /** Provider-scoped transport that refreshes and isolates OAuth credentials. */
  fetch?: typeof fetch;
};

export class ModelConfigStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigStorageError";
  }
}

async function assertSecureStoreAvailable() {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new ModelConfigStorageError(
      "当前设备不支持安全存储，无法保存模型凭据。",
    );
  }
}

function decodeLegacyPublicConfig(value: string): PublicModelConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ModelConfigStorageError("已保存的模型配置无法读取，请先清除。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ModelConfigStorageError("已保存的模型配置格式无效，请先清除。");
  }
  const record = parsed as Record<string, unknown>;
  try {
    return validatePublicModelConfig({
      baseUrl: record.baseUrl,
      model: record.model,
      thinkingLevel: record.thinkingLevel,
    });
  } catch {
    throw new ModelConfigStorageError("已保存的模型配置格式无效，请先清除。");
  }
}

function decodeRegistry(value: string): PublicModelRegistry {
  try {
    return validatePublicModelRegistry(JSON.parse(value) as unknown);
  } catch {
    throw new ModelConfigStorageError("已保存的模型配置格式无效，请先清除。");
  }
}

type StoredRegistry = {
  registry: PublicModelRegistry;
  apiKeys: Map<string, string | null>;
  source: "v2" | "legacy";
};

async function loadStoredRegistry(): Promise<StoredRegistry | null> {
  await assertSecureStoreAvailable();
  let registryValue: string | null;
  let legacyPublicValue: string | null;
  let legacyApiKey: string | null;
  try {
    [registryValue, legacyPublicValue, legacyApiKey] = await Promise.all([
      SecureStore.getItemAsync(REGISTRY_CONFIG_KEY, secureStoreOptions),
      SecureStore.getItemAsync(LEGACY_PUBLIC_CONFIG_KEY, secureStoreOptions),
      SecureStore.getItemAsync(LEGACY_API_KEY_KEY, secureStoreOptions),
    ]);
  } catch {
    throw new ModelConfigStorageError("无法读取本机模型配置，请重试。");
  }

  if (registryValue) {
    const registry = decodeRegistry(registryValue);
    try {
      const values = await Promise.all(
        registry.providers.map(
          async (provider) =>
            [
              provider.id,
              provider.kind === OPENAI_CODEX_PROVIDER_KIND
                ? null
                : await SecureStore.getItemAsync(
                    providerApiKeyStorageKey(provider.id),
                    secureStoreOptions,
                  ),
            ] as const,
        ),
      );
      return { registry, apiKeys: new Map(values), source: "v2" };
    } catch {
      throw new ModelConfigStorageError("无法读取模型服务凭据，请重试。");
    }
  }
  if (!legacyPublicValue) return null;
  const legacy = decodeLegacyPublicConfig(legacyPublicValue);
  return {
    registry: legacyModelRegistry(legacy),
    apiKeys: new Map([["provider-default", legacyApiKey]]),
    source: "legacy",
  };
}

const storedRegistryLoader =
  createMutableSingleFlightLoader(loadStoredRegistry);

function readStoredRegistry() {
  return storedRegistryLoader.load();
}

/** Prewarms the validated in-process snapshot without exposing any credential. */
export async function preloadModelConfig(): Promise<void> {
  if (LOCAL_INFERENCE) return;
  await readStoredRegistry();
}

async function hasProviderCredential(
  stored: StoredRegistry,
  provider: ModelProviderProfile,
) {
  if (provider.kind !== OPENAI_CODEX_PROVIDER_KIND) {
    return Boolean(stored.apiKeys.get(provider.id));
  }
  try {
    return Boolean(await codexDeviceOAuth.status(provider.id));
  } catch (error) {
    throw codexStorageError(error);
  }
}

async function summary(stored: StoredRegistry): Promise<ModelRegistrySummary> {
  const credentialStatuses = await Promise.all(
    stored.registry.providers.map(
      async (provider) =>
        [provider.id, await hasProviderCredential(stored, provider)] as const,
    ),
  );
  return {
    ...stored.registry,
    providers: [...stored.registry.providers],
    models: [...stored.registry.models],
    routes: { ...stored.registry.routes },
    providerKeyStatus: Object.fromEntries(credentialStatuses),
  };
}

export async function loadModelRegistry(): Promise<ModelRegistrySummary | null> {
  if (LOCAL_INFERENCE) return loadLocalRegistry();
  const stored = await readStoredRegistry();
  return stored ? await summary(stored) : null;
}

function codexStorageError(error: unknown) {
  if (error instanceof ModelConfigStorageError) return error;
  if (error instanceof CodexDeviceOAuthError) {
    if (error.code === "not-authorized") {
      return new ModelConfigStorageError("请先登录 ChatGPT Codex。");
    }
    if (error.code === "reauthorize" || error.code === "account-changed") {
      return new ModelConfigStorageError("Codex 登录已失效，请重新登录。");
    }
    if (error.code === "secure-storage") {
      return new ModelConfigStorageError("无法读取本机 Codex 凭据，请重试。");
    }
  }
  return new ModelConfigStorageError("无法连接 Codex，请检查网络后重试。");
}

async function resolveProviderCredential(
  stored: StoredRegistry,
  provider: ModelProviderProfile,
): Promise<
  Readonly<{
    apiKey: string;
    authIdentity?: string;
    fetch?: typeof fetch;
  }>
> {
  if (provider.kind !== OPENAI_CODEX_PROVIDER_KIND) {
    const apiKey = stored.apiKeys.get(provider.id);
    if (!apiKey) throw new ModelConfigStorageError("模型服务缺少 API Key。");
    return { apiKey };
  }
  let authorization: CodexAuthorization;
  try {
    authorization = await codexDeviceOAuth.authorization(provider.id);
  } catch (error) {
    throw codexStorageError(error);
  }
  return {
    apiKey: authorization.accessToken,
    authIdentity: authorization.accountId,
    fetch: codexDeviceOAuth.authorizedFetch(provider.id),
  };
}

export async function loadRoutedModelRuntimeConfig(
  role: ModelRouteRole,
): Promise<RoutedModelRuntimeConfig> {
  if (LOCAL_INFERENCE) {
    if (role !== "main") throw new Error("本地版本仅启用手机上的文本模型。");
    const config = await loadLocalRuntimeConfig();
    return { provider: localProvider, profile: localProfileFor(config.modelProfileId), apiKey: "", thinkingLevel: "off" };
  }
  const stored = await readStoredRegistry();
  if (!stored) throw new ModelConfigStorageError("请先添加模型服务。");
  const route = resolvePublicModelRoute(stored.registry, role);
  if (!route) {
    throw new ModelConfigStorageError(
      role === "vision"
        ? "请先配置图片识别模型。"
        : role === "delegate"
          ? "请先配置协作模型。"
          : role === "imageGeneration"
            ? "请先配置图片生成模型。"
            : role === "videoGeneration"
              ? "请先配置视频生成模型。"
              : "请先配置默认对话模型。",
    );
  }
  const credential = await resolveProviderCredential(stored, route.provider);
  return {
    provider: route.provider,
    profile: route.profile,
    ...credential,
    thinkingLevel: stored.registry.thinkingLevel,
  };
}

export async function loadModelRuntimeConfigByProfile(
  modelProfileId: string,
): Promise<ResolvedModelRuntimeConfig> {
  if (LOCAL_INFERENCE) {
    return loadLocalRuntimeConfig(modelProfileId);
  }
  const stored = await readStoredRegistry();
  if (!stored) throw new ModelConfigStorageError("请先添加模型服务。");
  let route: ReturnType<typeof resolvePublicModelProfile>;
  try {
    route = resolvePublicModelProfile(stored.registry, modelProfileId);
  } catch (error) {
    throw new ModelConfigStorageError(
      error instanceof Error ? error.message : "模型已经失效，请重新选择。",
    );
  }
  if (!route.profile.capabilities.chat || !route.profile.capabilities.tools) {
    throw new ModelConfigStorageError("当前模型不支持 Agent 所需的工具调用。");
  }
  const credential = await resolveProviderCredential(stored, route.provider);
  return {
    baseUrl: route.provider.baseUrl,
    model: route.profile.modelId,
    ...credential,
    thinkingLevel: stored.registry.thinkingLevel,
    contextWindow: route.profile.contextWindow,
    providerId: route.provider.id,
    providerKind: route.provider.kind,
    protocol: route.provider.protocol,
    modelProfileId: route.profile.id,
    capabilities: route.profile.capabilities,
  };
}

export async function loadModelConfig(): Promise<ModelConfigSummary | null> {
  if (LOCAL_INFERENCE) return { ...await loadLocalRuntimeConfig(), hasApiKey: true, apiKeyMask: null };
  const stored = await readStoredRegistry();
  if (!stored) return null;
  const route = resolvePublicModelRoute(stored.registry, "main");
  if (!route) return null;
  const hasApiKey = await hasProviderCredential(stored, route.provider);
  return {
    baseUrl: route.provider.baseUrl,
    model: route.profile.modelId,
    thinkingLevel: stored.registry.thinkingLevel,
    contextWindow: route.profile.contextWindow,
    hasApiKey,
    apiKeyMask: hasApiKey ? MODEL_API_KEY_MASK : null,
  };
}

export async function loadModelRuntimeConfig(
  role: ModelRouteRole = "main",
): Promise<ResolvedModelRuntimeConfig> {
  const routed = await loadRoutedModelRuntimeConfig(role);
  return {
    baseUrl: routed.provider.baseUrl,
    model: routed.profile.modelId,
    apiKey: routed.apiKey,
    ...(routed.authIdentity ? { authIdentity: routed.authIdentity } : {}),
    ...(routed.fetch ? { fetch: routed.fetch } : {}),
    thinkingLevel: routed.thinkingLevel,
    contextWindow: routed.profile.contextWindow,
    providerId: routed.provider.id,
    providerKind: routed.provider.kind,
    protocol: routed.provider.protocol,
    modelProfileId: routed.profile.id,
    capabilities: routed.profile.capabilities,
  };
}

async function restoreSecureValue(key: string, value: string | null) {
  if (value === null) {
    await SecureStore.deleteItemAsync(key, secureStoreOptions);
  } else {
    await SecureStore.setItemAsync(key, value, secureStoreOptions);
  }
}

export async function saveModelRegistry(
  input: SaveModelRegistryInput,
): Promise<ModelRegistrySummary> {
  const registry = validatePublicModelRegistry(input.registry);
  const compliance = loadComplianceConfig();
  try {
    for (const profile of registry.models) {
      const provider = registry.providers.find(
        (candidate) => candidate.id === profile.providerId,
      );
      if (!provider) throw new Error("模型服务不存在。");
      assertModelPermittedForDistribution(compliance, {
        baseUrl: provider.baseUrl,
        model: profile.modelId,
      });
    }
  } catch (error) {
    throw new ModelConfigStorageError(
      error instanceof Error ? error.message : "模型不符合发行配置。",
    );
  }
  const stored = await readStoredRegistry();
  const previousRegistryValue =
    stored?.source === "v2" ? JSON.stringify(stored.registry) : null;
  const previousKeys = new Map<string, string | null>();
  const providerIds = new Set([
    ...registry.providers.map((provider) => provider.id),
    ...(stored?.registry.providers.map((provider) => provider.id) ?? []),
  ]);
  try {
    await Promise.all(
      [...providerIds].map(async (providerId) => {
        const previous =
          stored?.apiKeys.get(providerId) ??
          (await SecureStore.getItemAsync(
            providerApiKeyStorageKey(providerId),
            secureStoreOptions,
          ));
        previousKeys.set(providerId, previous);
      }),
    );
  } catch {
    throw new ModelConfigStorageError("无法读取现有模型凭据，请重试。");
  }

  const finalKeys = new Map<string, string>();
  for (const provider of registry.providers) {
    if (provider.kind === OPENAI_CODEX_PROVIDER_KIND) {
      let authorized = false;
      try {
        authorized = Boolean(await codexDeviceOAuth.status(provider.id));
      } catch (error) {
        throw codexStorageError(error);
      }
      if (!authorized) {
        throw new ModelConfigStorageError(
          `${provider.name} 需要先登录 ChatGPT。`,
        );
      }
      continue;
    }
    const supplied = input.apiKeys?.[provider.id];
    const candidate =
      supplied === undefined ? previousKeys.get(provider.id) : supplied;
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new ModelConfigStorageError(`${provider.name} 缺少 API Key。`);
    }
    finalKeys.set(provider.id, candidate.trim());
  }

  try {
    for (const [providerId, apiKey] of finalKeys) {
      const key = providerApiKeyStorageKey(providerId);
      await SecureStore.setItemAsync(key, apiKey, secureStoreOptions);
    }
    await SecureStore.setItemAsync(
      REGISTRY_CONFIG_KEY,
      JSON.stringify(registry),
      secureStoreOptions,
    );
    for (const providerId of providerIds) {
      if (finalKeys.has(providerId)) continue;
      await SecureStore.deleteItemAsync(
        providerApiKeyStorageKey(providerId),
        secureStoreOptions,
      );
    }
  } catch {
    try {
      await Promise.all(
        [...providerIds].map((providerId) =>
          restoreSecureValue(
            providerApiKeyStorageKey(providerId),
            previousKeys.get(providerId) ?? null,
          ),
        ),
      );
      await restoreSecureValue(REGISTRY_CONFIG_KEY, previousRegistryValue);
    } catch {
      storedRegistryLoader.invalidate();
      throw new ModelConfigStorageError(
        "模型配置保存失败，且无法完整恢复原凭据；请重新检查设置。",
      );
    }
    throw new ModelConfigStorageError("无法安全保存模型配置，请重试。");
  }

  storedRegistryLoader.replace({
    registry,
    apiKeys: new Map<string, string | null>(finalKeys),
    source: "v2",
  });

  const obsoleteCodexProviderIds =
    stored?.registry.providers
      .filter(
        (provider) =>
          provider.kind === OPENAI_CODEX_PROVIDER_KIND &&
          !registry.providers.some(
            (next) =>
              next.id === provider.id &&
              next.kind === OPENAI_CODEX_PROVIDER_KIND,
          ),
      )
      .map((provider) => provider.id) ?? [];
  const cleanup = await Promise.allSettled(
    obsoleteCodexProviderIds.map((providerId) =>
      codexDeviceOAuth.logout(providerId),
    ),
  );
  if (cleanup.some((result) => result.status === "rejected")) {
    throw new ModelConfigStorageError(
      "模型配置已保存，但旧 Codex 凭据未完整清除，请重试退出登录。",
    );
  }

  return summary({
    registry,
    apiKeys: new Map<string, string | null>(finalKeys),
    source: "v2",
  });
}

/** Compatibility entrypoint used by the existing single-provider settings UI. */
export async function saveModelConfig(
  input: SaveModelConfigInput,
): Promise<ModelConfigSummary> {
  const stored = await readStoredRegistry();
  const existingMain = stored
    ? resolvePublicModelRoute(stored.registry, "main")
    : undefined;
  const config = validateModelConfig({
    ...input,
    apiKey:
      input.apiKey === undefined && existingMain
        ? stored?.apiKeys.get(existingMain.provider.id)
        : input.apiKey,
  });
  const registry = stored?.registry ?? legacyModelRegistry(config);
  const main = resolvePublicModelRoute(registry, "main");
  if (!main) throw new ModelConfigStorageError("默认对话模型配置无效。");
  const updated: PublicModelRegistry = {
    ...registry,
    thinkingLevel: config.thinkingLevel,
    providers: registry.providers.map((provider) =>
      provider.id === main.provider.id
        ? { ...provider, baseUrl: config.baseUrl }
        : provider,
    ),
    models: registry.models.map((profile) =>
      profile.id === main.profile.id
        ? { ...profile, name: config.model, modelId: config.model }
        : profile,
    ),
  };
  await saveModelRegistry({
    registry: updated,
    apiKeys: {
      [main.provider.id]: input.apiKey,
    },
  });
  return (await loadModelConfig())!;
}

export async function updateModelThinkingLevel(
  thinkingLevel: ModelThinkingLevel,
): Promise<ModelConfigSummary> {
  const stored = await readStoredRegistry();
  if (!stored) {
    throw new ModelConfigStorageError("请先在设置中保存模型配置。");
  }
  await saveModelRegistry({
    registry: { ...stored.registry, thinkingLevel },
  });
  return (await loadModelConfig())!;
}

export async function clearModelConfig(): Promise<void> {
  await assertSecureStoreAvailable();
  const stored = await readStoredRegistry();
  const keys = [
    REGISTRY_CONFIG_KEY,
    LEGACY_PUBLIC_CONFIG_KEY,
    LEGACY_API_KEY_KEY,
    ...(stored?.registry.providers.map((provider) =>
      providerApiKeyStorageKey(provider.id),
    ) ?? []),
  ];
  const codexProviderIds =
    stored?.registry.providers
      .filter((provider) => provider.kind === OPENAI_CODEX_PROVIDER_KIND)
      .map((provider) => provider.id) ?? [];
  const results = await Promise.allSettled([
    ...[...new Set(keys)].map((key) =>
      SecureStore.deleteItemAsync(key, secureStoreOptions),
    ),
    ...codexProviderIds.map((providerId) =>
      codexDeviceOAuth.logout(providerId),
    ),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    storedRegistryLoader.invalidate();
    throw new ModelConfigStorageError("无法完整清除模型配置，请重试。");
  }
  storedRegistryLoader.replace(null);
}

export async function testConfiguredModelConnection(
  input: SaveModelConfigInput & {
    providerId?: string;
    providerKind?: ModelProviderKind;
  },
  options?: ModelConnectionTestOptions,
): Promise<ModelConnectionResult> {
  const stored = await readStoredRegistry();
  const providerId =
    input.providerId ??
    (stored
      ? resolvePublicModelRoute(stored.registry, "main")?.provider.id
      : undefined);
  const storedApiKey = providerId ? stored?.apiKeys.get(providerId) : undefined;
  const providerKind =
    input.providerKind ??
    stored?.registry.providers.find((provider) => provider.id === providerId)
      ?.kind ??
    "openai-compatible";
  if (providerKind === OPENAI_CODEX_PROVIDER_KIND) {
    throw new ModelConfigStorageError(
      "Codex 登录通过实际对话验证，不使用通用连接测试。",
    );
  }
  const config = validateModelConfig({
    baseUrl: input.baseUrl,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    apiKey: input.apiKey === undefined ? storedApiKey : input.apiKey,
  });
  assertModelPermittedForDistribution(loadComplianceConfig(), config);
  return testModelConnection(config, options);
}

export async function probeConfiguredModelCapabilities(
  input: SaveModelConfigInput & {
    providerId?: string;
    providerKind?: ModelProviderKind;
  },
  options?: ModelCapabilityProbeOptions,
): Promise<ModelCapabilityProbeResult> {
  const stored = await readStoredRegistry();
  const providerId =
    input.providerId ??
    (stored
      ? resolvePublicModelRoute(stored.registry, "main")?.provider.id
      : undefined);
  const storedApiKey = providerId ? stored?.apiKeys.get(providerId) : undefined;
  const providerKind =
    input.providerKind ??
    stored?.registry.providers.find((provider) => provider.id === providerId)
      ?.kind ??
    "openai-compatible";
  if (providerKind === OPENAI_CODEX_PROVIDER_KIND) {
    throw new ModelConfigStorageError(
      "Codex 模型能力来自固定目录，不使用通用能力探测。",
    );
  }
  const config = validateModelConfig({
    baseUrl: input.baseUrl,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    apiKey: input.apiKey === undefined ? storedApiKey : input.apiKey,
  });
  assertModelPermittedForDistribution(loadComplianceConfig(), config);
  return probeModelCapabilities(config, options);
}

export async function discoverConfiguredModelNames(
  input: {
    baseUrl: string;
    apiKey?: string;
    providerId?: string;
    providerKind?: ModelProviderKind;
  },
  options?: ModelDiscoveryOptions,
) {
  assertModelEndpointPermittedForDistribution(
    loadComplianceConfig(),
    input.baseUrl,
  );
  const stored = await readStoredRegistry();
  const providerId =
    input.providerId ??
    (stored
      ? resolvePublicModelRoute(stored.registry, "main")?.provider.id
      : undefined);
  const providerKind =
    input.providerKind ??
    stored?.registry.providers.find((provider) => provider.id === providerId)
      ?.kind ??
    "openai-compatible";
  if (providerKind === OPENAI_CODEX_PROVIDER_KIND) {
    if (normalizeModelBaseUrl(input.baseUrl) !== OPENAI_CODEX_BASE_URL) {
      throw new ModelConfigStorageError("Codex 登录不能用于自定义模型地址。");
    }
    return listOpenAICodexModelIds();
  }
  if (input.apiKey !== undefined) {
    return discoverModelNames(
      { baseUrl: input.baseUrl, apiKey: input.apiKey },
      options,
    );
  }
  return discoverModelNames(
    {
      baseUrl: input.baseUrl,
      apiKey: providerId ? stored?.apiKeys.get(providerId) : undefined,
    },
    options,
  );
}
