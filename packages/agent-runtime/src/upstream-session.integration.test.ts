import assert from "node:assert/strict";
import test from "node:test";

import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type {
  AgentRuntimeEvent,
  RuntimeSessionPersistencePort,
  RuntimeTool,
} from "./contracts.ts";
import { PiAgentRuntime } from "./pi-agent-runtime.ts";
import { PersistedPiSessionStorage } from "./session-persistence.ts";

class MemorySessionPersistence implements RuntimeSessionPersistencePort {
  readonly values = new Map<string, string>();
  saves = 0;

  async load(sessionId: string) {
    return this.values.get(sessionId);
  }

  async save(sessionId: string, value: string) {
    this.saves += 1;
    this.values.set(sessionId, value);
  }

  async delete(sessionId: string) {
    this.values.delete(sessionId);
  }
}

function textTool(name: string): RuntimeTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    risk: "read",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => ({ content: name, details: {} }),
  };
}

function messageText(context: Context) {
  return JSON.stringify(context.messages);
}

test("upstream Session tree preserves history while tools and thinking change", async () => {
  const persistence = new MemorySessionPersistence();
  const firstFaux = createFauxCore({
    tokensPerSecond: 0,
    models: [{ id: "reasoning-fixture", reasoning: true }],
  });
  firstFaux.setResponses([
    (_context, options) => {
      assert.equal(
        (options as { reasoning?: unknown } | undefined)?.reasoning,
        "low",
      );
      return fauxAssistantMessage("first persisted answer");
    },
    (context, options) => {
      assert.match(messageText(context), /first persisted user/u);
      assert.match(messageText(context), /first persisted answer/u);
      assert.equal(
        (options as { reasoning?: unknown } | undefined)?.reasoning,
        "high",
      );
      return fauxAssistantMessage("continued after thinking switch");
    },
  ]);
  const first = new PiAgentRuntime({
    model: firstFaux.getModel(),
    streamFn: firstFaux.streamSimple,
    sessionPersistence: persistence,
  });
  const tools = [textTool("alpha"), textTool("beta")];
  const firstSession = await first.createSession({
    id: "persisted-session",
    systemPrompt: "Persistence test.",
    tools,
    baseActiveToolNames: ["alpha"],
    restorableActiveToolNames: ["alpha", "beta"],
    thinkingLevel: "low",
  });
  assert.deepEqual(firstSession.activeToolNames, ["alpha"]);
  const initial = await first.send("persisted-session", "first persisted user");
  assert.equal(initial.text, "first persisted answer");
  await first.setActiveTools("persisted-session", ["beta"]);
  await first.setThinkingLevel("persisted-session", "high");
  const switched = await first.send(
    "persisted-session",
    "continue after thinking switch",
  );
  assert.equal(switched.text, "continued after thinking switch");
  await first.destroySession("persisted-session");

  const encoded = persistence.values.get("persisted-session");
  assert.ok(encoded);
  const parsed = JSON.parse(encoded) as {
    version: number;
    entries: { type: string }[];
  };
  assert.equal(parsed.version, 1);
  assert.ok(parsed.entries.some((entry) => entry.type === "message"));
  assert.ok(
    parsed.entries.some((entry) => entry.type === "active_tools_change"),
  );
  assert.ok(
    parsed.entries.some((entry) => entry.type === "thinking_level_change"),
  );

  const secondFaux = createFauxCore({
    tokensPerSecond: 0,
    models: [{ id: "reasoning-fixture", reasoning: true }],
  });
  secondFaux.setResponses([
    (context, options) => {
      assert.match(messageText(context), /first persisted user/u);
      assert.match(messageText(context), /first persisted answer/u);
      assert.match(messageText(context), /continue after thinking switch/u);
      assert.match(messageText(context), /continued after thinking switch/u);
      assert.deepEqual(
        context.tools?.map((tool) => tool.name),
        ["alpha", "beta"],
      );
      assert.equal(
        (options as { reasoning?: unknown } | undefined)?.reasoning,
        "high",
      );
      return fauxAssistantMessage("continued after restart");
    },
  ]);
  const second = new PiAgentRuntime({
    model: secondFaux.getModel(),
    streamFn: secondFaux.streamSimple,
    sessionPersistence: persistence,
  });
  const restoredSession = await second.createSession({
    id: "persisted-session",
    systemPrompt: "Persistence test.",
    tools,
    baseActiveToolNames: ["alpha"],
    restorableActiveToolNames: ["alpha", "beta"],
    initialMessages: [
      {
        role: "user",
        content: "must be ignored because a persisted tree exists",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: "must also be ignored",
        timestamp: 2,
      },
    ],
  });
  assert.deepEqual(restoredSession.activeToolNames, ["alpha", "beta"]);
  const continued = await second.send(
    "persisted-session",
    "second persisted user",
  );
  assert.equal(continued.text, "continued after restart");
  assert.doesNotMatch(encoded, /must be ignored/u);
  await second.destroySession("persisted-session");

  const filteredFaux = createFauxCore({ tokensPerSecond: 0 });
  filteredFaux.setResponses([
    (context) => {
      assert.deepEqual(
        context.tools?.map((tool) => tool.name),
        ["alpha"],
      );
      return fauxAssistantMessage("filtered after policy change");
    },
  ]);
  const filtered = new PiAgentRuntime({
    model: filteredFaux.getModel(),
    streamFn: filteredFaux.streamSimple,
    sessionPersistence: persistence,
  });
  const filteredSession = await filtered.createSession({
    id: "persisted-session",
    systemPrompt: "Persistence test.",
    tools,
    baseActiveToolNames: ["alpha"],
    restorableActiveToolNames: ["alpha"],
  });
  assert.deepEqual(filteredSession.activeToolNames, ["alpha"]);
  const filteredResult = await filtered.send(
    "persisted-session",
    "continue after the host policy changed",
  );
  assert.equal(filteredResult.text, "filtered after policy change");

  await filtered.deleteSession("persisted-session");
  assert.equal(persistence.values.has("persisted-session"), false);
});

