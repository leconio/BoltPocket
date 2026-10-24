import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAICompatibleVideoGenerationService,
  requestOpenAICompatibleVideo,
  type GeneratedVideoStorageInput,
} from "./openai-compatible-video-generation.ts";

test("Seedance-compatible video generation creates, polls, and returns the signed result URL", async () => {
  const requests: { url: string; method: string; body?: unknown }[] = [];
  let now = 0;
  const result = await requestOpenAICompatibleVideo({
    baseUrl: "https://ark.example/api/v3",
    modelId: "doubao-seedance-2-5-260628",
    apiKey: "fixture-video-key",
    prompt: "A green glass sphere rotates slowly.",
    ratio: "16:9",
    durationSeconds: 4,
    generateAudio: true,
    referenceImages: [{ mimeType: "image/png", base64: "iVBORw0KGgo=" }],
    referenceUrls: [
      { type: "image_url", url: "https://media.example/reference.jpg" },
      { type: "video_url", url: "https://media.example/reference.mp4" },
      { type: "audio_url", url: "https://media.example/reference.mp3" },
    ],
    pollIntervalMs: 250,
    pollTimeoutMs: 2_000,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as unknown }
          : {}),
      });
      return url.endsWith("/tasks")
        ? new Response(JSON.stringify({ id: "cgt-fixture-one" }), {
            status: 200,
          })
        : new Response(
            JSON.stringify({
              id: "cgt-fixture-one",
              status: "succeeded",
              content: {
                video_url:
                  "https://media.example/result.mp4?X-Signature=fixture",
              },
            }),
            { status: 200 },
          );
    },
  });

  assert.equal(result.taskId, "cgt-fixture-one");
  assert.equal(
    result.videoUrl,
    "https://media.example/result.mp4?X-Signature=fixture",
  );
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://ark.example/api/v3/contents/generations/tasks",
  );
  assert.deepEqual(requests[0]?.body, {
    model: "doubao-seedance-2-5-260628",
    content: [
      { type: "text", text: "A green glass sphere rotates slowly." },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
        role: "reference_image",
      },
      {
        type: "image_url",
        image_url: { url: "https://media.example/reference.jpg" },
        role: "reference_image",
      },
      {
        type: "video_url",
        video_url: { url: "https://media.example/reference.mp4" },
        role: "reference_video",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://media.example/reference.mp3" },
        role: "reference_audio",
      },
    ],
    generate_audio: true,
    ratio: "16:9",
    duration: 4,
    watermark: false,
  });
});

test("Seedance 1.x uses the legacy prompt flags shown by Ark quick access", async () => {
  const requests: { url: string; method: string; body?: unknown }[] = [];
  let now = 0;
  await requestOpenAICompatibleVideo({
    baseUrl: "https://ark.example/api/v3",
    modelId: "doubao-seedance-1-5-pro-251215",
    apiKey: "fixture-video-key",
    prompt: "A paper plane flies through a canyon.",
    ratio: "16:9",
    durationSeconds: 5,
    generateAudio: true,
    referenceUrls: [
      { type: "image_url", url: "https://media.example/reference.jpg" },
    ],
    pollIntervalMs: 250,
    pollTimeoutMs: 2_000,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as unknown }
          : {}),
      });
      return url.endsWith("/tasks")
        ? new Response(JSON.stringify({ id: "cgt-seedance-one" }), {
            status: 200,
          })
        : new Response(
            JSON.stringify({
              status: "succeeded",
              content: { video_url: "https://media.example/result.mp4" },
            }),
            { status: 200 },
          );
    },
  });

  assert.deepEqual(requests[0]?.body, {
    model: "doubao-seedance-1-5-pro-251215",
    content: [
      {
        type: "text",
        text: "A paper plane flies through a canyon. --ratio 16:9 --duration 5 --camerafixed false --watermark false",
      },
      {
        type: "image_url",
        image_url: { url: "https://media.example/reference.jpg" },
      },
    ],
  });
});

