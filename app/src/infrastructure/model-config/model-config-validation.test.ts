import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_THINKING_LEVEL,
  ModelConfigValidationError,
  normalizeModelBaseUrl,
  normalizeModelThinkingLevel,
  validateModelConfig,
} from "./model-config-validation.ts";

test("normalizes OpenAI-compatible base URLs", () => {
  assert.equal(
    normalizeModelBaseUrl(" https://example.com "),
    "https://example.com/v1",
  );
  assert.equal(
    normalizeModelBaseUrl("https://example.com/openai/v1/"),
    "https://example.com/openai/v1",
  );
});

test("allows local HTTP model endpoints in release and public HTTP only in development", () => {
  const originalDevelopmentFlag = Object.getOwnPropertyDescriptor(
    globalThis,
    "__DEV__",
  );
  try {
    Object.defineProperty(globalThis, "__DEV__", {
      configurable: true,
      value: false,
    });
    assert.equal(
      normalizeModelBaseUrl("http://192.168.51.72:8787/v1"),
      "http://192.168.51.72:8787/v1",
    );
    assert.equal(
      normalizeModelBaseUrl("http://raspi.local:8787/v1"),
      "http://raspi.local:8787/v1",
    );
    assert.throws(
      () => normalizeModelBaseUrl("http://models.example.com/v1"),
      (error) =>
        error instanceof ModelConfigValidationError &&
        error.field === "baseUrl" &&
        /公网.*HTTPS/u.test(error.message),
    );

    Object.defineProperty(globalThis, "__DEV__", {
      configurable: true,
      value: true,
    });
    assert.equal(
      normalizeModelBaseUrl("http://models.example.com/v1"),
      "http://models.example.com/v1",
    );
  } finally {
    if (originalDevelopmentFlag) {
      Object.defineProperty(globalThis, "__DEV__", originalDevelopmentFlag);
    } else {
      Reflect.deleteProperty(globalThis, "__DEV__");
    }
  }
});

test("rejects non-HTTPS URLs and URLs containing secret-like components", () => {
  for (const value of [
    "ftp://example.com/v1",
    "https://user:password@example.com/v1",
    "https://example.com/v1?token=secret",
    "https://example.com/v1#secret",
  ]) {
    assert.throws(
      () => normalizeModelBaseUrl(value),
      ModelConfigValidationError,
    );
  }
});

test("validates and trims every required model field", () => {
  assert.deepEqual(
    validateModelConfig({
      baseUrl: " https://example.com/v1/ ",
      model: " model-1 ",
      apiKey: " key-value ",
    }),
    {
      baseUrl: "https://example.com/v1",
      model: "model-1",
      apiKey: "key-value",
      thinkingLevel: DEFAULT_MODEL_THINKING_LEVEL,
    },
  );

  for (const [field, input] of [
    ["baseUrl", { baseUrl: "", model: "model-1", apiKey: "key" }],
    ["model", { baseUrl: "https://example.com", model: " ", apiKey: "key" }],
    [
      "apiKey",
      { baseUrl: "https://example.com", model: "model-1", apiKey: "" },
    ],
  ] as const) {
    assert.throws(
      () => validateModelConfig(input),
      (error) =>
        error instanceof ModelConfigValidationError && error.field === field,
    );
  }
});

test("uses Pi thinking levels and rejects invented values", () => {
  assert.equal(normalizeModelThinkingLevel(undefined), "medium");
  assert.equal(normalizeModelThinkingLevel("xhigh"), "xhigh");
  assert.throws(
    () => normalizeModelThinkingLevel("ultra"),
    (error) =>
      error instanceof ModelConfigValidationError &&
      error.field === "thinkingLevel",
  );
});

test("rejects control characters in model names and API keys", () => {
  assert.throws(
    () =>
      validateModelConfig({
        baseUrl: "https://example.com",
        model: "model\nname",
        apiKey: "key",
      }),
    ModelConfigValidationError,
  );
  assert.throws(
    () =>
      validateModelConfig({
        baseUrl: "https://example.com",
        model: "model",
        apiKey: "key\nvalue",
      }),
    ModelConfigValidationError,
  );
});