test("upstream Skill and prompt-template invocation are delegated unchanged", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /<skill name=\\"audit\\"/u);
      assert.match(transcript, /AUDIT-INSTRUCTIONS/u);
      assert.match(transcript, /focus on rollback/u);
      return fauxAssistantMessage("skill invocation complete");
    },
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /Release ios with ios strict review/u);
      return fauxAssistantMessage("template invocation complete");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "resources-session",
    systemPrompt: "Resource invocation test.",
    tools: [],
    resources: {
      skills: [
        {
          name: "audit",
          description: "Audit a release.",
          content: "AUDIT-INSTRUCTIONS",
          filePath: "/virtual/audit/SKILL.md",
        },
      ],
      promptTemplates: [
        {
          name: "release",
          description: "Prepare a release.",
          content: "Release $1 with $ARGUMENTS",
        },
      ],
    },
  });

  const skill = await runtime.invokeSkill!(
    "resources-session",
    "audit",
    "focus on rollback",
  );
  assert.equal(skill.text, "skill invocation complete");
  const template = await runtime.invokePromptTemplate!(
    "resources-session",
    "release",
    ["ios", "strict", "review"],
  );
  assert.equal(template.text, "template invocation complete");
  const missing = await runtime.invokeSkill!("resources-session", "missing");
  assert.equal(missing.status, "failed");
  assert.match(missing.error ?? "", /Unknown skill/u);
  await runtime.destroySession("resources-session");
});

test("upstream next-turn queue is preserved and reported without adapter semantics", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      const transcript = messageText(context);
      assert.ok(
        transcript.indexOf("queued before the turn") <
          transcript.indexOf("current visible prompt"),
      );
      return fauxAssistantMessage("next-turn queue complete");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "next-turn-session",
    systemPrompt: "Next-turn queue test.",
    tools: [],
  });
  const counts: number[] = [];
  runtime.subscribe("next-turn-session", (event) => {
    if (event.type === "queue_updated") counts.push(event.nextTurn);
  });

  await runtime.nextTurn!("next-turn-session", {
    text: "queued before the turn",
  });
  const result = await runtime.send(
    "next-turn-session",
    "current visible prompt",
  );

  assert.equal(result.text, "next-turn queue complete");
  assert.deepEqual(counts, [1, 0]);
  await runtime.destroySession("next-turn-session");
});

