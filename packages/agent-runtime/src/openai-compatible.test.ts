import assert from "node:assert/strict";
import test from "node:test";
import { zstdDecompressSync } from "node:zlib";

import { Type } from "typebox";

import type { RuntimeTool } from "./contracts.ts";
import {
  createOpenAICompatiblePiRuntime,
  listOpenAICodexModelIds,
  normalizeOpenAIBaseUrl,
  OPENAI_CODEX_RUNTIME_BASE_URL,
  resolveOpenAICodexModelCapacity,
  resolveOpenAICompatibleModelCapacity,
} from "./openai-compatible.ts";
import type { ModelStreamMetrics } from "./model-stream-coalescing.ts";

function sseResponse(chunks: readonly Record<string, unknown>[]) {
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function requestJson(init: RequestInit | undefined) {
  const body = init?.body;
  assert.ok(body, "expected a provider request body");
  if (typeof body === "string") {
    return JSON.parse(body) as Record<string, unknown>;
  }
  assert.ok(ArrayBuffer.isView(body));
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const headers = new Headers(init?.headers);
  const decoded =
    headers.get("content-encoding") === "zstd"
      ? zstdDecompressSync(bytes)
      : bytes;
  return JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
}

function fragmentedSseResponse(chunks: readonly Record<string, unknown>[]) {
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  const encoded = new TextEncoder().encode(body);
  const fragmentSizes = [1, 2, 5, 3, 8, 13, 4, 21];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        let offset = 0;
        let fragmentIndex = 0;
        while (offset < encoded.length) {
          const fragmentSize = fragmentSizes[fragmentIndex] ?? 7;
          controller.enqueue(encoded.slice(offset, offset + fragmentSize));
          offset += fragmentSize;
          fragmentIndex = (fragmentIndex + 1) % fragmentSizes.length;
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

function interruptedSseResponse(chunkValue: Record<string, unknown>) {
  const encoded = new TextEncoder().encode(
    `data: ${JSON.stringify(chunkValue)}\n\n`,
  );
  let pullCount = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1;
          controller.enqueue(encoded);
          return;
        }
        controller.error(new Error("fixture transport interrupted"));
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

function chunk(
  sequence: number,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  return {
    id: `chatcmpl-${sequence}`,
    object: "chat.completion.chunk",
    created: sequence,
    model: "fixture-model",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

test("bare OpenAI-compatible origins use the conventional /v1 API root", () => {
  assert.equal(
    normalizeOpenAIBaseUrl("https://example.com"),
    "https://example.com/v1",
  );
});

test("explicit OpenAI-compatible API paths are preserved", () => {
  assert.equal(
    normalizeOpenAIBaseUrl("https://example.com/v1/"),
    "https://example.com/v1",
  );
  assert.equal(
    normalizeOpenAIBaseUrl("https://example.com/openai"),
    "https://example.com/openai",
  );
});

test("known reasoning models reuse upstream output capacity", () => {
  assert.deepEqual(resolveOpenAICompatibleModelCapacity("GPT-5.6-Sol"), {
    contextWindow: 272_000,
    maxTokens: 128_000,
  });
  assert.deepEqual(resolveOpenAICompatibleModelCapacity("private-model"), {
    contextWindow: 128_000,
    maxTokens: 8_192,
  });
});

test("personal Codex transport is pinned to ChatGPT and uses the account-scoped SSE endpoint", async () => {
  assert.ok(listOpenAICodexModelIds().includes("gpt-5.4"));
  assert.deepEqual(resolveOpenAICodexModelCapacity("GPT-5.4"), {
    contextWindow: 272_000,
    maxTokens: 128_000,
    supportsImages: true,
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
  });
  const token = fixtureCodexToken("account-fixture");
  let requestUrl = "";
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: OPENAI_CODEX_RUNTIME_BASE_URL,
    apiKey: token,
    modelId: "gpt-5.4",
    providerKind: "openai-codex",
    protocol: "responses",
    fetch: async (input, init) => {
      requestUrl = String(input);
      const request = requestJson(init);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${token}`);
      assert.equal(headers.get("chatgpt-account-id"), "account-fixture");
      assert.equal(headers.get("originator"), "pi");
      assert.equal(headers.get("accept"), "text/event-stream");
      assert.equal(request.stream, true);
      assert.deepEqual(request.reasoning, { effort: "medium" });
      return sseResponse([
        {
          type: "response.created",
          response: { id: "resp_codex_fixture" },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            status: "in_progress",
            id: "msg_codex_fixture",
          },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          item_id: "msg_codex_fixture",
          delta: "Codex ready.",
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            status: "completed",
            id: "msg_codex_fixture",
            content: [{ type: "output_text", text: "Codex ready." }],
          },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_codex_fixture",
            status: "completed",
            output: [],
            usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
          },
        },
      ]);
    },
  });
  await runtime.createSession({
    id: "openai-codex-personal",
    systemPrompt: "Return text.",
    tools: [],
    thinkingLevel: "medium",
  });

  const result = await runtime.send("openai-codex-personal", "Hello");

  assert.equal(result.status, "completed");
  assert.equal(result.text, "Codex ready.");
  assert.equal(requestUrl, "https://chatgpt.com/backend-api/codex/responses");
  assert.throws(
    () =>
      createOpenAICompatiblePiRuntime({
        baseUrl: "https://gateway.example/v1",
        apiKey: token,
        modelId: "gpt-5.4",
        providerKind: "openai-codex",
      }),
    /official ChatGPT Codex endpoint/u,
  );
});

function fixtureCodexToken(accountId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1_000) + 3_600,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

test("known model capacity reaches the provider request instead of the generic 8K cap", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "gpt-5.6-sol",
    supportsImages: false,
    fetch: async (_input, init) => {
      const body = init?.body;
      assert.equal(typeof body, "string");
      requestBody = JSON.parse(body as string) as Record<string, unknown>;
      return sseResponse([
        chunk(1, { role: "assistant", content: "完成。" }),
        chunk(1, {}, "stop"),
      ]);
    },
  });
  await runtime.createSession({
    id: "known-model-output-capacity",
    systemPrompt: "Return text.",
    tools: [],
  });

  const result = await runtime.send(
    "known-model-output-capacity",
    "Generate a long file when needed.",
  );

  assert.equal(result.status, "completed");
  assert.equal(requestBody?.max_tokens, 128_000);
});

test("provider and assistant retry policy is bounded at the runtime boundary", () => {
  const base = {
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
  };
  assert.throws(
    () =>
      createOpenAICompatiblePiRuntime({
        ...base,
        providerMaxRetries: 6,
      }),
    /providerMaxRetries must be an integer/u,
  );
  assert.throws(
    () =>
      createOpenAICompatiblePiRuntime({
        ...base,
        providerTimeoutMs: 999,
      }),
    /providerTimeoutMs must be an integer/u,
  );
  assert.throws(
    () =>
      createOpenAICompatiblePiRuntime({
        ...base,
        assistantMaxRetries: 6,
      }),
    /assistantMaxRetries must be an integer/u,
  );
  assert.throws(
    () =>
      createOpenAICompatiblePiRuntime({
        ...base,
        assistantRetryBaseDelayMs: -1,
      }),
    /assistantRetryBaseDelayMs must be an integer/u,
  );
});

test("Pi AI accepts transport-fragmented SSE text when the provider omits usage", async () => {
  const requests: Record<string, unknown>[] = [];
  let observedMetrics: ModelStreamMetrics | undefined;
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    const body = init?.body;
    if (typeof body !== "string") {
      throw new Error("fixture expected a JSON request body");
    }
    requests.push(JSON.parse(body));
    return fragmentedSseResponse([
      chunk(1, { role: "assistant", content: "streamed " }),
      chunk(1, { content: "text" }),
      chunk(1, {}, "stop"),
    ]);
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: fetchMock,
    onModelStreamMetrics: (metrics) => {
      observedMetrics = metrics;
    },
  });
  await runtime.createSession({
    id: "openai-compatible-fragmented-text",
    systemPrompt: "Return text.",
    tools: [],
  });
  const deltas: string[] = [];
  runtime.subscribe("openai-compatible-fragmented-text", (event) => {
    if (event.type === "text_delta") deltas.push(event.delta);
  });

  const result = await runtime.send(
    "openai-compatible-fragmented-text",
    "Stream a response",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "streamed text");
  assert.deepEqual(deltas, ["streamed text"]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.stream_options, { include_usage: true });
  assert.equal(observedMetrics?.sourceDeltaEventCount, 2);
  assert.equal(observedMetrics?.sourceDeltaCharacters, 13);
  assert.equal(observedMetrics?.deliveredDeltaEventCount, 1);
  assert.equal(observedMetrics?.coalescedDeltaEventCount, 1);
});

test("Pi thinking level uses upstream reasoning_effort without exposing reasoning text", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    assert.equal(typeof init?.body, "string");
    requests.push(JSON.parse(init!.body as string) as Record<string, unknown>);
    return sseResponse([
      chunk(1, {
        role: "assistant",
        reasoning_content: "inspect context",
      }),
      chunk(1, { content: "最终回答。" }),
      chunk(1, {}, "stop"),
    ]);
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-reasoning-model",
    reasoning: true,
    supportsReasoningEffort: true,
    fetch: fetchMock,
  });
  await runtime.createSession({
    id: "openai-compatible-thinking",
    systemPrompt: "Think, then answer.",
    tools: [],
    thinkingLevel: "high",
  });
  let modelActivity = 0;
  runtime.subscribe("openai-compatible-thinking", (event) => {
    if (event.type === "model_activity") modelActivity += 1;
  });

  const result = await runtime.send(
    "openai-compatible-thinking",
    "Inspect the context.",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "最终回答。");
  assert.ok(modelActivity > 0);
  assert.equal(requests[0]?.reasoning_effort, "high");
});

test("OpenAI-compatible SSE tool calls traverse the production protocol adapter", async () => {
  const requests: Record<string, unknown>[] = [];
  const responses = [
    sseResponse([
      chunk(1, {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call-inspect",
            type: "function",
            function: {
              name: "inspect_target",
              arguments: '{"target":"docs/',
            },
          },
        ],
      }),
      chunk(1, {
        tool_calls: [
          {
            index: 0,
            function: { arguments: 'plan.txt"}' },
          },
        ],
      }),
      chunk(1, {}, "tool_calls"),
    ]),
    sseResponse([
      chunk(2, { role: "assistant", content: "协议工具闭环通过。" }),
      chunk(2, {}, "stop"),
    ]),
  ];
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    if (typeof init?.body !== "string") {
      throw new Error("fixture expected a JSON request body");
    }
    requests.push(JSON.parse(init.body));
    const response = responses.shift();
    assert.ok(response, "unexpected extra provider request");
    return response;
  };
  const parameters = Type.Object(
    { target: Type.String() },
    { additionalProperties: false },
  );
  let inspectedTarget = "";
  const inspectTool: RuntimeTool<typeof parameters> = {
    name: "inspect_target",
    label: "Inspect target",
    description: "Inspect one target without changing it.",
    risk: "read",
    parameters,
    execute: async ({ target }) => {
      inspectedTarget = target;
      return { content: `inspected ${target}`, details: { target } };
    },
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: fetchMock,
  });
  await runtime.createSession({
    id: "openai-compatible-sse-tool-loop",
    systemPrompt: "Use the inspection tool.",
    tools: [inspectTool],
  });

  const result = await runtime.send(
    "openai-compatible-sse-tool-loop",
    "Inspect the plan",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "协议工具闭环通过。");
  assert.equal(inspectedTarget, "docs/plan.txt");
  assert.equal(result.toolExecutions.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(responses.length, 0);
  assert.equal(
    (requests[0]?.tools as { function?: { name?: string } }[])[0]?.function
      ?.name,
    "inspect_target",
  );
  assert.equal(
    (requests[1]?.messages as { role?: string }[]).at(-1)?.role,
    "tool",
  );
});

test("Responses API reuses upstream Pi function-call parsing and stateless tool replay", async () => {
  const requests: Record<string, unknown>[] = [];
  const toolItem = {
    arguments: '{"a":7,"b":8}',
    call_id: "call_fixture_multiply",
    name: "multiply",
    type: "function_call",
    id: "fc_fixture_multiply",
    status: "completed",
  };
  const responses = [
    sseResponse([
      {
        type: "response.created",
        response: { id: "resp_fixture_one" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...toolItem, arguments: "", status: "in_progress" },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: toolItem.id,
        delta: '{"a":7,"b":8}',
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 0,
        item_id: toolItem.id,
        arguments: toolItem.arguments,
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: toolItem,
      },
      {
        type: "response.completed",
        response: {
          id: "resp_fixture_one",
          status: "completed",
          output: [toolItem],
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        },
      },
    ]),
    sseResponse([
      {
        type: "response.created",
        response: { id: "resp_fixture_two" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          status: "in_progress",
          id: "msg_fixture_two",
        },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: "msg_fixture_two",
        delta: "结果是 56。",
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          status: "completed",
          id: "msg_fixture_two",
          content: [{ type: "output_text", text: "结果是 56。" }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_fixture_two",
          status: "completed",
          output: [],
          usage: { input_tokens: 28, output_tokens: 6, total_tokens: 34 },
        },
      },
    ]),
  ];
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    assert.equal(typeof init?.body, "string");
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const response = responses.shift();
    assert.ok(response, "unexpected extra provider request");
    return response;
  };
  const parameters = Type.Object(
    { a: Type.Integer(), b: Type.Integer() },
    { additionalProperties: false },
  );
  let executed = "";
  const multiply: RuntimeTool<typeof parameters> = {
    name: "multiply",
    label: "Multiply",
    description: "Multiply two integers.",
    risk: "read",
    parameters,
    execute: async ({ a, b }) => {
      executed = `${a}×${b}`;
      return { content: String(a * b), details: { a, b } };
    },
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-responses-model",
    protocol: "responses",
    reasoning: true,
    supportsImages: false,
    fetch: fetchMock,
  });
  await runtime.createSession({
    id: "openai-compatible-responses-tool-loop",
    systemPrompt: "Use the multiply tool.",
    tools: [multiply],
    thinkingLevel: "medium",
  });

  const result = await runtime.send(
    "openai-compatible-responses-tool-loop",
    "Calculate 7 times 8.",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "结果是 56。");
  assert.equal(executed, "7×8");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.store, false);
  assert.deepEqual(requests[0]?.reasoning, { effort: "medium" });
  assert.deepEqual(
    (requests[1]?.input as { type?: string; call_id?: string }[]).slice(-2),
    [
      {
        type: "function_call",
        id: "fc_fixture_multiply",
        call_id: "call_fixture_multiply",
        name: "multiply",
        arguments: '{"a":7,"b":8}',
      },
      {
        type: "function_call_output",
        call_id: "call_fixture_multiply",
        output: "56",
      },
    ],
  );
});

function twoToolCallResponse() {
  return sseResponse([
    chunk(1, {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call-first",
          type: "function",
          function: {
            name: "record_value",
            arguments: '{"value":"first"}',
          },
        },
        {
          index: 1,
          id: "call-second",
          type: "function",
          function: {
            name: "record_value",
            arguments: '{"value":"second"}',
          },
        },
      ],
    }),
    chunk(1, {}, "tool_calls"),
  ]);
}

const valueParameters = Type.Object(
  { value: Type.String() },
  { additionalProperties: false },
);

test("the app adapter keeps same-turn tool calls sequential by default", async () => {
  const responses = [
    twoToolCallResponse(),
    sseResponse([
      chunk(2, { role: "assistant", content: "sequential complete" }),
      chunk(2, {}, "stop"),
    ]),
  ];
  const executionOrder: string[] = [];
  let activeExecutions = 0;
  let peakExecutions = 0;
  const recordTool: RuntimeTool<typeof valueParameters> = {
    name: "record_value",
    label: "Record value",
    description: "Record a fixture value.",
    risk: "read",
    parameters: valueParameters,
    execute: async ({ value }) => {
      activeExecutions += 1;
      peakExecutions = Math.max(peakExecutions, activeExecutions);
      executionOrder.push(`start:${value}`);
      await Promise.resolve();
      executionOrder.push(`end:${value}`);
      activeExecutions -= 1;
      return { content: `recorded ${value}`, details: { value } };
    },
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: async () => {
      const response = responses.shift();
      assert.ok(response, "unexpected extra provider request");
      return response;
    },
  });
  await runtime.createSession({
    id: "openai-compatible-sequential-tools",
    systemPrompt: "Use both fixture tools.",
    tools: [recordTool],
  });

  const result = await runtime.send(
    "openai-compatible-sequential-tools",
    "Record both values",
  );

  assert.equal(result.status, "completed");
  assert.equal(peakExecutions, 1);
  assert.deepEqual(executionOrder, [
    "start:first",
    "end:first",
    "start:second",
    "end:second",
  ]);
  assert.deepEqual(
    result.toolExecutions.map((execution) => execution.toolCallId),
    ["call-first", "call-second"],
  );
});

test(
  "Pi Core runs a same-turn tool batch concurrently only when every tool opts in",
  { timeout: 2_000 },
  async () => {
    const responses = [
      twoToolCallResponse(),
      sseResponse([
        chunk(2, { role: "assistant", content: "parallel complete" }),
        chunk(2, {}, "stop"),
      ]),
    ];
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let startedExecutions = 0;
    let activeExecutions = 0;
    let peakExecutions = 0;
    const recordTool: RuntimeTool<typeof valueParameters> = {
      name: "record_value",
      label: "Record value",
      description: "Record a fixture value.",
      risk: "read",
      parameters: valueParameters,
      executionMode: "parallel",
      execute: async ({ value }) => {
        startedExecutions += 1;
        activeExecutions += 1;
        peakExecutions = Math.max(peakExecutions, activeExecutions);
        if (startedExecutions === 2) releaseBatch();
        await batchGate;
        activeExecutions -= 1;
        return { content: `recorded ${value}`, details: { value } };
      },
    };
    const runtime = createOpenAICompatiblePiRuntime({
      baseUrl: "https://fixture.invalid/v1",
      apiKey: "fixture-key",
      modelId: "fixture-model",
      supportsImages: false,
      fetch: async () => {
        const response = responses.shift();
        assert.ok(response, "unexpected extra provider request");
        return response;
      },
    });
    await runtime.createSession({
      id: "openai-compatible-parallel-tools",
      systemPrompt: "Use both fixture tools.",
      tools: [recordTool],
    });

    const result = await runtime.send(
      "openai-compatible-parallel-tools",
      "Record both values",
    );

    assert.equal(result.status, "completed");
    assert.equal(peakExecutions, 2);
    assert.deepEqual(
      result.toolExecutions.map((execution) => execution.toolCallId),
      ["call-first", "call-second"],
    );
  },
);

const strictTargetParameters = Type.Object(
  { target: Type.Literal("docs/plan.txt") },
  { additionalProperties: false },
);

for (const scenario of [
  {
    name: "malformed JSON",
    argumentsText: "{ definitely-not-json",
  },
  {
    name: "schema mismatch",
    argumentsText: '{"target":"docs/other.txt"}',
  },
  {
    name: "additional property",
    argumentsText: '{"target":"docs/plan.txt","unexpected":true}',
  },
] as const) {
  test(`Pi Core rejects ${scenario.name} tool arguments before app execution`, async () => {
    const requests: Record<string, unknown>[] = [];
    const responses = [
      sseResponse([
        chunk(1, {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call-invalid-${scenario.name.replaceAll(" ", "-")}`,
              type: "function",
              function: {
                name: "inspect_strict_target",
                arguments: scenario.argumentsText,
              },
            },
          ],
        }),
        chunk(1, {}, "tool_calls"),
      ]),
      sseResponse([
        chunk(2, { role: "assistant", content: "invalid call handled" }),
        chunk(2, {}, "stop"),
      ]),
    ];
    let appExecutionCount = 0;
    const inspectTool: RuntimeTool<typeof strictTargetParameters> = {
      name: "inspect_strict_target",
      label: "Inspect strict target",
      description: "Inspect only the fixture target.",
      risk: "read",
      parameters: strictTargetParameters,
      execute: async ({ target }) => {
        appExecutionCount += 1;
        return { content: `inspected ${target}`, details: { target } };
      },
    };
    const runtime = createOpenAICompatiblePiRuntime({
      baseUrl: "https://fixture.invalid/v1",
      apiKey: "fixture-key",
      modelId: "fixture-model",
      supportsImages: false,
      fetch: async (_input, init) => {
        const body = init?.body;
        if (typeof body !== "string") {
          throw new Error("fixture expected a JSON request body");
        }
        requests.push(JSON.parse(body));
        const response = responses.shift();
        assert.ok(response, "unexpected extra provider request");
        return response;
      },
    });
    const sessionId = `openai-compatible-invalid-${scenario.name.replaceAll(" ", "-")}`;
    await runtime.createSession({
      id: sessionId,
      systemPrompt: "Inspect a strict target.",
      tools: [inspectTool],
    });

    const result = await runtime.send(sessionId, "Inspect the strict target");

    assert.equal(result.status, "completed");
    assert.equal(appExecutionCount, 0);
    assert.equal(result.toolExecutions.length, 1);
    assert.equal(result.toolExecutions[0]?.isError, true);
    assert.match(
      JSON.stringify(result.toolExecutions[0]?.result),
      /Validation failed for tool/,
    );
    assert.match(
      JSON.stringify(requests[1]?.messages),
      /Validation failed for tool/,
    );
  });
}