test("Seedance 1.x rejects unsupported durations and non-image references before sending", async () => {
  const common = {
    baseUrl: "https://ark.example/api/v3",
    modelId: "doubao-seedance-1-5-pro-251215",
    apiKey: "fixture-video-key",
    prompt: "fixture",
    ratio: "16:9" as const,
    generateAudio: true,
    fetchImpl: async () => {
      throw new Error("request should not be sent");
    },
  };
  await assert.rejects(
    requestOpenAICompatibleVideo({ ...common, durationSeconds: 4 }),
    /5 到 10 秒/u,
  );
  await assert.rejects(
    requestOpenAICompatibleVideo({
      ...common,
      durationSeconds: 5,
      referenceUrls: [
        { type: "video_url", url: "https://media.example/reference.mp4" },
      ],
    }),
    /只支持文本和图片/u,
  );
});

test("Seedance task failures are bounded and redact credentials", async () => {
  const secret = "ark-secret-must-not-escape";
  let now = 0;
  await assert.rejects(
    requestOpenAICompatibleVideo({
      baseUrl: "https://ark.example/api/v3",
      modelId: "seedance-fixture",
      apiKey: secret,
      prompt: "fixture",
      ratio: "9:16",
      durationSeconds: 4,
      generateAudio: false,
      pollIntervalMs: 250,
      pollTimeoutMs: 2_000,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      fetchImpl: async (input) =>
        String(input).endsWith("/tasks")
          ? new Response(JSON.stringify({ id: "cgt-fixture-failed" }), {
              status: 200,
            })
          : new Response(
              JSON.stringify({
                status: "failed",
                error: { message: `invalid Bearer ${secret}` },
              }),
              { status: 200 },
            ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /视频生成失败/u);
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      return true;
    },
  );
});

test("video service exposes only sanitized capability and stores the downloaded result", async () => {
  const stored: GeneratedVideoStorageInput[] = [];
  const consentClasses: string[][] = [];
  let now = 0;
  const service = new OpenAICompatibleVideoGenerationService({
    modelConfigProvider: async () => ({
      baseUrl: "https://ark.example/api/v3",
      model: "doubao-seedance-2-5-260628",
      apiKey: "fixture-video-key",
      contextWindow: 128_000,
      thinkingLevel: "off",
      providerId: "provider-video",
      providerKind: "openai-compatible",
      protocol: "chat-completions",
      modelProfileId: "profile-video",
      providerName: "Fixture Video",
      capabilities: {
        chat: false,
        tools: false,
        vision: false,
        reasoning: false,
        imageGeneration: false,
        videoGeneration: true,
      },
    }),
    authorizeModelAccess: async (_config, dataClasses) => {
      consentClasses.push([...dataClasses]);
      return true;
    },
    pollIntervalMs: 250,
    pollTimeoutMs: 2_000,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    fetchImpl: async (input) =>
      String(input).endsWith("/tasks")
        ? new Response(JSON.stringify({ id: "cgt-service-one" }), {
            status: 200,
          })
        : new Response(
            JSON.stringify({
              status: "succeeded",
              content: { video_url: "https://media.example/result.mp4" },
            }),
            { status: 200 },
          ),
    storage: {
      saveFromUrl: async (input) => {
        stored.push(input);
        return {
          id: "generated-video-one",
          kind: "generated-video",
          uri: "file:///documents/generated-video-one.mp4",
          name: "generated-video-one.mp4",
          mimeType: "video/mp4",
          sizeBytes: 4_096,
          durationSeconds: input.durationSeconds,
          providerName: input.providerName,
          modelId: input.modelId,
          createdAt: "2026-08-09T12:00:00.000Z",
        };
      },
    },
  });

  assert.deepEqual(await service.capability(), {
    providerId: "provider-video",
    providerName: "Fixture Video",
    modelProfileId: "profile-video",
    modelId: "doubao-seedance-2-5-260628",
  });
  const result = await service.generate({
    taskId: "task-video-one",
    parentRunId: "run-video-one",
    conversationId: "conversation-one",
    projectId: "project-one",
    prompt: "  A green sphere rotates.  ",
    durationSeconds: 4,
    referenceImages: [{ mimeType: "image/png", base64: "iVBORw0KGgo=" }],
    referenceUrls: [
      { type: "audio_url", url: "https://media.example/reference.mp3" },
    ],
  });
  assert.deepEqual(consentClasses, [["message", "attachments"]]);
  assert.equal(stored[0]?.downloadUrl, "https://media.example/result.mp4");
  assert.equal(result.attachment.id, "generated-video-one");
  assert.equal(result.providerTaskId, "cgt-service-one");
});