test("upstream tree navigation creates a durable alternate conversation branch", async () => {
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("first branch answer"),
    fauxAssistantMessage("discarded branch answer"),
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /first branch question/u);
      assert.match(transcript, /first branch answer/u);
      assert.match(transcript, /replacement branch question/u);
      assert.doesNotMatch(transcript, /discarded branch question/u);
      assert.doesNotMatch(transcript, /discarded branch answer/u);
      return fauxAssistantMessage("replacement branch answer");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "tree-session",
    systemPrompt: "Tree navigation test.",
    tools: [],
  });
  await runtime.send("tree-session", "first branch question");
  await runtime.send("tree-session", "discarded branch question");

  const beforeNavigation = JSON.parse(
    persistence.values.get("tree-session") ?? "{}",
  ) as {
    entries?: {
      id: string;
      type: string;
      message?: { role?: string; content?: { type?: string; text?: string }[] };
    }[];
  };
  const firstAnswerEntry = beforeNavigation.entries?.find(
    (entry) =>
      entry.type === "message" &&
      entry.message?.role === "assistant" &&
      entry.message.content?.some(
        (block) =>
          block.type === "text" && block.text === "first branch answer",
      ),
  );
  assert.ok(firstAnswerEntry);

  const navigation = (await runtime.navigateTree!(
    "tree-session",
    firstAnswerEntry.id,
  )) as { cancelled: boolean };
  assert.equal(navigation.cancelled, false);
  const replacement = await runtime.send(
    "tree-session",
    "replacement branch question",
  );
  assert.equal(replacement.text, "replacement branch answer");

  const afterNavigation = JSON.parse(
    persistence.values.get("tree-session") ?? "{}",
  ) as { entries?: { type: string }[] };
  assert.ok(afterNavigation.entries?.some((entry) => entry.type === "leaf"));
  await runtime.destroySession("tree-session");
});

test("upstream compaction is stored in the full encrypted Session tree", async () => {
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("recent answer"),
    fauxAssistantMessage("COMPACTED-UPSTREAM-SUMMARY"),
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "compaction-session",
    systemPrompt: "Compaction persistence test.",
    tools: [],
    initialMessages: [
      {
        role: "user",
        content: `old user turn ${"x".repeat(100_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `old assistant turn ${"y".repeat(100_000)}`,
        timestamp: 2,
      },
    ],
  });
  await runtime.send("compaction-session", "recent question");
  const compaction = (await runtime.compact!(
    "compaction-session",
    "Preserve the regression marker.",
  )) as { summary: string; tokensBefore: number };

  assert.match(compaction.summary, /COMPACTED-UPSTREAM-SUMMARY/u);
  assert.ok(compaction.tokensBefore > 20_000);
  const encoded = persistence.values.get("compaction-session");
  assert.ok(encoded);
  const parsed = JSON.parse(encoded) as { entries: { type: string }[] };
  assert.ok(parsed.entries.some((entry) => entry.type === "compaction"));
  await runtime.destroySession("compaction-session");

  const restoredFaux = createFauxCore({ tokensPerSecond: 0 });
  restoredFaux.setResponses([
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /COMPACTED-UPSTREAM-SUMMARY/u);
      assert.match(transcript, /recent answer/u);
      return fauxAssistantMessage("continued after compaction");
    },
  ]);
  const restored = new PiAgentRuntime({
    model: restoredFaux.getModel(),
    streamFn: restoredFaux.streamSimple,
    sessionPersistence: persistence,
  });
  await restored.createSession({
    id: "compaction-session",
    systemPrompt: "Compaction persistence test.",
    tools: [],
  });
  const continued = await restored.send(
    "compaction-session",
    "continue after compaction",
  );
  assert.equal(continued.text, "continued after compaction");
  await restored.destroySession("compaction-session");
});

test("mobile host schedules upstream compaction after the context threshold", async () => {
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({
    tokensPerSecond: 0,
    models: [
      {
        id: "small-context",
        contextWindow: 72_000,
        maxTokens: 8_192,
      },
    ],
  });
  faux.setResponses([
    fauxAssistantMessage("AUTOMATIC-COMPACTION-SUMMARY"),
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /AUTOMATIC-COMPACTION-SUMMARY/u);
      assert.match(transcript, /answer, then maintain the context/u);
      return fauxAssistantMessage("answer after in-turn compaction");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    streamOptions: { cacheRetention: "none" },
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "automatic-compaction-session",
    systemPrompt: "Automatic compaction regression.",
    tools: [],
    initialMessages: [
      {
        role: "user",
        content: `old automatic user ${"x".repeat(150_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `old automatic assistant ${"y".repeat(150_000)}`,
        timestamp: 2,
      },
    ],
  });
  const maintenance: Extract<
    AgentRuntimeEvent,
    { type: "context_maintenance" }
  >[] = [];
  runtime.subscribe("automatic-compaction-session", (event) => {
    if (event.type === "context_maintenance") {
      maintenance.push(event);
    }
  });

  const result = await runtime.send(
    "automatic-compaction-session",
    "answer, then maintain the context",
  );

  assert.equal(result.text, "answer after in-turn compaction");
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(
    maintenance.map((event) => `${event.operation}:${event.phase}`),
    ["automatic_compaction:started", "automatic_compaction:completed"],
  );
  const completed = maintenance.at(-1);
  assert.equal(completed?.phase, "completed");
  assert.ok(
    (completed?.tokensBefore ?? 0) > (completed?.tokensAfter ?? 0),
    `expected compaction to reduce context: ${JSON.stringify(completed)}`,
  );
  const usageAfterCompaction = await runtime.contextUsage!(
    "automatic-compaction-session",
  );
  assert.ok(
    usageAfterCompaction.usedTokens < (completed?.tokensBefore ?? 0),
    `expected the context meter to reflect compaction: ${JSON.stringify(usageAfterCompaction)}`,
  );
  const persisted = JSON.parse(
    persistence.values.get("automatic-compaction-session") ?? "{}",
  ) as { entries?: { type: string; summary?: string }[] };
  assert.ok(
    persisted.entries?.some(
      (entry) =>
        entry.type === "compaction" &&
        /AUTOMATIC-COMPACTION-SUMMARY/u.test(entry.summary ?? ""),
    ),
  );
  await runtime.destroySession("automatic-compaction-session");
});

