import {
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_MODELS,
  type LocalModelId,
} from "./local-model-catalog.ts";
import type {
  ModelRegistrySummary,
  PublicModelRegistry,
} from "./model-profile-registry.ts";

export type LocalModelPreference = { id: LocalModelId; active: boolean };
export type MainModelChoice =
  { source: "api" } | { source: "local"; id: LocalModelId };

export function parseLocalModelPreference(
  value: unknown,
): LocalModelPreference {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const model = LOCAL_MODELS.find((model) => model.id === record.id);
  return {
    id: model?.id ?? DEFAULT_LOCAL_MODEL_ID,
    active: Boolean(model && record.active === true),
  };
}

/** Existing API defaults win unless the user explicitly chooses a local model. */
export function chooseMainModel(
  api: PublicModelRegistry | null,
  preference: LocalModelPreference,
): MainModelChoice {
  const apiMain = api?.models.find((model) => model.id === api.routes.main);
  return apiMain && !preference.active
    ? { source: "api" }
    : { source: "local", id: preference.id };
}

/** Runtime discovery only: local entries never enter the API credential registry. */
export function combineModelRegistries(
  api: ModelRegistrySummary | null,
  local: ModelRegistrySummary | null,
  choice: MainModelChoice,
): ModelRegistrySummary | null {
  if (!api && !local) return null;
  const main = choice.source === "api" ? api!.routes.main : choice.id;
  return {
    schema: 6,
    providers: [...(api?.providers ?? []), ...(local?.providers ?? [])],
    models: [...(api?.models ?? []), ...(local?.models ?? [])],
    routes: { ...api?.routes, main },
    thinkingLevel: choice.source === "api" ? api!.thinkingLevel : "off",
    providerKeyStatus: {
      ...api?.providerKeyStatus,
      ...local?.providerKeyStatus,
    },
  };
}
