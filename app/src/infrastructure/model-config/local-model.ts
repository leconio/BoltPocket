import {
  LOCAL_BASE_URL,
  LOCAL_CONTEXT_WINDOW,
  LOCAL_PROVIDER_ID,
} from "@/config/local-inference";
import type {
  ModelRegistrySummary,
  ModelProviderProfile,
  ModelProfile,
} from "./model-profile-registry";
import { LOCAL_MODELS, localModelById } from "./local-model-catalog";
import { selectedLocalModelId, localDownloads } from "./local-model-library";

export const localProvider: ModelProviderProfile = {
  id: LOCAL_PROVIDER_ID,
  name: "On-device · llama.cpp",
  kind: "openai-compatible",
  protocol: "chat-completions",
  baseUrl: LOCAL_BASE_URL,
};
export function localProfileFor(id: string): ModelProfile {
  const model = localModelById(id);
  return {
  id: model.id,
  providerId: LOCAL_PROVIDER_ID,
  name: model.name,
  modelId: model.modelId,
  contextWindow: LOCAL_CONTEXT_WINDOW,
  purposes: ["chat"],
  capabilities: {
    chat: true,
    tools: true,
    vision: false,
    reasoning: false,
    imageGeneration: false,
    videoGeneration: false,
  },
  };
}
export async function loadLocalRegistry(): Promise<ModelRegistrySummary | null> {
  const id = await selectedLocalModelId();
  await localDownloads.refresh();
  const models = LOCAL_MODELS.filter((model) => localDownloads.snapshot()[model.id].phase === "ready")
    .map((model) => localProfileFor(model.id));
  // The existing picker expects every main route to resolve to a usable profile.
  // A fresh install has no configured model until its default is downloaded.
  if (!models.some((model) => model.id === id)) return null;
  return {
  schema: 6,
  providers: [localProvider],
  models,
  routes: { main: id },
  thinkingLevel: "off",
  providerKeyStatus: { [LOCAL_PROVIDER_ID]: true },
  };
}
export async function loadLocalRuntimeConfig(id?: string) {
  const profile = localProfileFor(id ?? await selectedLocalModelId());
  return {
  baseUrl: LOCAL_BASE_URL,
  model: profile.modelId,
  apiKey: "",
  thinkingLevel: "off" as const,
  contextWindow: LOCAL_CONTEXT_WINDOW,
  providerId: LOCAL_PROVIDER_ID,
  providerKind: "openai-compatible" as const,
  protocol: "chat-completions" as const,
  modelProfileId: profile.id,
  capabilities: profile.capabilities,
  };
}