test("a long tool result compacts before the next provider request", async () => {
  const faux = createFauxCore({
    tokensPerSecond: 0,
    models: [
      {
        id: "tool-loop-context",
        contextWindow: 72_000,
        maxTokens: 8_192,
      },
    ],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("large_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("TOOL-LOOP-COMPACTION-SUMMARY"),
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /TOOL-LOOP-COMPACTION-SUMMARY/u);
      assert.match(transcript, /large tool result/u);
      return fauxAssistantMessage("finished without overflowing");
    },
  ]);
  let executions = 0;
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    streamOptions: { cacheRetention: "none" },
  });
  await runtime.createSession({
    id: "tool-loop-compaction-session",
    systemPrompt: "Compact during a long tool loop.",
    tools: [
      {
        name: "large_read",
        label: "Large read",
        description: "Return a large read-only fixture.",
        risk: "read",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async () => {
          executions += 1;
          return {
            content: `large tool result ${"z".repeat(45_000)}`,
            details: {},
          };
        },
      },
    ],
    initialMessages: [
      {
        role: "user",
        content: `older user ${"x".repeat(105_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `older assistant ${"y".repeat(105_000)}`,
        timestamp: 2,
      },
    ],
  });
  const phases: string[] = [];
  runtime.subscribe("tool-loop-compaction-session", (event) => {
    if (event.type === "context_maintenance") {
      phases.push(`${event.operation}:${event.phase}`);
    }
  });

  const result = await runtime.send(
    "tool-loop-compaction-session",
    "inspect the large result once",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "finished without overflowing");
  assert.equal(executions, 1);
  assert.equal(faux.state.callCount, 3);
  assert.deepEqual(phases, [
    "automatic_compaction:started",
    "automatic_compaction:completed",
  ]);
  await runtime.destroySession("tool-loop-compaction-session");
});

test("an empty tool run resumes once more after in-turn compaction", async () => {
  const faux = createFauxCore({
    tokensPerSecond: 0,
    models: [
      {
        id: "empty-after-compaction",
        contextWindow: 72_000,
        maxTokens: 8_192,
      },
    ],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("large_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("EMPTY-RUN-COMPACTION-SUMMARY"),
    fauxAssistantMessage(""),
    fauxAssistantMessage(""),
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /EMPTY-RUN-COMPACTION-SUMMARY/u);
      assert.match(transcript, /Host recovery after context compaction/u);
      return fauxAssistantMessage("final answer after automatic resume");
    },
  ]);
  let executions = 0;
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    streamOptions: { cacheRetention: "none" },
  });
  await runtime.createSession({
    id: "empty-after-compaction-session",
    systemPrompt: "Always return a final answer.",
    tools: [
      {
        name: "large_read",
        label: "Large read",
        description: "Return a large read-only fixture.",
        risk: "read",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async () => {
          executions += 1;
          return {
            content: `large tool result ${"z".repeat(45_000)}`,
            details: {},
          };
        },
      },
    ],
    initialMessages: [
      {
        role: "user",
        content: `older user ${"x".repeat(105_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `older assistant ${"y".repeat(105_000)}`,
        timestamp: 2,
      },
    ],
  });

  const result = await runtime.send(
    "empty-after-compaction-session",
    "inspect once and explain the result",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.text, "final answer after automatic resume");
  assert.equal(executions, 1);
  assert.equal(faux.state.callCount, 5);
  await runtime.destroySession("empty-after-compaction-session");
});

