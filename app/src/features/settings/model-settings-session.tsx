import { randomUUID } from "expo-crypto";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  capabilitiesForPurposes,
  modelProfileId,
  routesForModels,
} from "@/features/settings/model-settings-draft";
import { useI18n } from "@/i18n/i18n-provider";
import {
  applyModelProviderPreset,
  DEFAULT_MODEL_THINKING_LEVEL,
  inferModelProviderPresetId,
  loadModelRegistry,
  saveModelRegistry,
  type ModelProfile,
  type ModelProviderKind,
  type ModelProviderPresetId,
  type ModelProviderProtocol,
  type ModelPurpose,
  type ModelRegistrySummary,
  type ModelRoutes,
  type ModelThinkingLevel,
  type PublicModelRegistry,
} from "@/infrastructure/model-config";
import {
  type CodexAuthorizationSummary,
  type CodexDeviceCodeInfo,
} from "@/infrastructure/model-config/codex-device-oauth";
import { OPENAI_CODEX_PROVIDER_KIND } from "@/infrastructure/model-config/codex-provider-constants";
import { codexDeviceOAuth } from "@/infrastructure/model-config/expo-codex-device-oauth";

export type ProviderDraft = {
  id: string;
  presetId: ModelProviderPresetId;
  name: string;
  baseUrl: string;
  kind: ModelProviderKind;
  protocol: ModelProviderProtocol;
  apiKeyDraft: string;
  hasStoredApiKey: boolean;
  apiKeyNeedsReplacement: boolean;
  codexAuthorization: CodexAuthorizationSummary | null;
};

type ModelSettingsSnapshot = {
  providers: ProviderDraft[];
  models: ModelProfile[];
  routes: ModelRoutes | null;
  thinkingLevel: ModelThinkingLevel;
};

type ModelSettingsSessionValue = ModelSettingsSnapshot & {
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  reset: () => void;
  addProvider: () => string;
  selectProviderPreset: (
    providerId: string,
    presetId: ModelProviderPresetId,
  ) => Promise<void>;
  authorizeCodex: (
    providerId: string,
    onDeviceCode: (information: CodexDeviceCodeInfo) => void | Promise<void>,
    signal?: AbortSignal,
  ) => Promise<void>;
  logoutCodex: (providerId: string) => Promise<void>;
  updateProvider: (providerId: string, patch: Partial<ProviderDraft>) => void;
  removeProvider: (providerId: string) => Promise<void>;
  saveProviders: () => Promise<void>;
  upsertModel: (input: {
    providerId: string;
    modelProfileId?: string;
    modelId: string;
    contextWindow: number;
    purposes: readonly ModelPurpose[];
  }) => Promise<void>;
  removeModel: (modelProfileId: string) => Promise<void>;
};

const ModelSettingsSessionContext =
  createContext<ModelSettingsSessionValue | null>(null);

function emptyProvider(
  name: string,
  id = `provider-${randomUUID()}`,
): ProviderDraft {
  return {
    id,
    presetId: "custom",
    name,
    baseUrl: "",
    kind: "openai-compatible",
    protocol: "chat-completions",
    apiKeyDraft: "",
    hasStoredApiKey: false,
    apiKeyNeedsReplacement: false,
    codexAuthorization: null,
  };
}

function emptySnapshot(defaultProviderName: string): ModelSettingsSnapshot {
  return {
    providers: [emptyProvider(defaultProviderName, "provider-default")],
    models: [],
    routes: null,
    thinkingLevel: DEFAULT_MODEL_THINKING_LEVEL,
  };
}

async function snapshotForRegistry(
  registry: ModelRegistrySummary | null,
  defaultProviderName: string,
): Promise<ModelSettingsSnapshot> {
  if (!registry) return emptySnapshot(defaultProviderName);
  const codexAuthorizations = new Map(
    await Promise.all(
      registry.providers
        .filter((provider) => provider.kind === OPENAI_CODEX_PROVIDER_KIND)
        .map(
          async (provider) =>
            [provider.id, await codexDeviceOAuth.status(provider.id)] as const,
        ),
    ),
  );
  return {
    providers: registry.providers.map((provider) => ({
      id: provider.id,
      presetId: inferModelProviderPresetId(provider),
      name: provider.name,
      baseUrl: provider.baseUrl,
      kind: provider.kind,
      protocol: provider.protocol,
      apiKeyDraft: "",
      hasStoredApiKey: registry.providerKeyStatus[provider.id] ?? false,
      apiKeyNeedsReplacement: false,
      codexAuthorization: codexAuthorizations.get(provider.id) ?? null,
    })),
    models: [...registry.models],
    routes: { ...registry.routes },
    thinkingLevel: registry.thinkingLevel,
  };
}

