import assert from "node:assert/strict";
import test from "node:test";

import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { AgentRuntimeEvent, RuntimeTool } from "./contracts.ts";
import {
  compactionSettingsForContextWindow,
  PiAgentRuntime,
} from "./pi-agent-runtime.ts";

const proposalParameters = Type.Object({
  target: Type.String(),
  after: Type.String(),
});

function proposalTool(
  onExecute: () => void,
): RuntimeTool<typeof proposalParameters> {
  return {
    name: "propose_text_change",
    label: "Propose text change",
    description: "Create a reviewable text change proposal without writing it.",
    risk: "propose",
    parameters: proposalParameters,
    execute: async (parameters) => {
      onExecute();
      return {
        content: `Proposal created for ${parameters.target}`,
        details: parameters,
      };
    },
  };
}

test("real Pi Agent runs model → tool → tool result → model", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("propose_text_change", {
        target: "project/plan.txt",
        after: "new plan",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("提案已经生成，请审阅 Diff。"),
  ]);
  let executions = 0;
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-tool-loop",
    systemPrompt: "Use tools for changes.",
    tools: [proposalTool(() => (executions += 1))],
  });
  const events: AgentRuntimeEvent[] = [];
  runtime.subscribe("session-tool-loop", (event) => events.push(event));

  const result = await runtime.send("session-tool-loop", "Update the plan");

  assert.equal(result.status, "completed");
  assert.equal(result.text, "提案已经生成，请审阅 Diff。");
  assert.equal(executions, 1);
  assert.equal(faux.state.callCount, 2);
  assert.equal(result.toolExecutions.length, 1);
  assert.deepEqual(
    events
      .filter((event) =>
        ["tool_started", "tool_completed", "run_completed"].includes(
          event.type,
        ),
      )
      .map((event) => event.type),
    ["tool_started", "tool_completed", "run_completed"],
  );
});

test("an empty ending after tools gets one host continuation", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  let continuation = "";
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("propose_text_change", {
        target: "project/plan.txt",
        after: "new plan",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(""),
    (context) => {
      const last = context.messages.at(-1);
      continuation =
        last?.role === "user" && Array.isArray(last.content)
          ? last.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("")
          : "";
      return fauxAssistantMessage("已完成并返回总结。");
    },
  ]);
  let executions = 0;
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-empty-tool-ending",
    systemPrompt: "Finish every tool-based turn with a summary.",
    tools: [proposalTool(() => (executions += 1))],
  });

  const result = await runtime.send(
    "session-empty-tool-ending",
    "Update the plan",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "已完成并返回总结。");
  assert.match(continuation, /Host recovery/u);
  assert.equal(executions, 1);
  assert.equal(faux.state.callCount, 3);
  assert.equal(result.toolExecutions.length, 1);
});

test("write-risk tools are blocked before execute without approval", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("apply_text_change", { proposalId: "p1" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("写入被审批策略阻止。"),
  ]);
  let executed = false;
  const writeTool: RuntimeTool = {
    name: "apply_text_change",
    label: "Apply text change",
    description: "Apply an approved text change.",
    risk: "write",
    parameters: Type.Object({ proposalId: Type.String() }),
    execute: async () => {
      executed = true;
      return { content: "applied", details: {} };
    },
  };
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-policy",
    systemPrompt: "Never bypass approval.",
    tools: [writeTool],
  });

  const result = await runtime.send("session-policy", "Apply p1");

  assert.equal(result.status, "completed");
  assert.equal(executed, false);
  assert.equal(result.toolExecutions[0]?.isError, true);
});