test("mobile host uses upstream retry classification without duplicating a tool-free prompt", async () => {
  const retryMarker = "stream ended before a terminal response event";
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: retryMarker,
    }),
    (context) => {
      const transcript = messageText(context);
      assert.equal(transcript.match(/retry this prompt/gu)?.length, 1);
      assert.doesNotMatch(transcript, new RegExp(retryMarker, "u"));
      return fauxAssistantMessage("recovered after transient failure");
    },
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /recovered after transient failure/u);
      assert.doesNotMatch(transcript, new RegExp(retryMarker, "u"));
      return fauxAssistantMessage("continued after transient recovery");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 },
  });
  await runtime.createSession({
    id: "turn-retry-session",
    systemPrompt: "Turn retry regression.",
    tools: [],
  });
  const phases: string[] = [];
  runtime.subscribe("turn-retry-session", (event) => {
    if (event.type === "retry_status" && event.operation === "turn") {
      phases.push(
        `${event.phase}:${event.attempt ?? 0}:${event.success ?? ""}`,
      );
    }
  });

  const recovered = await runtime.send(
    "turn-retry-session",
    "retry this prompt",
  );

  assert.equal(recovered.status, "completed");
  assert.equal(recovered.text, "recovered after transient failure");
  assert.deepEqual(phases, [
    "scheduled:1:",
    "attempt_started:1:",
    "finished:1:true",
  ]);

  const continued = await runtime.send(
    "turn-retry-session",
    "continue after the retry",
  );
  assert.equal(continued.text, "continued after transient recovery");
  assert.equal(faux.state.callCount, 3);
  await runtime.destroySession("turn-retry-session");
});

test("context overflow safely rewinds, compacts, and replays one tool-free prompt", async () => {
  const persistence = new MemorySessionPersistence();
  const overflowMarker =
    "400 maximum context length exceeded: too many tokens in the request";
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: overflowMarker,
    }),
    fauxAssistantMessage("OVERFLOW-RECOVERY-SUMMARY"),
    (context) => {
      const transcript = messageText(context);
      assert.equal(transcript.match(/recover this prompt/gu)?.length, 1);
      assert.doesNotMatch(transcript, new RegExp(overflowMarker, "u"));
      return fauxAssistantMessage("recovered answer");
    },
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, /OVERFLOW-RECOVERY-SUMMARY/u);
      assert.match(transcript, /recover this prompt/u);
      assert.match(transcript, /recovered answer/u);
      assert.doesNotMatch(transcript, new RegExp(overflowMarker, "u"));
      return fauxAssistantMessage("continued after overflow recovery");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "overflow-recovery-session",
    systemPrompt: "Overflow recovery regression.",
    tools: [],
    initialMessages: [
      {
        role: "user",
        content: `old overflow user ${"x".repeat(120_000)}`,
        timestamp: 1,
      },
      {
        role: "assistant",
        content: `old overflow assistant ${"y".repeat(120_000)}`,
        timestamp: 2,
      },
    ],
  });
  const phases: string[] = [];
  runtime.subscribe("overflow-recovery-session", (event) => {
    if (event.type === "context_maintenance") {
      phases.push(`${event.operation}:${event.phase}`);
    }
  });

  const recovered = await runtime.send(
    "overflow-recovery-session",
    "recover this prompt",
  );

  assert.equal(recovered.status, "completed");
  assert.equal(recovered.text, "recovered answer");
  assert.deepEqual(phases, [
    "overflow_recovery:started",
    "overflow_recovery:completed",
  ]);
  assert.ok(
    JSON.parse(
      persistence.values.get("overflow-recovery-session") ?? "{}",
    ).entries.some((entry: { type: string }) => entry.type === "compaction"),
  );

  const continued = await runtime.send(
    "overflow-recovery-session",
    "continue from the recovered branch",
  );
  assert.equal(continued.text, "continued after overflow recovery");
  assert.equal(faux.state.callCount, 4);
  await runtime.destroySession("overflow-recovery-session");
});

test("overflow without earlier history fails once instead of duplicating the prompt", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "maximum context length exceeded: prompt is too large",
    }),
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 },
  });
  await runtime.createSession({
    id: "root-overflow-session",
    systemPrompt: "Root overflow regression.",
    tools: [],
  });
  const maintenanceEvents: string[] = [];
  runtime.subscribe("root-overflow-session", (event) => {
    if (event.type === "context_maintenance") {
      maintenanceEvents.push(event.operation);
    }
  });

  const result = await runtime.send(
    "root-overflow-session",
    "one prompt that is already too large",
  );

  assert.equal(result.status, "failed");
  assert.equal(faux.state.callCount, 1);
  assert.deepEqual(maintenanceEvents, []);
  await runtime.destroySession("root-overflow-session");
});

