import {
  LOCAL_BASE_URL,
  LOCAL_CONTEXT_WINDOW,
  LOCAL_MODEL_ID,
  LOCAL_PROVIDER_ID,
} from "@/config/local-inference";
import type {
  ModelRegistrySummary,
  ModelProviderProfile,
  ModelProfile,
} from "./model-profile-registry";

export const localProvider: ModelProviderProfile = {
  id: LOCAL_PROVIDER_ID,
  name: "On-device · llama.cpp",
  kind: "openai-compatible",
  protocol: "chat-completions",
  baseUrl: LOCAL_BASE_URL,
};
export const localProfile: ModelProfile = {
  id: "bolt-e4b-local",
  providerId: LOCAL_PROVIDER_ID,
  name: "Nemotron 3.5 Bolt E4B",
  modelId: LOCAL_MODEL_ID,
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
export const localRegistry: ModelRegistrySummary = {
  schema: 6,
  providers: [localProvider],
  models: [localProfile],
  routes: { main: localProfile.id },
  thinkingLevel: "off",
  providerKeyStatus: { [LOCAL_PROVIDER_ID]: true },
};
export const localRuntimeConfig = {
  baseUrl: LOCAL_BASE_URL,
  model: LOCAL_MODEL_ID,
  apiKey: "",
  thinkingLevel: "off" as const,
  contextWindow: LOCAL_CONTEXT_WINDOW,
  providerId: LOCAL_PROVIDER_ID,
  providerKind: "openai-compatible" as const,
  protocol: "chat-completions" as const,
  modelProfileId: localProfile.id,
  capabilities: localProfile.capabilities,
};
