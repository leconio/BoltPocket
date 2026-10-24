import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAICompatibleImageGenerationService,
  requestOpenAICompatibleImage,
  type GeneratedImageStorageInput,
} from "./openai-compatible-image-generation.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

test("OpenAI-compatible image generation posts the selected model and validates Base64 image bytes", async () => {
  const requests: { url: string; authorization: string; body: unknown }[] = [];
  const result = await requestOpenAICompatibleImage({
    baseUrl: "https://images.example/v1",
    modelId: "image-model-1",
    apiKey: "fixture-secret-key",
    prompt: "A small orange cat",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.deepEqual(requests, [
    {
      url: "https://images.example/v1/images/generations",
      authorization: "Bearer fixture-secret-key",
      body: {
        model: "image-model-1",
        prompt: "A small orange cat",
        n: 1,
      },
    },
  ]);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.byteLength, PNG_BYTES.byteLength);
  assert.equal(result.base64, PNG_BASE64);
});

test("image generation downloads a validated HTTPS result when the provider returns a URL", async () => {
  const calls: string[] = [];
  const result = await requestOpenAICompatibleImage({
    baseUrl: "https://images.example/v1",
    modelId: "image-model-1",
    apiKey: "fixture-secret-key",
    prompt: "A blue circle",
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/images/generations")) {
        return new Response(
          JSON.stringify({
            data: [{ url: "https://cdn.example/generated/result.png" }],
          }),
          { status: 200 },
        );
      }
      return new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "Content-Length": String(PNG_BYTES.byteLength),
          "Content-Type": "image/png",
        },
      });
    },
  });

  assert.deepEqual(calls, [
    "https://images.example/v1/images/generations",
    "https://cdn.example/generated/result.png",
  ]);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.base64, PNG_BASE64);
});

test("provider failures are bounded and redact token-shaped values", async () => {
  const secret = "fixture-image-secret-must-not-escape";
  await assert.rejects(
    requestOpenAICompatibleImage({
      baseUrl: "https://images.example/v1",
      modelId: "image-model-1",
      apiKey: secret,
      prompt: "fixture",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: `invalid Bearer ${secret}` } }),
          { status: 401 },
        ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /图片模型请求失败/u);
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      return true;
    },
  );
});

test("oversized provider responses fail before their bodies are buffered", async () => {
  let bodyRead = false;
  await assert.rejects(
    requestOpenAICompatibleImage({
      baseUrl: "https://images.example/v1",
      modelId: "image-model-1",
      apiKey: "fixture-secret-key",
      prompt: "fixture",
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Length": String(20 * 1024 * 1024) }),
          text: async () => {
            bodyRead = true;
            return "";
          },
        }) as Response,
    }),
    /超过大小限制/u,
  );
  assert.equal(bodyRead, false);
});

test("the service exposes sanitized metadata, requests consent, and stores the generated image", async () => {
  const stored: GeneratedImageStorageInput[] = [];
  const consents: string[] = [];
  const service = new OpenAICompatibleImageGenerationService({
    modelConfigProvider: async () => ({
      baseUrl: "https://images.example/v1",
      model: "image-model-1",
      apiKey: "fixture-secret-key",
      contextWindow: 128_000,
      thinkingLevel: "off",
      providerId: "provider-images",
      providerKind: "openai-compatible",
      protocol: "chat-completions",
      modelProfileId: "profile-image-model-1",
      providerName: "Fixture Images",
      capabilities: {
        chat: false,
        tools: false,
        vision: false,
        reasoning: false,
        imageGeneration: true,
        videoGeneration: false,
      },
    }),
    authorizeModelAccess: async (config) => {
      consents.push(`${config.providerId}:${config.model}`);
      return true;
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
        status: 200,
      }),
    storage: {
      save: async (input) => {
        stored.push(input);
        return {
          id: "generated-image-one",
          kind: "generated-image",
          uri: "file:///documents/generated-image-one.png",
          name: "generated-image-one.png",
          mimeType: input.mimeType,
          sizeBytes: input.byteLength,
          providerName: input.providerName,
          modelId: input.modelId,
          createdAt: "2026-08-09T12:00:00.000Z",
        };
      },
    },
  });

  assert.deepEqual(await service.capability(), {
    providerId: "provider-images",
    providerName: "Fixture Images",
    modelProfileId: "profile-image-model-1",
    modelId: "image-model-1",
  });
  const result = await service.generate({
    taskId: "task-image-one",
    parentRunId: "run-one",
    conversationId: "conversation-one",
    projectId: "project-one",
    prompt: "  A small orange cat  ",
  });
  assert.deepEqual(consents, ["provider-images:image-model-1"]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.projectId, "project-one");
  assert.equal(stored[0]?.providerName, "Fixture Images");
  assert.equal(result.attachment.id, "generated-image-one");
  assert.equal(result.capability.modelId, "image-model-1");
});
