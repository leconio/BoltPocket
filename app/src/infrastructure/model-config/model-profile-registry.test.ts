import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_CAPABILITIES,
  legacyModelRegistry,
  providerApiKeyStorageKey,
  resolvePublicModelRoute,
  validatePublicModelRegistry,
} from "./model-profile-registry.ts";

function registryFixture() {
  return {
    schema: 2,
    providers: [
      {
        id: "provider-main",
        name: "对话服务",
        kind: "openai-compatible",
        baseUrl: "https://chat.example/v1/",
      },
      {
        id: "provider-vision",
        name: "视觉服务",
        kind: "openai-compatible",
        baseUrl: "https://vision.example",
      },
    ],
    models: [
      {
        id: "model-main",
        providerId: "provider-main",
        name: "主模型",
        modelId: "chat-model",
        capabilities: {
          ...DEFAULT_MODEL_CAPABILITIES,
          vision: false,
        },
      },
      {
        id: "model-vision",
        providerId: "provider-vision",
        name: "图片识别",
        modelId: "vision-model",
        capabilities: {
          chat: true,
          tools: false,
          vision: true,
          reasoning: false,
          imageGeneration: false,
          videoGeneration: false,
        },
      },
      {
        id: "model-delegate",
        providerId: "provider-main",
        name: "协作模型",
        modelId: "delegate-model",
        capabilities: {
          chat: true,
          tools: true,
          vision: false,
          reasoning: false,
          imageGeneration: false,
          videoGeneration: false,
        },
      },
    ],
    routes: {
      main: "model-main",
      delegate: "model-delegate",
      vision: "model-vision",
    },
    thinkingLevel: "high",
  } as const;
}

test("validates multiple providers and resolves models by specialist role", () => {
  const registry = validatePublicModelRegistry(registryFixture());
  assert.equal(registry.schema, 6);
  assert.equal(registry.providers[0]?.protocol, "chat-completions");
  assert.deepEqual(registry.models[0]?.purposes, ["chat"]);
  assert.equal(registry.models[0]?.contextWindow, 128_000);
  assert.deepEqual(registry.models[1]?.purposes, ["vision"]);
  assert.equal(registry.providers[0]?.baseUrl, "https://chat.example/v1");
  assert.equal(registry.providers[1]?.baseUrl, "https://vision.example/v1");
  assert.equal(
    resolvePublicModelRoute(registry, "main")?.profile.modelId,
    "chat-model",
  );
  assert.equal(
    resolvePublicModelRoute(registry, "vision")?.provider.id,
    "provider-vision",
  );
  assert.equal(
    resolvePublicModelRoute(registry, "delegate")?.profile.modelId,
    "delegate-model",
  );
  assert.equal(resolvePublicModelRoute(registry, "videoGeneration"), undefined);
});

test("the current schema keeps an explicit Responses provider protocol", () => {
  const migrated = validatePublicModelRegistry(registryFixture());
  const configured = validatePublicModelRegistry({
    ...migrated,
    providers: migrated.providers.map((provider) =>
      provider.id === "provider-main"
        ? { ...provider, protocol: "responses" }
        : provider,
    ),
  });
  assert.equal(configured.providers[0]?.protocol, "responses");
});

test("Codex OAuth is pinned to the official endpoint and cannot claim media generation", () => {
  const migrated = validatePublicModelRegistry(registryFixture());
  const codex = validatePublicModelRegistry({
    ...migrated,
    providers: migrated.providers.map((provider) =>
      provider.id === "provider-main"
        ? {
            ...provider,
            kind: "openai-codex",
            protocol: "responses",
            baseUrl: "https://chatgpt.com/backend-api",
          }
        : provider,
    ),
  });
  assert.equal(codex.providers[0]?.kind, "openai-codex");
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...codex,
        providers: codex.providers.map((provider) =>
          provider.id === "provider-main"
            ? { ...provider, baseUrl: "https://gateway.example/v1" }
            : provider,
        ),
      }),
    /官方 ChatGPT Codex/u,
  );
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...codex,
        models: codex.models.map((model) =>
          model.providerId === "provider-main"
            ? {
                ...model,
                purposes: ["chat", "imageGeneration"],
                capabilities: {
                  ...model.capabilities,
                  imageGeneration: true,
                },
              }
            : model,
        ),
      }),
    /不支持图片或视频生成/u,
  );
});

