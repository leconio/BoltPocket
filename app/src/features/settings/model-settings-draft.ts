import {
  DEFAULT_MODEL_CAPABILITIES,
  type ModelCapabilities,
  type ModelProfile,
  type ModelPurpose,
  type ModelRoutes,
} from "../../infrastructure/model-config/model-profile-registry";
import type { MessageKey } from "../../i18n/messages.ts";

export const EDITABLE_MODEL_PURPOSES = [
  {
    id: "chat",
    labelKey: "settings.model.purpose.chat",
    icon: "chatbubble-outline",
  },
  {
    id: "delegate",
    labelKey: "settings.model.purpose.delegate",
    icon: "people-outline",
  },
  {
    id: "vision",
    labelKey: "settings.model.purpose.vision",
    icon: "image-outline",
  },
  {
    id: "imageGeneration",
    labelKey: "settings.model.purpose.imageGeneration",
    icon: "color-palette-outline",
  },
  {
    id: "videoGeneration",
    labelKey: "settings.model.purpose.videoGeneration",
    icon: "videocam-outline",
  },
] as const satisfies readonly {
  id: ModelPurpose;
  labelKey: MessageKey;
  icon:
    | "chatbubble-outline"
    | "people-outline"
    | "image-outline"
    | "color-palette-outline"
    | "videocam-outline";
}[];

export function modelProfileId(providerId: string, modelId: string) {
  let hash = 0x811c9dc5;
  for (const character of modelId) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 0x01000193);
  }
  return `${providerId}-model-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function purposeMessageKey(purpose: ModelPurpose): MessageKey {
  return (
    EDITABLE_MODEL_PURPOSES.find((option) => option.id === purpose)?.labelKey ??
    (purpose === "imageGeneration"
      ? "settings.model.purpose.imageGeneration"
      : "settings.model.purpose.videoGeneration")
  );
}

export function purposeSummary(
  purposes: readonly ModelPurpose[],
  translate: (key: MessageKey) => string,
) {
  return purposes
    .map((purpose) => translate(purposeMessageKey(purpose)))
    .join(" · ");
}

export function capabilitiesForPurposes(
  purposes: readonly ModelPurpose[],
  previous?: ModelCapabilities,
): ModelCapabilities {
  const textAgent = purposes.includes("chat") || purposes.includes("delegate");
  const vision = purposes.includes("vision");
  return {
    chat: textAgent || vision,
    tools: textAgent,
    vision,
    reasoning:
      previous?.reasoning ??
      (textAgent || vision ? DEFAULT_MODEL_CAPABILITIES.reasoning : false),
    imageGeneration: purposes.includes("imageGeneration"),
    videoGeneration: purposes.includes("videoGeneration"),
  };
}

const routePurposes = {
  main: "chat",
  delegate: "delegate",
  vision: "vision",
  imageGeneration: "imageGeneration",
  videoGeneration: "videoGeneration",
} as const satisfies Record<keyof ModelRoutes, ModelPurpose>;

export function routesForModels(
  models: readonly ModelProfile[],
  previous: ModelRoutes | null,
  missingMainMessage: string,
): ModelRoutes {
  const choose = (role: keyof ModelRoutes) => {
    const purpose = routePurposes[role];
    const current = previous?.[role];
    if (
      current &&
      models.some(
        (model) => model.id === current && model.purposes.includes(purpose),
      )
    ) {
      return current;
    }
    return models.find((model) => model.purposes.includes(purpose))?.id;
  };
  const main = choose("main");
  if (!main) throw new Error(missingMainMessage);
  const delegate = choose("delegate");
  const vision = choose("vision");
  const imageGeneration = choose("imageGeneration");
  const videoGeneration = choose("videoGeneration");
  return {
    main,
    ...(delegate ? { delegate } : {}),
    ...(vision ? { vision } : {}),
    ...(imageGeneration ? { imageGeneration } : {}),
    ...(videoGeneration ? { videoGeneration } : {}),
  };
}
