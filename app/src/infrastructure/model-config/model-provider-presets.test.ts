import assert from "node:assert/strict";
import test from "node:test";

import {
  applyModelProviderPreset,
  CUSTOM_MODEL_PROVIDER_PRESET_ID,
  inferModelProviderPresetId,
  MODEL_PROVIDER_PRESETS,
  modelProviderPresetById,
  type ModelProviderPresetSelection,
} from "./model-provider-presets.ts";

test("provider presets have unique ids and fixed HTTPS API roots", () => {
  assert.equal(
    new Set(MODEL_PROVIDER_PRESETS.map((preset) => preset.id)).size,
    MODEL_PROVIDER_PRESETS.length,
  );
  assert.equal(
    new Set(MODEL_PROVIDER_PRESETS.map((preset) => preset.baseUrl)).size,
    MODEL_PROVIDER_PRESETS.length,
  );
  for (const preset of MODEL_PROVIDER_PRESETS) {
    assert.match(preset.baseUrl, /^https:\/\//u);
    assert.doesNotMatch(preset.baseUrl, /\/$/u);
  }
});

test("OpenCode Go, GLM, and Volcengine presets use their compatible API roots", () => {
  assert.deepEqual(modelProviderPresetById("openai-codex"), {
    id: "openai-codex",
    name: "Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    protocol: "responses",
    kind: "openai-codex",
  });
  assert.deepEqual(modelProviderPresetById("opencode-go"), {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "openai-compatible-models-only",
  });
  assert.deepEqual(modelProviderPresetById("glm"), {
    id: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "glm-standard-billing",
  });
  assert.deepEqual(modelProviderPresetById("glm-coding-plan"), {
    id: "glm-coding-plan",
    name: "GLM Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    protocol: "chat-completions",
    kind: "openai-compatible",
    note: "glm-coding-plan-billing",
  });
  assert.deepEqual(modelProviderPresetById("volcengine-ark"), {
    id: "volcengine-ark",
    name: "Volcengine Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "model-or-endpoint-id",
  });
  assert.deepEqual(modelProviderPresetById("volcengine-ark-coding-plan"), {
    id: "volcengine-ark-coding-plan",
    name: "Volcengine Ark Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "volcengine-coding-plan-billing",
  });
  assert.deepEqual(modelProviderPresetById("volcengine-ark-agent-plan"), {
    id: "volcengine-ark-agent-plan",
    name: "Volcengine Ark Agent Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    protocol: "responses",
    kind: "openai-compatible",
    note: "volcengine-agent-plan-key",
  });
});

test("saved endpoints are inferred as presets and unknown endpoints stay custom", () => {
  assert.equal(
    inferModelProviderPresetId({
      name: "Existing GLM account",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      protocol: "chat-completions",
      kind: "openai-compatible",
    }),
    "glm",
  );
  assert.equal(
    inferModelProviderPresetId({
      name: "Private gateway",
      baseUrl: "https://models.example.test/v1",
      protocol: "responses",
      kind: "openai-compatible",
    }),
    CUSTOM_MODEL_PROVIDER_PRESET_ID,
  );
});

test("changing preset clears a draft key and requires replacing a stored key", () => {
  const current: ModelProviderPresetSelection = {
    presetId: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
    kind: "openai-compatible",
    apiKeyDraft: "draft-secret",
    hasStoredApiKey: true,
    apiKeyNeedsReplacement: false,
  };
  const next = applyModelProviderPreset(current, "glm");
  assert.deepEqual(next, {
    presetId: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat-completions",
    kind: "openai-compatible",
    apiKeyDraft: "",
    hasStoredApiKey: true,
    apiKeyNeedsReplacement: true,
  });
});

test("choosing custom unlocks fields without changing the active endpoint", () => {
  const current: ModelProviderPresetSelection = {
    presetId: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    protocol: "chat-completions",
    kind: "openai-compatible",
    apiKeyDraft: "",
    hasStoredApiKey: true,
    apiKeyNeedsReplacement: false,
  };
  assert.deepEqual(
    applyModelProviderPreset(current, CUSTOM_MODEL_PROVIDER_PRESET_ID),
    { ...current, presetId: CUSTOM_MODEL_PROVIDER_PRESET_ID },
  );
});