test("rejects a stored HTTP provider in production", () => {
  const fixture = registryFixture();
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...fixture,
        providers: fixture.providers.map((provider) =>
          provider.id === "provider-main"
            ? { ...provider, baseUrl: "http://models.example.test/v1" }
            : provider,
        ),
      }),
    /公网.*HTTPS/u,
  );
});

test("keeps explicitly selected purposes separate from model discovery", () => {
  const migrated = validatePublicModelRegistry(registryFixture());
  const configured = validatePublicModelRegistry({
    ...migrated,
    models: migrated.models.map((model) =>
      model.id === "model-delegate"
        ? { ...model, purposes: ["chat", "delegate"] }
        : model,
    ),
  });
  assert.deepEqual(
    configured.models.find((model) => model.id === "model-delegate")?.purposes,
    ["chat", "delegate"],
  );
});

test("routes a dedicated image-output model without pretending it is a chat model", () => {
  const migrated = validatePublicModelRegistry(registryFixture());
  const registry = validatePublicModelRegistry({
    ...migrated,
    models: [
      ...migrated.models,
      {
        id: "model-image-output",
        providerId: "provider-vision",
        name: "图片生成",
        modelId: "gpt-image-1.5",
        contextWindow: 128_000,
        purposes: ["imageGeneration"],
        capabilities: {
          chat: false,
          tools: false,
          vision: false,
          reasoning: false,
          imageGeneration: true,
          videoGeneration: false,
        },
      },
    ],
    routes: {
      ...migrated.routes,
      imageGeneration: "model-image-output",
    },
  });
  const route = resolvePublicModelRoute(registry, "imageGeneration");
  assert.equal(route?.profile.modelId, "gpt-image-1.5");
  assert.equal(route?.provider.id, "provider-vision");
  assert.equal(route?.profile.capabilities.chat, false);
});

test("rejects incompatible routes and dangling provider references", () => {
  const fixture = registryFixture();
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...fixture,
        routes: { main: "model-vision" },
      }),
    /对话和工具调用/u,
  );
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...fixture,
        models: fixture.models.map((model) =>
          model.id === "model-delegate"
            ? {
                ...model,
                capabilities: { ...model.capabilities, tools: false },
              }
            : model,
        ),
      }),
    /协作模型必须支持对话和工具调用/u,
  );
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...fixture,
        models: [
          { ...fixture.models[0], providerId: "provider-missing" },
          fixture.models[1],
        ],
      }),
    /不存在的服务/u,
  );
});

test("maps one legacy model into a default main and vision route", () => {
  const registry = legacyModelRegistry({
    baseUrl: "https://legacy.example/v1",
    model: "legacy-model",
    thinkingLevel: "medium",
  });
  assert.equal(registry.providers.length, 1);
  assert.equal(registry.models.length, 1);
  assert.equal(registry.routes.main, "model-default");
  assert.equal(registry.routes.vision, "model-default");
  assert.equal(registry.models[0]?.capabilities.vision, true);
  assert.equal(registry.models[0]?.contextWindow, 128_000);
});

test("schema five validates the configured context window", () => {
  const migrated = validatePublicModelRegistry(registryFixture());
  const configured = validatePublicModelRegistry({
    ...migrated,
    models: migrated.models.map((model) =>
      model.id === "model-main" ? { ...model, contextWindow: 400_000 } : model,
    ),
  });
  assert.equal(configured.models[0]?.contextWindow, 400_000);
  assert.throws(
    () =>
      validatePublicModelRegistry({
        ...configured,
        models: configured.models.map((model) => ({
          ...model,
          contextWindow: 4_096,
        })),
      }),
    /上下文窗口/u,
  );
});

test("provider credential keys stay inside SecureStore's portable key alphabet", () => {
  assert.equal(
    providerApiKeyStorageKey("provider-one"),
    "boltpocket.model.provider-key.v2.provider-one",
  );
  assert.throws(() => providerApiKeyStorageKey("provider:bad"), /编号无效/u);
});