for (const failure of [
  { status: 401, marker: "fixture unauthorized", expectedFetches: 1 },
  { status: 429, marker: "fixture rate limited", expectedFetches: 3 },
  { status: 503, marker: "fixture unavailable", expectedFetches: 3 },
] as const) {
  test(`Pi AI maps an HTTP ${failure.status} provider response to a failed run`, async () => {
    let fetchCount = 0;
    const runtime = createOpenAICompatiblePiRuntime({
      baseUrl: "https://fixture.invalid/v1",
      apiKey: "fixture-key",
      modelId: "fixture-model",
      supportsImages: false,
      assistantMaxRetries: 0,
      fetch: async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: failure.marker,
              type: "fixture_error",
              code: "fixture_code",
            },
          }),
          {
            status: failure.status,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          },
        );
      },
    });
    const sessionId = `openai-compatible-http-${failure.status}`;
    await runtime.createSession({
      id: sessionId,
      systemPrompt: "Return text.",
      tools: [],
    });

    const result = await runtime.send(sessionId, "Trigger provider failure");

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", new RegExp(String(failure.status)));
    assert.match(result.error ?? "", new RegExp(failure.marker));
    assert.equal(
      fetchCount,
      failure.expectedFetches,
      failure.status === 401
        ? "authentication failures must fail immediately"
        : "transient pre-stream failures use the bounded upstream retry policy",
    );
  });
}