export function ModelSettingsSessionProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ModelSettingsSnapshot>(() =>
    emptySnapshot(t("settings.model.provider")),
  );
  const snapshotRef = useRef(snapshot);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadPromise = useRef<Promise<void> | null>(null);

  const replaceSnapshot = useCallback((next: ModelSettingsSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const load = useCallback(() => {
    if (loaded) return Promise.resolve();
    if (loadPromise.current) return loadPromise.current;
    setLoading(true);
    const operation = loadModelRegistry()
      .then(async (registry) => {
        replaceSnapshot(
          await snapshotForRegistry(registry, t("settings.model.provider")),
        );
        setLoaded(true);
      })
      .finally(() => {
        loadPromise.current = null;
        setLoading(false);
      });
    loadPromise.current = operation;
    return operation;
  }, [loaded, replaceSnapshot, t]);

  const persist = useCallback(
    async (next: ModelSettingsSnapshot) => {
      const stored = await loadModelRegistry();
      const routes = routesForModels(
        next.models,
        next.routes,
        t("settings.model.error.dailyRequired"),
      );
      const registry: PublicModelRegistry = {
        schema: 6,
        providers: next.providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
        })),
        models: next.models,
        routes,
        thinkingLevel: stored?.thinkingLevel ?? next.thinkingLevel,
      };
      const saved = await saveModelRegistry({
        registry,
        apiKeys: Object.fromEntries(
          next.providers
            .filter(
              (provider) =>
                provider.kind !== OPENAI_CODEX_PROVIDER_KIND &&
                (provider.apiKeyDraft.trim() ||
                  provider.apiKeyNeedsReplacement),
            )
            .map((provider) => [provider.id, provider.apiKeyDraft.trim()]),
        ),
      });
      replaceSnapshot(
        await snapshotForRegistry(saved, t("settings.model.provider")),
      );
    },
    [replaceSnapshot, t],
  );

  const addProvider = useCallback(() => {
    const provider = emptyProvider(t("settings.model.provider"));
    const current = snapshotRef.current;
    provider.name = t("settings.model.providerNumbered", {
      number: current.providers.length + 1,
    });
    replaceSnapshot({
      ...current,
      providers: [...current.providers, provider],
    });
    return provider.id;
  }, [replaceSnapshot, t]);

  const reset = useCallback(() => {
    replaceSnapshot(emptySnapshot(t("settings.model.provider")));
    setLoaded(false);
  }, [replaceSnapshot, t]);

  const updateProvider = useCallback(
    (providerId: string, patch: Partial<ProviderDraft>) => {
      const current = snapshotRef.current;
      replaceSnapshot({
        ...current,
        providers: current.providers.map((provider) => {
          if (provider.id !== providerId) return provider;
          const endpointChanged =
            (patch.baseUrl !== undefined &&
              patch.baseUrl !== provider.baseUrl) ||
            (patch.protocol !== undefined &&
              patch.protocol !== provider.protocol) ||
            (patch.kind !== undefined && patch.kind !== provider.kind);
          return {
            ...provider,
            ...patch,
            ...(endpointChanged
              ? {
                  apiKeyDraft: "",
                  apiKeyNeedsReplacement:
                    provider.apiKeyNeedsReplacement || provider.hasStoredApiKey,
                }
              : {}),
          };
        }),
      });
    },
    [replaceSnapshot],
  );

  const selectProviderPreset = useCallback(
    async (providerId: string, presetId: ModelProviderPresetId) => {
      const current = snapshotRef.current;
      const previous = current.providers.find(
        (provider) => provider.id === providerId,
      );
      if (!previous) return;
      const nextProvider = applyModelProviderPreset(previous, presetId);
      if (
        previous.kind === OPENAI_CODEX_PROVIDER_KIND &&
        nextProvider.kind !== OPENAI_CODEX_PROVIDER_KIND
      ) {
        await codexDeviceOAuth.logout(providerId);
      }
      replaceSnapshot({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                ...nextProvider,
                codexAuthorization:
                  nextProvider.kind === OPENAI_CODEX_PROVIDER_KIND
                    ? provider.codexAuthorization
                    : null,
              }
            : provider,
        ),
      });
    },
    [replaceSnapshot],
  );

  const authorizeCodex = useCallback(
    async (
      providerId: string,
      onDeviceCode: (information: CodexDeviceCodeInfo) => void | Promise<void>,
      signal?: AbortSignal,
    ) => {
      const provider = snapshotRef.current.providers.find(
        (candidate) => candidate.id === providerId,
      );
      if (provider?.kind !== OPENAI_CODEX_PROVIDER_KIND) {
        throw new Error(t("settings.model.error.notCodex"));
      }
      const authorization = await codexDeviceOAuth.login(
        providerId,
        onDeviceCode,
        signal,
      );
      const current = snapshotRef.current;
      replaceSnapshot({
        ...current,
        providers: current.providers.map((candidate) =>
          candidate.id === providerId
            ? {
                ...candidate,
                codexAuthorization: authorization,
                hasStoredApiKey: true,
                apiKeyNeedsReplacement: false,
              }
            : candidate,
        ),
      });
    },
    [replaceSnapshot, t],
  );

  const logoutCodex = useCallback(
    async (providerId: string) => {
      await codexDeviceOAuth.logout(providerId);
      const current = snapshotRef.current;
      replaceSnapshot({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                codexAuthorization: null,
                hasStoredApiKey: false,
              }
            : provider,
        ),
      });
    },
    [replaceSnapshot],
  );

  const saveProviders = useCallback(
    () => persist(snapshotRef.current),
    [persist],
  );

  const removeProvider = useCallback(
    async (providerId: string) => {
      const current = snapshotRef.current;
      if (current.providers.length === 1) {
        throw new Error(t("settings.model.error.keepProvider"));
      }
      const next = {
        ...current,
        providers: current.providers.filter(
          (provider) => provider.id !== providerId,
        ),
        models: current.models.filter(
          (model) => model.providerId !== providerId,
        ),
      };
      const stored = await loadModelRegistry();
      const persistedProvider = stored?.providers.some(
        (provider) => provider.id === providerId,
      );
      if (persistedProvider) {
        await persist(next);
      } else {
        if (
          current.providers.find((provider) => provider.id === providerId)
            ?.kind === OPENAI_CODEX_PROVIDER_KIND
        ) {
          await codexDeviceOAuth.logout(providerId);
        }
        replaceSnapshot(next);
      }
    },
    [persist, replaceSnapshot, t],
  );

  const upsertModel = useCallback(
    async (input: {
      providerId: string;
      modelProfileId?: string;
      modelId: string;
      contextWindow: number;
      purposes: readonly ModelPurpose[];
    }) => {
      const current = snapshotRef.current;
      const modelId = input.modelId.trim();
      if (!modelId) throw new Error(t("settings.model.error.enterName"));
      if (input.purposes.length === 0) {
        throw new Error(t("settings.model.error.chooseCategory"));
      }
      const provider = current.providers.find(
        (candidate) => candidate.id === input.providerId,
      );
      if (!provider) throw new Error(t("settings.model.error.providerMissing"));
      if (
        provider.kind === OPENAI_CODEX_PROVIDER_KIND &&
        input.purposes.some(
          (purpose) =>
            purpose === "imageGeneration" || purpose === "videoGeneration",
        )
      ) {
        throw new Error(t("settings.model.error.codexMediaUnsupported"));
      }
      const editing = input.modelProfileId
        ? current.models.find((model) => model.id === input.modelProfileId)
        : undefined;
      const duplicate = current.models.find(
        (model) =>
          model.providerId === input.providerId &&
          model.modelId === modelId &&
          model.id !== editing?.id,
      );
      if (duplicate) throw new Error(t("settings.model.error.duplicate"));
      const profile: ModelProfile = {
        id: editing?.id ?? modelProfileId(provider.id, modelId),
        providerId: provider.id,
        name: modelId,
        modelId,
        contextWindow: input.contextWindow,
        purposes: [...input.purposes],
        capabilities: capabilitiesForPurposes(
          input.purposes,
          editing?.capabilities,
        ),
      };
      const models = editing
        ? current.models.map((model) =>
            model.id === editing.id ? profile : model,
          )
        : [...current.models, profile];
      await persist({ ...current, models });
    },
    [persist, t],
  );

  const removeModel = useCallback(
    async (modelProfileIdToRemove: string) => {
      const current = snapshotRef.current;
      const models = current.models.filter(
        (model) => model.id !== modelProfileIdToRemove,
      );
      if (models.length === current.models.length) {
        throw new Error(t("settings.model.error.modelMissing"));
      }
      await persist({ ...current, models });
    },
    [persist, t],
  );

  const value = useMemo<ModelSettingsSessionValue>(
    () => ({
      ...snapshot,
      loaded,
      loading,
      load,
      reset,
      addProvider,
      selectProviderPreset,
      authorizeCodex,
      logoutCodex,
      updateProvider,
      removeProvider,
      saveProviders,
      upsertModel,
      removeModel,
    }),
    [
      addProvider,
      authorizeCodex,
      load,
      loaded,
      loading,
      logoutCodex,
      removeModel,
      removeProvider,
      reset,
      saveProviders,
      selectProviderPreset,
      snapshot,
      updateProvider,
      upsertModel,
    ],
  );

  return (
    <ModelSettingsSessionContext.Provider value={value}>
      {children}
    </ModelSettingsSessionContext.Provider>
  );
}

export function useModelSettingsSession() {
  const value = useContext(ModelSettingsSessionContext);
  if (!value) {
    throw new Error("ModelSettingsSessionProvider is missing.");
  }
  return value;
}
