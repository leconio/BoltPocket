import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveAgentOutputStore,
  partialAssistantMessageFromLiveOutput,
} from "./live-agent-output.ts";

test("live output stays conversation-local and rejects stale run updates", () => {
  const store = new LiveAgentOutputStore();
  store.start("conversation-a", "run-a");
  store.start("conversation-b", "run-b");

  assert.equal(
    store.update("conversation-a", "run-a", {
      status: "生成回答",
      activity: [
        {
          id: "activity-thinking-private",
          kind: "thinking",
          content: "private reasoning",
        },
        {
          id: "activity-text-public",
          kind: "text",
          content: "progress narration",
        },
        {
          id: "activity-tool-1",
          kind: "tool",
          label: "读取项目上下文",
          status: "completed",
        },
      ],
    }),
    true,
  );
  assert.equal(
    store.update("conversation-a", "stale-run", { status: "stale" }),
    false,
  );
  assert.equal(store.snapshot("conversation-a").status, "生成回答");
  assert.deepEqual(store.snapshot("conversation-a").activity, [
    {
      id: "activity-text-public",
      kind: "text",
      content: "progress narration",
    },
    {
      id: "activity-tool-1",
      kind: "tool",
      label: "读取项目上下文",
      status: "completed",
    },
  ]);
  assert.equal(store.snapshot("conversation-b").status, "");
});

test("an old cleanup cannot clear a newer stream", () => {
  const store = new LiveAgentOutputStore();
  let updates = 0;
  const unsubscribe = store.subscribe("conversation-a", () => updates++);

  store.start("conversation-a", "run-old");
  store.start("conversation-a", "run-new");
  assert.equal(store.clear("conversation-a", "run-old"), false);
  assert.equal(store.snapshot("conversation-a").runId, "run-new");
  assert.equal(store.clear("conversation-a", "run-new"), true);
  assert.equal(store.snapshot("conversation-a").runId, null);
  assert.equal(updates, 3);
  unsubscribe();
  assert.equal(store.activeStoreCount(), 0);
});

test("one conversation store never notifies another conversation", () => {
  const store = new LiveAgentOutputStore();
  let conversationAUpdates = 0;
  let conversationBUpdates = 0;
  const unsubscribeA = store.subscribe(
    "conversation-a",
    () => (conversationAUpdates += 1),
  );
  const unsubscribeB = store.subscribe(
    "conversation-b",
    () => (conversationBUpdates += 1),
  );

  store.start("conversation-a", "run-a");
  store.update("conversation-a", "run-a", { status: "working" });

  assert.equal(conversationAUpdates, 2);
  assert.equal(conversationBUpdates, 0);
  store.clear("conversation-a", "run-a");
  unsubscribeA();
  unsubscribeB();
  assert.equal(store.activeStoreCount(), 0);
});

test("stopping a run converts its live output into a durable partial message", () => {
  const store = new LiveAgentOutputStore();
  store.start("conversation-a", "run-a", "执行中", 1_000);
  store.update("conversation-a", "run-a", {
    activity: [
      {
        id: "activity-text-0",
        kind: "text",
        content: "已经找到配置文件。",
      },
      {
        id: "activity-tool-1",
        kind: "tool",
        label: "编辑配置",
        status: "running",
      },
      {
        id: "activity-context-2",
        kind: "context",
        operation: "automatic_compaction",
        status: "running",
      },
    ],
  });

  assert.deepEqual(
    partialAssistantMessageFromLiveOutput(
      store.snapshot("conversation-a"),
      "cancelled",
      1_500,
    ),
    {
      id: "assistant-run-a-partial",
      role: "assistant",
      content: "",
      execution: {
        status: "cancelled",
        durationMs: 500,
        activity: [
          {
            id: "activity-text-0",
            kind: "text",
            content: "已经找到配置文件。",
          },
          {
            id: "activity-tool-1",
            kind: "tool",
            label: "编辑配置",
            status: "cancelled",
          },
          {
            id: "activity-context-2",
            kind: "context",
            operation: "automatic_compaction",
            status: "cancelled",
          },
        ],
      },
    },
  );
});

test("live collaboration tasks update in place and stay bounded", () => {
  const store = new LiveAgentOutputStore();
  store.start("conversation-a", "run-a");
  const task = {
    id: "child-one",
    role: "reviewer" as const,
    description: "审查权限边界",
    status: "running" as const,
    startedAt: 100,
  };

  assert.equal(
    store.updateCollaboration("conversation-a", "run-a", task),
    true,
  );
  assert.equal(
    store.updateCollaboration("conversation-a", "run-a", {
      ...task,
      status: "completed",
      durationMs: 250,
      summary: "权限边界正确。",
    }),
    true,
  );
  assert.deepEqual(store.snapshot("conversation-a").collaboration, [
    {
      ...task,
      status: "completed",
      durationMs: 250,
      summary: "权限边界正确。",
    },
  ]);
  assert.equal(
    store.updateCollaboration("conversation-a", "stale", task),
    false,
  );
});