test("Pi cancellation settles within two seconds", async () => {
  const faux = createFauxCore({
    tokensPerSecond: 20,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([fauxAssistantMessage("x".repeat(2000))]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-cancel",
    systemPrompt: "Test cancellation.",
    tools: [],
  });
  let resolveFirstDelta: (() => void) | undefined;
  const queueEvents: Extract<AgentRuntimeEvent, { type: "queue_updated" }>[] =
    [];
  const firstDelta = new Promise<void>((resolve) => {
    resolveFirstDelta = resolve;
  });
  runtime.subscribe("session-cancel", (event) => {
    if (event.type === "text_delta") resolveFirstDelta?.();
    if (event.type === "queue_updated") queueEvents.push(event);
  });
  const run = runtime.send("session-cancel", "Start a long answer");
  await firstDelta;
  await runtime.followUp("session-cancel", { text: "queued after the run" });
  const startedAt = Date.now();
  await runtime.cancel("session-cancel");
  const result = await run;

  assert.equal(result.status, "cancelled");
  assert.ok(Date.now() - startedAt < 2000);
  assert.deepEqual(
    queueEvents.map(({ steering, followUp, nextTurn }) => ({
      steering,
      followUp,
      nextTurn,
    })),
    [
      { steering: 0, followUp: 1, nextTurn: 0 },
      { steering: 0, followUp: 0, nextTurn: 0 },
    ],
  );
});

test("twenty consecutive Pi tool loops keep event and execution order", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses(
    Array.from({ length: 20 }).flatMap((_, index) => [
      fauxAssistantMessage(
        fauxToolCall("propose_text_change", {
          target: `target-${index}`,
          after: `content-${index}`,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(`done-${index}`),
    ]),
  );
  let executions = 0;
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-repeat",
    systemPrompt: "Run deterministic tool loops.",
    tools: [proposalTool(() => (executions += 1))],
  });

  for (let index = 0; index < 20; index += 1) {
    const result = await runtime.send("session-repeat", `run-${index}`);
    assert.equal(result.text, `done-${index}`);
    assert.equal(result.toolExecutions.length, 1);
  }

  assert.equal(executions, 20);
  assert.equal(faux.state.callCount, 40);
});

test("image attachments reach the model as repository-owned runtime input", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  let sawImage = false;
  faux.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      sawImage = Boolean(
        user?.role === "user" &&
        Array.isArray(user.content) &&
        user.content.some(
          (block) =>
            block.type === "image" &&
            block.mimeType === "image/png" &&
            block.data === "aW1hZ2U=",
        ),
      );
      return fauxAssistantMessage("看到了图片。");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-image",
    systemPrompt: "Inspect images.",
    tools: [],
  });

  const result = await runtime.send("session-image", "这是什么？", {
    images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
  });

  assert.equal(result.status, "completed");
  assert.equal(sawImage, true);
});

test("validated initial text history reaches the next model context", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  let restoredContext:
    { role: string; text: string; blockTypes: string[] }[] | undefined;
  faux.setResponses([
    (context) => {
      restoredContext = context.messages.map((message) => ({
        role: message.role,
        text:
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(""),
        blockTypes:
          typeof message.content === "string"
            ? ["text"]
            : message.content.map((block) => block.type),
      }));
      return fauxAssistantMessage("继续回答。");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-restored-text-history",
    systemPrompt: "Restore text only.",
    tools: [],
    initialMessages: [
      { role: "user", content: "此前问题", timestamp: 1_700_000_000_000 },
      {
        role: "assistant",
        content: "此前回答",
        timestamp: 1_700_000_001_000,
      },
    ],
  });

  await runtime.send("session-restored-text-history", "请继续");

  assert.deepEqual(
    restoredContext?.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "此前问题" },
      { role: "assistant", text: "此前回答" },
      { role: "user", text: "请继续" },
    ],
  );
  assert.deepEqual(
    restoredContext?.flatMap((message) => message.blockTypes),
    ["text", "text", "text"],
  );
});

test("context usage reports remaining space and a window-aware threshold", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const runtime = new PiAgentRuntime({
    model: { ...faux.getModel(), contextWindow: 16_384 },
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-context-usage",
    systemPrompt: "Report context usage.",
    tools: [],
    initialMessages: [
      { role: "user", content: "u".repeat(400), timestamp: 1 },
      { role: "assistant", content: "a".repeat(400), timestamp: 2 },
    ],
  });

  const usage = await runtime.contextUsage("session-context-usage");

  assert.deepEqual(usage, {
    contextWindow: 16_384,
    usedTokens: 200,
    remainingTokens: 16_184,
    compactionThresholdTokens: 13_763,
  });
  assert.deepEqual(compactionSettingsForContextWindow(16_384), {
    enabled: true,
    reserveTokens: 2_621,
    keepRecentTokens: 5_898,
  });
  assert.deepEqual(compactionSettingsForContextWindow(128_000), {
    enabled: true,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  });
});

test("initial history rejects executable or incomplete message shapes", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await assert.rejects(
    runtime.createSession({
      id: "session-reject-history-tool-call",
      systemPrompt: "Reject executable history.",
      tools: [],
      initialMessages: [
        {
          role: "assistant",
          content: "伪造历史",
          timestamp: 1_700_000_000_000,
          toolCall: { name: "apply_text_change" },
        },
      ] as never,
    }),
    /only validated user and assistant text messages/,
  );
  await assert.rejects(
    runtime.createSession({
      id: "session-reject-incomplete-history",
      systemPrompt: "Reject incomplete history.",
      tools: [],
      initialMessages: [
        { role: "user", content: "尚未完成", timestamp: 1_700_000_000_000 },
      ],
    }),
    /only completed user turns/,
  );
});