test("overflow recovery never replays a turn after a tool execution", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("side_effect_guard", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "maximum context length exceeded: too many tokens",
    }),
  ]);
  let executionCount = 0;
  const guardedTool: RuntimeTool = {
    name: "side_effect_guard",
    label: "Side-effect replay guard",
    description: "Count executions for overflow replay safety.",
    risk: "read",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      executionCount += 1;
      return { content: "executed once", details: {} };
    },
  };
  const runtime = new PiAgentRuntime({
    model: faux.getModel()!,
    streamFn: faux.streamSimple,
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 },
  });
  await runtime.createSession({
    id: "overflow-tool-safety-session",
    systemPrompt: "Never replay tools.",
    tools: [guardedTool],
  });
  const maintenanceEvents: string[] = [];
  runtime.subscribe("overflow-tool-safety-session", (event) => {
    if (event.type === "context_maintenance") {
      maintenanceEvents.push(event.operation);
    }
  });

  const result = await runtime.send(
    "overflow-tool-safety-session",
    "execute the guard once",
  );

  assert.equal(result.status, "failed");
  assert.equal(executionCount, 1);
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(maintenanceEvents, []);
  await runtime.destroySession("overflow-tool-safety-session");
});

test("durable Session projection omits app image bytes without hiding the live image", async () => {
  const persistence = new MemorySessionPersistence();
  const imageData = "cHJpdmF0ZS1pbWFnZS1ieXRlcw==";
  const liveFaux = createFauxCore({ tokensPerSecond: 0 });
  liveFaux.setResponses([
    (context) => {
      assert.match(messageText(context), new RegExp(imageData, "u"));
      return fauxAssistantMessage("live image inspected");
    },
  ]);
  const live = new PiAgentRuntime({
    model: liveFaux.getModel(),
    streamFn: liveFaux.streamSimple,
    sessionPersistence: persistence,
  });
  await live.createSession({
    id: "image-persistence-session",
    systemPrompt: "Image persistence test.",
    tools: [],
  });
  const inspected = await live.send(
    "image-persistence-session",
    "inspect this image",
    { images: [{ data: imageData, mimeType: "image/png" }] },
  );
  assert.equal(inspected.text, "live image inspected");
  const encoded = persistence.values.get("image-persistence-session");
  assert.ok(encoded);
  assert.doesNotMatch(encoded, new RegExp(imageData, "u"));
  assert.match(encoded, /Image attachment omitted from durable Agent session/u);
  await live.destroySession("image-persistence-session");

  const restoredFaux = createFauxCore({ tokensPerSecond: 0 });
  restoredFaux.setResponses([
    (context) => {
      const transcript = messageText(context);
      assert.doesNotMatch(transcript, new RegExp(imageData, "u"));
      assert.match(
        transcript,
        /Image attachment omitted from durable Agent session/u,
      );
      return fauxAssistantMessage("restored without image bytes");
    },
  ]);
  const restored = new PiAgentRuntime({
    model: restoredFaux.getModel(),
    streamFn: restoredFaux.streamSimple,
    sessionPersistence: persistence,
  });
  await restored.createSession({
    id: "image-persistence-session",
    systemPrompt: "Image persistence test.",
    tools: [],
  });
  const continued = await restored.send(
    "image-persistence-session",
    "continue without the image",
  );
  assert.equal(continued.text, "restored without image bytes");
  await restored.destroySession("image-persistence-session");
});

test("persisted tree rejects corruption before a model request", async () => {
  const persistence = new MemorySessionPersistence();
  persistence.values.set(
    "corrupt-session",
    JSON.stringify({
      version: 1,
      metadata: {
        id: "corrupt-session",
        createdAt: "2026-08-04T00:00:00.000Z",
      },
      entries: [
        {
          type: "thinking_level_change",
          id: "bad-thinking",
          parentId: null,
          timestamp: "2026-08-04T00:00:01.000Z",
          thinkingLevel: "invented-level",
        },
      ],
    }),
  );
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });

  await assert.rejects(
    runtime.createSession({
      id: "corrupt-session",
      systemPrompt: "Never reached.",
      tools: [],
    }),
    /thinking level is invalid/u,
  );
  assert.equal(faux.state.callCount, 0);
});

test("session mutations fail closed when encrypted persistence rejects a save", async () => {
  const persistence = new MemorySessionPersistence();
  let rejectSave = true;
  const originalSave = persistence.save.bind(persistence);
  persistence.save = async (sessionId, value) => {
    if (rejectSave) throw new Error("encrypted store unavailable");
    await originalSave(sessionId, value);
  };
  const storage = await PersistedPiSessionStorage.open(
    "atomic-session",
    persistence,
  );
  const entry = {
    type: "message" as const,
    id: await storage.createEntryId(),
    parentId: null,
    timestamp: "2026-08-04T00:00:00.000Z",
    message: {
      role: "user" as const,
      content: [{ type: "text" as const, text: "atomic message" }],
      timestamp: 1,
    },
  };

  await assert.rejects(storage.appendEntry(entry), /store unavailable/u);
  assert.deepEqual(await storage.getEntries(), []);
  assert.equal(persistence.values.has("atomic-session"), false);

  rejectSave = false;
  await storage.appendEntry(entry);
  assert.equal((await storage.getEntries()).length, 1);
  assert.match(
    persistence.values.get("atomic-session") ?? "",
    /atomic message/u,
  );
});

