import assert from "node:assert/strict";
import test from "node:test";

import { toAgentRunEvent } from "./pi-runtime-events.ts";

test("Pi runtime events become mobile stream and tool progress events", () => {
  assert.deepEqual(
    toAgentRunEvent({
      type: "run_started",
      sessionId: "conversation:test",
    }),
    { type: "status", label: "模型已就绪" },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "turn_started",
      sessionId: "conversation:test",
    }),
    { type: "status", label: "正在思考" },
  );

  assert.deepEqual(
    toAgentRunEvent({
      type: "model_activity",
      sessionId: "conversation:test",
    }),
    null,
  );

  assert.deepEqual(
    toAgentRunEvent({
      type: "text_delta",
      sessionId: "conversation:test",
      delta: "部分回答",
    }),
    null,
  );

  const execution = {
    toolCallId: "tool-1",
    toolName: "project_context_read",
    arguments: {},
  };
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_started",
      sessionId: "conversation:test",
      execution,
    }),
    {
      type: "tool-started",
      toolCallId: "tool-1",
      label: "读取项目上下文",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_completed",
      sessionId: "conversation:test",
      execution,
    }),
    {
      type: "tool-completed",
      toolCallId: "tool-1",
      label: "读取项目上下文",
      outcome: "completed",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_started",
      sessionId: "conversation:test",
      execution: {
        ...execution,
        toolName: "bash",
        arguments: { command: "printf 'hello\nworld'" },
      },
    }),
    {
      type: "tool-started",
      toolCallId: "tool-1",
      label: "运行：printf 'hello world'",
    },
  );
  const sensitiveCommand = toAgentRunEvent({
    type: "tool_started",
    sessionId: "conversation:test",
    execution: {
      ...execution,
      toolName: "bash",
      arguments: {
        command:
          "TOKEN=secret-value curl --user 'alice:password' -H 'Authorization: Bearer abc.def' https://user:password@example.com",
      },
    },
  });
  assert.ok(sensitiveCommand && "label" in sensitiveCommand);
  assert.match(sensitiveCommand.label, /^运行：TOKEN=••••/u);
  assert.doesNotMatch(
    sensitiveCommand.label,
    /secret-value|alice:password|abc\.def|user:password/u,
  );
  assert.ok(sensitiveCommand.label.length <= 120);
  const longCommand = toAgentRunEvent({
    type: "tool_started",
    sessionId: "conversation:test",
    execution: {
      ...execution,
      toolName: "bash",
      arguments: { command: `printf ${"x".repeat(180)} REPORT.md` },
    },
  });
  assert.ok(longCommand && "label" in longCommand);
  assert.equal(longCommand.label.length, 120);
  assert.match(longCommand.label, /^运行：printf x+…x+ REPORT\.md$/u);

  for (const [toolName, arguments_, label] of [
    [
      "read",
      { path: "/project/src/app.ts", offset: 4, limit: 8 },
      "读取：/project/src/app.ts · 第 4–11 行",
    ],
    [
      "edit",
      {
        path: "/project/src/app.ts",
        edits: [
          { oldText: "old", newText: "new" },
          { oldText: "before", newText: "after" },
        ],
      },
      "编辑：/project/src/app.ts · 2 处",
    ],
    ["write", { path: "/project/REPORT.md" }, "写入：/project/REPORT.md"],
    [
      "grep",
      { pattern: "BrowserProvider", path: "/project/src" },
      "搜索：BrowserProvider · /project/src",
    ],
    [
      "find",
      { pattern: "**/*.test.ts", path: "/project" },
      "查找：**/*.test.ts · /project",
    ],
    ["ls", { path: "/project/src" }, "列出：/project/src"],
    [
      "js_exec",
      { code: "(2n ** 127n - 1n) % 97n" },
      "运行计算：(2n ** 127n - 1n) % 97n",
    ],
    ["skill_read", { name: "release-safety" }, "读取 Skill：release-safety"],
    [
      "project_resource_catalog",
      { action: "search", packId: "bootstrap-icons", query: "qr code" },
      "查找项目内置资源",
    ],
    [
      "preview_project",
      { entryPath: "/project/apps/demo/index.html" },
      "预览项目 H5",
    ],
    ["credential_vault_list", {}, "查看项目密码本授权"],
    [
      "third_party_capability_assess",
      { kind: "skill", url: "https://example.com/SKILL.md" },
      "体检第三方 Skill 或 MCP",
    ],
    [
      "third_party_capability_install",
      { assessmentId: "assessment-one" },
      "安装第三方 Skill 或 MCP",
    ],
    ["skill_market_review", { skillId: "release-safety" }, "审核待发布 Skill"],
    [
      "skill_market_publish",
      { skillId: "release-safety" },
      "发布 Skill 到市场",
    ],
    [
      "analyze_media",
      { question: "读取截图中的错误提示" },
      "识别图片：读取截图中的错误提示",
    ],
    [
      "generate_image",
      { prompt: "一只戴红围巾的橘猫" },
      "生成图片：一只戴红围巾的橘猫",
    ],
    [
      "subagent",
      { agent: "reviewer", description: "审查设置流程" },
      "协作 Agent：审查 · 审查设置流程",
    ],
    ["sshpass", { credentialId: "credential-ssh-fixture" }, "从密码本连接 SSH"],
    [
      "browser",
      {
        action: "open",
        url: "https://example.com/account?token=secret#section",
      },
      "打开临时网页：https://example.com/account",
    ],
    ["browser", { action: "close", taskId: "browser-one" }, "关闭临时网页"],
    ["browser", { action: "read_text", offset: 16_000 }, "继续读取网页"],
    ["browser", { action: "find_text", query: "report" }, "查找网页文字"],
    ["browser", { action: "wait_for_text", query: "ready" }, "等待网页文字"],
    ["browser", { action: "click", targetId: "control-2" }, "点击网页控件"],
    ["browser", { action: "type", targetId: "control-1" }, "输入网页文字"],
    [
      "browser",
      {
        action: "navigate",
        url: "https://example.com/docs?token=secret#section",
      },
      "打开网页：https://example.com/docs",
    ],
  ] as const) {
    assert.deepEqual(
      toAgentRunEvent({
        type: "tool_started",
        sessionId: "conversation:test",
        execution: { ...execution, toolName, arguments: arguments_ },
      }),
      { type: "tool-started", toolCallId: "tool-1", label },
    );
  }
  assert.deepEqual(
    toAgentRunEvent(
      {
        type: "tool_started",
        sessionId: "conversation:test",
        execution: {
          ...execution,
          toolName: "mcp",
          arguments: {
            action: "call",
            serverId: "mcp-design",
            toolName: "get_design_context",
          },
        },
      },
      "zh-CN",
      { mcpServerNames: new Map([["mcp-design", "Design"]]) },
    ),
    {
      type: "tool-started",
      toolCallId: "tool-1",
      label: "调用 MCP：Design · get_design_context",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_started",
      sessionId: "conversation:test",
      execution: {
        ...execution,
        toolName: "connector_custom_action",
        arguments: {},
      },
    }),
    {
      type: "tool-started",
      toolCallId: "tool-1",
      label: "connector_custom_action",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_completed",
      sessionId: "conversation:test",
      execution: {
        ...execution,
        toolName: "browser",
        arguments: { action: "snapshot" },
      },
    }),
    {
      type: "tool-completed",
      toolCallId: "tool-1",
      label: "读取当前网页",
      outcome: "completed",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_completed",
      sessionId: "conversation:test",
      execution: {
        ...execution,
        toolName: "edit",
        arguments: { path: "/project/NOTES.md", oldText: "a", newText: "b" },
      },
    }),
    {
      type: "tool-completed",
      toolCallId: "tool-1",
      label: "编辑：/project/NOTES.md · 1 处",
      outcome: "staged",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "tool_completed",
      sessionId: "conversation:test",
      execution: {
        ...execution,
        toolName: "bash",
        arguments: { command: "missing-command" },
        isError: true,
        result: {
          content: [
            {
              type: "text",
              text: "command failed: password=do-not-show",
            },
          ],
          details: {},
        },
      },
    }),
    {
      type: "tool-completed",
      toolCallId: "tool-1",
      label: "运行：missing-command",
      outcome: "failed",
      failureReason: "command failed: password=••••",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "context_maintenance",
      sessionId: "conversation:test",
      operation: "overflow_recovery",
      phase: "started",
    }),
    {
      type: "context-maintenance",
      operation: "overflow_recovery",
      phase: "started",
      label: "上下文过长，正在整理后重试",
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "context_maintenance",
      sessionId: "conversation:test",
      operation: "automatic_compaction",
      phase: "completed",
      tokensBefore: 120_000,
      tokensAfter: 24_000,
    }),
    {
      type: "context-maintenance",
      operation: "automatic_compaction",
      phase: "completed",
      label: "对话上下文已整理",
      tokensBefore: 120_000,
      tokensAfter: 24_000,
    },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "retry_status",
      sessionId: "conversation:test",
      operation: "turn",
      phase: "scheduled",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      error: "fixture unavailable",
    }),
    { type: "status", label: "模型请求失败，准备重试（1/3）" },
  );
  assert.deepEqual(
    toAgentRunEvent({
      type: "retry_status",
      sessionId: "conversation:test",
      operation: "compaction",
      phase: "finished",
    }),
    { type: "status", label: "上下文整理重试已结束" },
  );
});