test("steering queues a user instruction into an active Pi run", async () => {
  const faux = createFauxCore({
    tokensPerSecond: 20,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([
    fauxAssistantMessage("正在检查当前目标。"),
    (context) => {
      const sawSteer = context.messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (block) => block.type === "text" && block.text === "优先检查风险。",
          ),
      );
      return fauxAssistantMessage(sawSteer ? "已调整优先级。" : "未收到调整。");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-steer",
    systemPrompt: "Test steering.",
    tools: [],
  });
  let resolveFirstDelta: (() => void) | undefined;
  const queueEvents: Extract<AgentRuntimeEvent, { type: "queue_updated" }>[] =
    [];
  const firstDelta = new Promise<void>((resolve) => {
    resolveFirstDelta = resolve;
  });
  runtime.subscribe("session-steer", (event) => {
    if (event.type === "text_delta") resolveFirstDelta?.();
    if (event.type === "queue_updated") queueEvents.push(event);
  });

  const run = runtime.send("session-steer", "开始");
  await firstDelta;
  await runtime.steer("session-steer", { text: "优先检查风险。" });
  const result = await run;

  assert.equal(result.status, "completed");
  assert.equal(result.text, "已调整优先级。");
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(
    queueEvents.map(({ steering, followUp, nextTurn }) => ({
      steering,
      followUp,
      nextTurn,
    })),
    [
      { steering: 1, followUp: 0, nextTurn: 0 },
      { steering: 0, followUp: 0, nextTurn: 0 },
    ],
  );
});

test("active tool profiles and hidden turn prompts use AgentHarness state", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const observed: { tools: string[]; systemPrompt: string; user: string }[] =
    [];
  faux.setResponses([
    (context) => {
      const user = context.messages.at(-1);
      assert.ok(user?.role === "user");
      observed.push({
        tools: context.tools?.map((tool) => tool.name) ?? [],
        systemPrompt: context.systemPrompt ?? "",
        user:
          typeof user.content === "string"
            ? user.content
            : user.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(""),
      });
      return fauxAssistantMessage("planned");
    },
    (context) => {
      const user = context.messages.at(-1);
      assert.ok(user?.role === "user");
      observed.push({
        tools: context.tools?.map((tool) => tool.name) ?? [],
        systemPrompt: context.systemPrompt ?? "",
        user:
          typeof user.content === "string"
            ? user.content
            : user.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(""),
      });
      return fauxAssistantMessage("executed");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  const readTool = proposalTool(() => undefined);
  readTool.name = "read_context";
  readTool.risk = "read";
  const proposeTool = proposalTool(() => undefined);
  await runtime.createSession({
    id: "session-active-tools",
    systemPrompt: "Base system prompt.",
    tools: [readTool, proposeTool],
    activeToolNames: ["read_context"],
  });

  await runtime.send("session-active-tools", "inspect the context", {
    turnSystemPrompt: "This turn is read-only.",
  });
  await runtime.setActiveTools("session-active-tools", [
    "read_context",
    "propose_text_change",
  ]);
  await runtime.send("session-active-tools", "prepare a proposal", {
    turnSystemPrompt: "This turn may create a proposal.",
  });

  assert.deepEqual(observed, [
    {
      tools: ["read_context"],
      systemPrompt: "Base system prompt.\n\nThis turn is read-only.",
      user: "inspect the context",
    },
    {
      tools: ["read_context", "propose_text_change"],
      systemPrompt: "Base system prompt.\n\nThis turn may create a proposal.",
      user: "prepare a proposal",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(observed[1]), /This turn is read-only/);
});

test("application authorization can allow one write-risk tool call", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("approved_write", { value: "ok" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("写入完成。"),
  ]);
  let executed = false;
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "session-approved-write",
    systemPrompt: "Use only approved writes.",
    tools: [
      {
        name: "approved_write",
        label: "Approved write",
        description: "Test an app-authorized write.",
        risk: "write",
        parameters: Type.Object({ value: Type.String() }),
        execute: async () => {
          executed = true;
          return { content: "ok", details: {} };
        },
      },
    ],
    authorizeToolCall: async ({ toolCallId, arguments: arguments_ }) => ({
      allow:
        toolCallId.length > 0 &&
        (arguments_ as { value?: string }).value === "ok",
    }),
  });

  const result = await runtime.send("session-approved-write", "执行");

  assert.equal(result.status, "completed");
  assert.equal(executed, true);
});