test("a persistence batch writes once and keeps save points durable", async () => {
  const persistence = new MemorySessionPersistence();
  const storage = await PersistedPiSessionStorage.open(
    "batched-session",
    persistence,
  );

  await storage.beginBatch();
  for (const text of ["one", "two", "three"]) {
    await storage.appendEntry({
      type: "message",
      id: await storage.createEntryId(),
      parentId: await storage.getLeafId(),
      timestamp: "2026-08-04T00:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: 1,
      },
    });
  }

  assert.equal(persistence.saves, 0);
  await storage.flush();
  assert.equal(persistence.saves, 1);
  assert.match(persistence.values.get("batched-session") ?? "", /three/u);

  await storage.appendEntry({
    type: "message",
    id: await storage.createEntryId(),
    parentId: await storage.getLeafId(),
    timestamp: "2026-08-04T00:00:01.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "four" }],
      timestamp: 2,
    },
  });
  await storage.finishBatch();
  assert.equal(persistence.saves, 2);
  assert.match(persistence.values.get("batched-session") ?? "", /four/u);
});

test("durable sessions keep only final answers, steps, and opaque reasoning continuity", async () => {
  const persistence = new MemorySessionPersistence();
  const storage = await PersistedPiSessionStorage.open(
    "reasoning-private-session",
    persistence,
  );
  const rawReasoning = "RAW-CHAIN-OF-THOUGHT";
  const rawProgress = "I will inspect the project before calling a tool.";
  const encryptedContent = "opaque-reasoning-ciphertext";
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  const toolEntry: SessionTreeEntry = {
    type: "message",
    id: await storage.createEntryId(),
    parentId: null,
    timestamp: "2026-08-13T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: rawReasoning,
          thinkingSignature: JSON.stringify({
            type: "reasoning",
            id: "rs_private_fixture",
            encrypted_content: encryptedContent,
            summary: [{ type: "summary_text", text: rawReasoning }],
            content: [{ type: "reasoning_text", text: rawReasoning }],
            status: "completed",
          }),
        },
        {
          type: "text",
          text: rawProgress,
          textSignature: JSON.stringify({
            v: 1,
            id: "msg_commentary_fixture",
            phase: "commentary",
          }),
        },
        {
          type: "toolCall",
          id: "call_private_fixture",
          name: "read_fixture",
          arguments: {},
        },
      ],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-fixture",
      usage,
      stopReason: "toolUse",
      timestamp: 1,
    },
  };
  await storage.appendEntry(toolEntry);

  const finalEntry: SessionTreeEntry = {
    type: "message",
    id: await storage.createEntryId(),
    parentId: toolEntry.id,
    timestamp: "2026-08-13T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "UNSIGNED-PRIVATE-THOUGHT" },
        {
          type: "text",
          text: "Final answer only.",
          textSignature: JSON.stringify({
            v: 1,
            id: "msg_final_fixture",
            phase: "final_answer",
          }),
        },
      ],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-fixture",
      usage,
      stopReason: "stop",
      timestamp: 2,
    },
  };
  await storage.appendEntry(finalEntry);

  const encoded = persistence.values.get("reasoning-private-session") ?? "";
  assert.doesNotMatch(encoded, new RegExp(rawReasoning, "u"));
  assert.doesNotMatch(encoded, new RegExp(rawProgress, "u"));
  assert.doesNotMatch(encoded, /UNSIGNED-PRIVATE-THOUGHT/u);
  assert.match(encoded, /Final answer only\./u);
  assert.match(encoded, new RegExp(encryptedContent, "u"));

  const entries = await storage.getEntries();
  const durableText = JSON.stringify(entries);
  assert.doesNotMatch(durableText, new RegExp(rawReasoning, "u"));
  assert.doesNotMatch(durableText, new RegExp(rawProgress, "u"));
  const firstMessage = entries[0];
  assert.equal(firstMessage?.type, "message");
  if (firstMessage?.type !== "message") return;
  assert.equal(firstMessage.message.role, "assistant");
  if (firstMessage.message.role !== "assistant") return;
  const thinking = firstMessage.message.content.find(
    (block) => block.type === "thinking",
  );
  assert.equal(thinking?.type, "thinking");
  if (thinking?.type !== "thinking") return;
  assert.equal(thinking.thinking, "");
  const signature = JSON.parse(thinking.thinkingSignature ?? "") as {
    encrypted_content?: string;
    summary?: unknown[];
    content?: unknown;
  };
  assert.equal(signature.encrypted_content, encryptedContent);
  assert.deepEqual(signature.summary, []);
  assert.equal(signature.content, undefined);
});

