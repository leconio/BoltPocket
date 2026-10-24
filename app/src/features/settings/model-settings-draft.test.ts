import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilitiesForPurposes,
  EDITABLE_MODEL_PURPOSES,
  routesForModels,
} from "./model-settings-draft.ts";
import type { ModelProfile } from "../../infrastructure/model-config/model-profile-registry.ts";

function profile(id: string, purposes: ModelProfile["purposes"]): ModelProfile {
  return {
    id,
    providerId: "provider-one",
    name: id,
    modelId: id,
    contextWindow: 128_000,
    purposes,
    capabilities: capabilitiesForPurposes(purposes),
  };
}

test("purpose selection creates only the capabilities needed by those uses", () => {
  assert.deepEqual(capabilitiesForPurposes(["vision"]), {
    chat: true,
    tools: false,
    vision: true,
    reasoning: true,
    imageGeneration: false,
    videoGeneration: false,
  });
  assert.equal(capabilitiesForPurposes(["delegate"]).tools, true);
  assert.deepEqual(capabilitiesForPurposes(["imageGeneration"]), {
    chat: false,
    tools: false,
    vision: false,
    reasoning: false,
    imageGeneration: true,
    videoGeneration: false,
  });
  assert.deepEqual(capabilitiesForPurposes(["videoGeneration"]), {
    chat: false,
    tools: false,
    vision: false,
    reasoning: false,
    imageGeneration: false,
    videoGeneration: true,
  });
});

test("the model category picker exposes image and video generation", () => {
  assert.deepEqual(
    EDITABLE_MODEL_PURPOSES.filter((purpose) =>
      ["imageGeneration", "videoGeneration"].includes(purpose.id),
    ).map(({ id, labelKey }) => ({ id, labelKey })),
    [
      {
        id: "imageGeneration",
        labelKey: "settings.model.purpose.imageGeneration",
      },
      {
        id: "videoGeneration",
        labelKey: "settings.model.purpose.videoGeneration",
      },
    ],
  );
});

test("routes retain defaults while the model keeps that purpose", () => {
  const models = [
    profile("chat-one", ["chat"]),
    profile("chat-two", ["chat", "delegate"]),
  ];
  assert.deepEqual(
    routesForModels(
      models,
      {
        main: "chat-two",
        delegate: "chat-two",
      },
      "missing-main",
    ),
    { main: "chat-two", delegate: "chat-two" },
  );
  assert.deepEqual(routesForModels([models[0]!], null, "missing-main"), {
    main: "chat-one",
  });
});

test("removing the last daily chat model is rejected", () => {
  assert.throws(
    () =>
      routesForModels([profile("vision", ["vision"])], null, "missing-main"),
    /missing-main/u,
  );
});