test("a transient pre-stream provider failure recovers through upstream retry", async () => {
  let fetchCount = 0;
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: "fixture temporarily down" } }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          },
        );
      }
      return sseResponse([
        chunk(1, { role: "assistant", content: "recovered upstream" }),
        chunk(1, {}, "stop"),
      ]);
    },
  });
  await runtime.createSession({
    id: "openai-compatible-provider-retry",
    systemPrompt: "Return text.",
    tools: [],
  });

  const result = await runtime.send(
    "openai-compatible-provider-retry",
    "Recover once",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "recovered upstream");
  assert.equal(fetchCount, 2);
});

test("an OpenAI-compatible HTTP context overflow uses upstream compaction and replays once", async () => {
  const requests: Record<string, unknown>[] = [];
  let overflowReturned = false;
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    const requestBody = init?.body;
    assert.equal(typeof requestBody, "string");
    if (typeof requestBody !== "string") {
      throw new Error("Expected an OpenAI-compatible JSON request body.");
    }
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    requests.push(body);
    const transcript = JSON.stringify(body.messages ?? []);

    if (transcript.includes("context summarization assistant")) {
      return sseResponse([
        chunk(2, {
          role: "assistant",
          content: "OPENAI-COMPATIBLE-CONTEXT-SUMMARY",
        }),
        chunk(2, {}, "stop"),
      ]);
    }
    if (transcript.includes("continue after context recovery")) {
      return sseResponse([
        chunk(4, { role: "assistant", content: "continued answer" }),
        chunk(4, {}, "stop"),
      ]);
    }
    if (!overflowReturned) {
      overflowReturned = true;
      return new Response(
        JSON.stringify({
          error: {
            message:
              "maximum context length exceeded: too many tokens in the request",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return sseResponse([
      chunk(3, { role: "assistant", content: "recovered answer" }),
      chunk(3, {}, "stop"),
    ]);
  };
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    providerMaxRetries: 0,
    assistantMaxRetries: 0,
    fetch: fetchMock,
  });
  const sessionId = "openai-compatible-context-overflow";
  await runtime.createSession({
    id: sessionId,
    systemPrompt: "Recover context with the upstream implementation.",
    tools: [],
    initialMessages: [
      {
        role: "user",
        content: `old context ${"x".repeat(120_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `old answer ${"y".repeat(120_000)}`,
        timestamp: 2,
      },
    ],
  });
  const maintenance: string[] = [];
  runtime.subscribe(sessionId, (event) => {
    if (event.type === "context_maintenance") {
      maintenance.push(`${event.operation}:${event.phase}`);
    }
  });

  const recovered = await runtime.send(sessionId, "recover this prompt");
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.text, "recovered answer");
  assert.deepEqual(maintenance, [
    "overflow_recovery:started",
    "overflow_recovery:completed",
  ]);
  assert.equal(
    requests.filter((body) =>
      JSON.stringify(body.messages ?? []).includes("recover this prompt"),
    ).length,
    2,
    "the failed request and one recovered replay contain the current prompt",
  );
  assert.ok(
    requests.some((body) =>
      JSON.stringify(body.messages ?? []).includes(
        "OPENAI-COMPATIBLE-CONTEXT-SUMMARY",
      ),
    ),
    "the recovered replay receives the upstream compaction summary",
  );

  const continued = await runtime.send(
    sessionId,
    "continue after context recovery",
  );
  assert.equal(continued.status, "completed");
  assert.equal(continued.text, "continued answer");
});

test("Pi AI preserves partial text and fails when the SSE transport is interrupted", async () => {
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: async () =>
      interruptedSseResponse(
        chunk(1, { role: "assistant", content: "partial text" }),
      ),
  });
  await runtime.createSession({
    id: "openai-compatible-interrupted-stream",
    systemPrompt: "Return text.",
    tools: [],
  });

  const result = await runtime.send(
    "openai-compatible-interrupted-stream",
    "Interrupt the stream",
  );

  assert.equal(result.status, "failed");
  assert.equal(result.text, "partial text");
  assert.match(result.error ?? "", /fixture transport interrupted/);
});

test("Pi AI fails a cleanly ended SSE stream that has no finish_reason", async () => {
  const runtime = createOpenAICompatiblePiRuntime({
    baseUrl: "https://fixture.invalid/v1",
    apiKey: "fixture-key",
    modelId: "fixture-model",
    supportsImages: false,
    fetch: async () =>
      sseResponse([chunk(1, { role: "assistant", content: "unfinished" })]),
  });
  await runtime.createSession({
    id: "openai-compatible-missing-finish-reason",
    systemPrompt: "Return text.",
    tools: [],
  });

  const result = await runtime.send(
    "openai-compatible-missing-finish-reason",
    "End without a finish reason",
  );

  assert.equal(result.status, "failed");
  assert.equal(result.text, "unfinished");
  assert.match(result.error ?? "", /Stream ended without finish_reason/);
});

test(
  "the runtime AbortSignal cancels an in-flight OpenAI-compatible request",
  { timeout: 2_000 },
  async () => {
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    const runtime = createOpenAICompatiblePiRuntime({
      baseUrl: "https://fixture.invalid/v1",
      apiKey: "fixture-key",
      modelId: "fixture-model",
      supportsImages: false,
      fetch: async (_input, init) => {
        providerSignal = init?.signal ?? undefined;
        assert.ok(providerSignal, "provider fetch receives the Harness signal");
        markRequestStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const rejectAbort = () =>
            reject(new DOMException("fixture request aborted", "AbortError"));
          if (providerSignal?.aborted) {
            rejectAbort();
            return;
          }
          providerSignal?.addEventListener("abort", rejectAbort, {
            once: true,
          });
        });
      },
    });
    await runtime.createSession({
      id: "openai-compatible-abort",
      systemPrompt: "Return text.",
      tools: [],
    });
    const controller = new AbortController();

    const pendingResult = runtime.send(
      "openai-compatible-abort",
      "Wait for cancellation",
      { signal: controller.signal },
    );
    await requestStarted;
    controller.abort();
    const result = await pendingResult;

    assert.equal(providerSignal?.aborted, true);
    assert.equal(result.status, "cancelled");
  },
);
