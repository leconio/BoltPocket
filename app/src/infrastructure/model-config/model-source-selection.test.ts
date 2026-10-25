import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseMainModel,
  combineModelRegistries,
  parseLocalModelPreference,
} from "./model-source-selection.ts";
import type { ModelRegistrySummary } from "./model-profile-registry.ts";

const capabilities = {
  chat: true,
  tools: true,
  vision: false,
  reasoning: true,
  imageGeneration: false,
  videoGeneration: false,
};
const api: ModelRegistrySummary = {
  schema: 6,
  providers: [
    {
      id: "custom-api",
      name: "Existing API",
      kind: "openai-compatible",
      protocol: "responses",
      baseUrl: "https://models.example/v1",
    },
    {
      id: "codex",
      name: "Codex",
      kind: "openai-codex",
      protocol: "responses",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    },
  ],
  models: [
    {
      id: "api-main",
      providerId: "custom-api",
      name: "Existing model",
      modelId: "existing-model",
      contextWindow: 65536,
      purposes: ["chat"],
      capabilities,
    },
    {
      id: "api-other",
      providerId: "codex",
      name: "Existing specialist",
      modelId: "other-model",
      contextWindow: 131072,
      purposes: ["chat", "delegate"],
      capabilities,
    },
  ],
  routes: {
    main: "api-main",
    delegate: "api-other",
    vision: "api-other",
    imageGeneration: "api-other",
    videoGeneration: "api-other",
  },
  thinkingLevel: "high",
  providerKeyStatus: { "custom-api": true, codex: true },
};
const local: ModelRegistrySummary = {
  schema: 6,
  providers: [
    {
      id: "on-device-llama",
      name: "On-device",
      kind: "openai-compatible",
      protocol: "chat-completions",
      baseUrl: "native://llama.cpp",
    },
  ],
  models: ["bonsai2-local", "bolt-e4b-local"].map((id) => ({
    id,
    providerId: "on-device-llama",
    name: id,
    modelId: id,
    contextWindow: 16384,
    purposes: ["chat"] as const,
    capabilities: { ...capabilities, reasoning: false },
  })),
  routes: { main: "bonsai2-local" },
  thinkingLevel: "off",
  providerKeyStatus: { "on-device-llama": true },
};

test("existing API default takes precedence over a legacy local selection", () => {
  const preference = parseLocalModelPreference({ id: "bonsai2-local" });
  assert.deepEqual(chooseMainModel(api, preference), { source: "api" });
  assert.deepEqual(chooseMainModel(null, preference), {
    source: "local",
    id: "bonsai2-local",
  });
});
test("only an explicit local choice changes the default source", () => {
  const preference = parseLocalModelPreference({
    id: "bolt-e4b-local",
    active: true,
  });
  assert.deepEqual(chooseMainModel(api, preference), {
    source: "local",
    id: "bolt-e4b-local",
  });
  assert.deepEqual(chooseMainModel(api, { ...preference, active: false }), {
    source: "api",
  });
});
test("a corrupt or unknown local preference cannot hijack an API default", () => {
  assert.deepEqual(chooseMainModel(api, parseLocalModelPreference(null)), {
    source: "api",
  });
  assert.deepEqual(
    chooseMainModel(
      api,
      parseLocalModelPreference({ id: "unknown", active: true }),
    ),
    { source: "api" },
  );
});
test("both local models and all API providers remain available without mutating API settings", () => {
  const before = JSON.stringify(api);
  const combined = combineModelRegistries(api, local, { source: "api" })!;
  assert.equal(JSON.stringify(api), before);
  assert.deepEqual(combined.providers.slice(0, 2), api.providers);
  assert.deepEqual(combined.models.slice(0, 2), api.models);
  assert.deepEqual(combined.routes, api.routes);
  assert.equal(combined.thinkingLevel, "high");
  assert.deepEqual(
    combined.models.map((model) => model.id),
    ["api-main", "api-other", "bonsai2-local", "bolt-e4b-local"],
  );
  assert.equal(combined.providerKeyStatus["custom-api"], true);
  assert.equal(combined.providerKeyStatus.codex, true);
});
test("using local chat preserves API specialist routes and API credential status", () => {
  const combined = combineModelRegistries(api, local, {
    source: "local",
    id: "bolt-e4b-local",
  })!;
  assert.equal(combined.routes.main, "bolt-e4b-local");
  assert.equal(combined.routes.delegate, "api-other");
  assert.equal(combined.routes.vision, "api-other");
  assert.equal(combined.routes.imageGeneration, "api-other");
  assert.equal(combined.routes.videoGeneration, "api-other");
  assert.equal(combined.providerKeyStatus["custom-api"], true);
  assert.equal(combined.thinkingLevel, "off");
});
test("an unavailable explicit local model never silently redirects a prompt to an API", () => {
  const choice = chooseMainModel(api, { id: "bonsai2-local", active: true });
  const combined = combineModelRegistries(api, null, choice)!;
  assert.equal(combined.routes.main, "bonsai2-local");
  assert.deepEqual(combined.models, api.models);
});
test("local-only and API-only installations both remain usable", () => {
  assert.equal(
    combineModelRegistries(null, null, {
      source: "local",
      id: "bonsai2-local",
    }),
    null,
  );
  assert.deepEqual(combineModelRegistries(api, null, { source: "api" }), api);
  assert.deepEqual(
    combineModelRegistries(null, local, {
      source: "local",
      id: "bonsai2-local",
    }),
    local,
  );
});
