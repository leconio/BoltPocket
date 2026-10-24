import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_ACTIVITY_LIMITS,
  AgentExecutionActivityBuilder,
} from "./agent-execution-activity.ts";

test("execution activity keeps public narration and tool outcomes", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.appendText("我先读取项目上下文。");
  activity.startTool("read-1", "读取：/project/app.ts", 1_000);
  activity.completeTool("read-1", "读取：/project/app.ts", "completed", 1_750);

  assert.deepEqual(
    activity.finish().map((item) => {
      const { id: _id, ...visible } = item;
      return visible;
    }),
    [
      {
        kind: "text",
        content: "我先读取项目上下文。",
      },
      {
        kind: "tool",
        label: "读取：/project/app.ts",
        status: "completed",
        durationMs: 750,
      },
    ],
  );
});

test("public narration is trimmed and bounded", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.appendText("   ");
  activity.appendText(`公开说明：${"x".repeat(4_000)}`);

  const [narration] = activity.finish();
  assert.ok(narration && narration.kind === "text");
  assert.equal(narration.content.startsWith("公开说明："), true);
  assert.equal(
    narration.content.length,
    AGENT_ACTIVITY_LIMITS.textItemCharacters,
  );
});

test("tool snapshots stay immutable while outcomes change", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.startTool("read-1", "读取项目", 100);
  const first = activity.snapshot();
  const unchanged = activity.snapshot();
  activity.completeTool("read-1", "读取项目", "completed", 200);
  const completed = activity.snapshot();

  assert.equal(first[0]?.kind, "tool");
  assert.equal(first[0]?.status, "running");
  assert.deepEqual(unchanged, first);
  assert.equal(completed[0]?.kind, "tool");
  assert.equal(completed[0]?.status, "completed");
});

test("unfinished tools remain when a run stops", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.startTool("edit-1", "编辑：/project/app.ts", 2_000);

  assert.deepEqual(
    activity
      .finish({
        unfinishedToolStatus: "cancelled",
        finishedAt: 2_500,
      })
      .map((item) => {
        const { id: _id, ...visible } = item;
        return visible;
      }),
    [
      {
        kind: "tool",
        label: "编辑：/project/app.ts",
        status: "cancelled",
        durationMs: 500,
      },
    ],
  );
});

test("failed tools retain a bounded reason without adding one to successes", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.startTool("mcp-1", "调用 MCP：GitHub · search", 1_000);
  activity.completeTool(
    "mcp-1",
    "调用 MCP：GitHub · search",
    "failed",
    1_250,
    `连接失败：${"x".repeat(500)}`,
  );
  activity.completeTool(
    "read-1",
    "读取项目上下文",
    "completed",
    1_500,
    "不应保留",
  );

  const [failed, completed] = activity.finish();
  assert.equal(failed?.kind, "tool");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.failureReason?.startsWith("连接失败："), true);
  assert.equal(failed?.failureReason?.length, 360);
  assert.equal(completed?.kind, "tool");
  assert.equal(completed?.status, "completed");
  assert.equal(completed && "failureReason" in completed, false);
});

test("context maintenance stays in the durable chronological activity", () => {
  const activity = new AgentExecutionActivityBuilder();
  activity.startContextMaintenance("automatic_compaction", 3_000);
  activity.completeContextMaintenance(
    "automatic_compaction",
    "completed",
    118_000,
    24_000,
    4_250,
  );

  assert.deepEqual(
    activity.finish().map(({ id: _id, ...visible }) => visible),
    [
      {
        kind: "context",
        operation: "automatic_compaction",
        status: "completed",
        tokensBefore: 118_000,
        tokensAfter: 24_000,
        durationMs: 1_250,
      },
    ],
  );
});