test("a tool loop persists once per upstream save point instead of per entry", async () => {
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_fixture", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("tool loop complete"),
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "batched-tool-loop",
    systemPrompt: "Persistence batching test.",
    tools: [textTool("read_fixture")],
  });

  const result = await runtime.send("batched-tool-loop", "read once");

  assert.equal(result.status, "completed");
  assert.equal(result.text, "tool loop complete");
  assert.equal(persistence.saves, 2);
  assert.match(
    persistence.values.get("batched-tool-loop") ?? "",
    /tool loop complete/u,
  );
  await runtime.destroySession("batched-tool-loop");
});

test("the upstream context hook can inject once while durable history stays redacted", async () => {
  const marker = "[[ONE-TIME-CREDENTIAL]]";
  const secret = "SENSITIVE-CREDENTIAL-FIXTURE";
  const persistence = new MemorySessionPersistence();
  let revealAvailable = true;
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("credential_read", {}), {
      stopReason: "toolUse",
    }),
    (context) => {
      const transcript = messageText(context);
      assert.match(transcript, new RegExp(secret, "u"));
      assert.doesNotMatch(transcript, /ONE-TIME-CREDENTIAL/u);
      return fauxAssistantMessage(`model attempted to echo ${secret}`);
    },
    (context) => {
      const transcript = messageText(context);
      assert.doesNotMatch(transcript, new RegExp(secret, "u"));
      assert.doesNotMatch(transcript, /ONE-TIME-CREDENTIAL/u);
      assert.match(transcript, /••••/u);
      return fauxAssistantMessage("continued with redacted history");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  await runtime.createSession({
    id: "sensitive-context-session",
    systemPrompt: "Sensitive context test.",
    tools: [
      {
        name: "credential_read",
        label: "credential read",
        description: "fixture",
        risk: "read",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async () => ({ content: marker, details: { oneTime: true } }),
      },
    ],
    transformContextText: (text) => {
      let result = text.replaceAll(secret, "••••");
      if (revealAvailable && result.includes(marker)) {
        revealAvailable = false;
        result = result.replace(marker, secret);
      }
      return result.replaceAll(marker, "••••");
    },
    redactDurableText: (text) =>
      text.replaceAll(secret, "••••").replaceAll(marker, "••••"),
  });

  const first = await runtime.send(
    "sensitive-context-session",
    "request the credential",
  );
  assert.match(first.text, new RegExp(secret, "u"));
  const encodedAfterFirst =
    persistence.values.get("sensitive-context-session") ?? "";
  assert.doesNotMatch(encodedAfterFirst, new RegExp(secret, "u"));
  assert.doesNotMatch(encodedAfterFirst, /ONE-TIME-CREDENTIAL/u);

  const second = await runtime.send(
    "sensitive-context-session",
    "continue without revealing it again",
  );
  assert.equal(second.text, "continued with redacted history");
  await runtime.destroySession("sensitive-context-session");
});

test("host policy can block sensitive arguments on read-risk tools", async () => {
  const secret = "SENSITIVE-ARGUMENT-FIXTURE";
  let executions = 0;
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_fixture", { query: secret }), {
      stopReason: "toolUse",
    }),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.isError, true);
      assert.match(messageText(context), /sensitive argument blocked/u);
      return fauxAssistantMessage("blocked safely");
    },
  ]);
  const runtime = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
  });
  await runtime.createSession({
    id: "sensitive-argument-policy",
    systemPrompt: "Policy test.",
    tools: [
      {
        name: "read_fixture",
        label: "read fixture",
        description: "fixture",
        risk: "read",
        parameters: Type.Object({ query: Type.String() }),
        execute: async () => {
          executions += 1;
          return { content: "unexpected", details: {} };
        },
      },
    ],
    authorizeToolCall: async ({ arguments: arguments_ }) =>
      JSON.stringify(arguments_).includes(secret)
        ? { allow: false, reason: "sensitive argument blocked" }
        : undefined,
  });

  const result = await runtime.send(
    "sensitive-argument-policy",
    "try the sensitive read",
  );

  assert.equal(result.text, "blocked safely");
  assert.equal(executions, 0);
  await runtime.destroySession("sensitive-argument-policy");
});
