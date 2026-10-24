import assert from "node:assert/strict";
import test from "node:test";

import { PiAgentRuntime } from "@boltpocket/agent-runtime";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";

import type {
  AgentRunEvent,
  AgentRunInput,
} from "../../application/ports/agent-runtime.ts";
import type {
  AgentTextDelegationPort,
  TextDelegationInput,
} from "../../application/ports/text-delegation.ts";
import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

function runInput(prompt: string): AgentRunInput {
  return {
    runId: "run-delegation",
    conversationId: "conversation-delegation",
    prompt,
    project: null,
    memories: [],
    skills: [],
    resources: [],
    attachments: [],
  };
}

function subagentCalls(
  calls: readonly {
    id: string;
    agent: "scout" | "planner" | "reviewer";
    task: string;
    description: string;
  }[],
) {
  return fauxAssistantMessage(
    calls.map(({ id, ...arguments_ }) =>
      fauxToolCall("subagent", arguments_, { id }),
    ),
    { stopReason: "toolUse" },
  );
}

function toolText(result: ToolResultMessage) {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toolResults(context: Context) {
  return context.messages.filter(
    (message): message is ToolResultMessage => message.role === "toolResult",
  );
}

function runtimeWith(
  faux: ReturnType<typeof createFauxCore>,
  textDelegation: AgentTextDelegationPort,
) {
  return new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    textDelegation,
    registryFactory: () => ({}) as never,
    projectShellJavaScriptRuntime: null,
  });
}

test("one subagent call creates one child and three calls in one Pi turn run concurrently", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    subagentCalls([
      {
        id: "child-alpha",
        agent: "scout",
        task: "Classify synthetic alpha: request stopped after 9 seconds.",
        description: "分类 alpha",
      },
      {
        id: "child-beta",
        agent: "planner",
        task: "Classify synthetic beta: access denied by policy.",
        description: "分类 beta",
      },
      {
        id: "child-gamma",
        agent: "reviewer",
        task: "Classify synthetic gamma: disk space exhausted.",
        description: "分类 gamma",
      },
    ]),
    (context) => {
      const results = toolResults(context);
      assert.equal(results.length, 3);
      assert.deepEqual(results.map(toolText), [
        "TIMEOUT",
        "PERMISSION",
        "DISK",
      ]);
      assert.ok(results.every((result) => !result.isError));
      return fauxAssistantMessage("三项并行分析已汇总。");
    },
  ]);
  let active = 0;
  let maxActive = 0;
  const calls: TextDelegationInput[] = [];
  const events: AgentRunEvent[] = [];
  const runtime = runtimeWith(faux, {
    execute: async (input) => {
      calls.push(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        content:
          input.role === "scout"
            ? "TIMEOUT"
            : input.role === "planner"
              ? "PERMISSION"
              : "DISK",
        modelRef: "provider-special:model-special",
        toolActivity: ["读取项目文件"],
      };
    },
  });

  try {
    const output = await runtime.run(
      runInput("并行分类三个互不依赖的故障。"),
      new AbortController().signal,
      (event) => events.push(event),
    );
    assert.equal(output.content, "三项并行分析已汇总。");
    assert.equal(calls.length, 3);
    assert.equal(maxActive, 3);
    assert.deepEqual(
      calls.map((call) => call.role),
      ["scout", "planner", "reviewer"],
    );
    for (const call of calls) {
      const names = call.tools.map((tool) => tool.name);
      assert.ok(names.includes("read"));
      assert.ok(names.includes("grep"));
      assert.ok(!names.includes("write"));
      assert.ok(!names.includes("edit"));
      assert.ok(!names.includes("bash"));
      assert.ok(!names.includes("subagent"));
      assert.ok(!names.includes("browser"));
      assert.ok(!names.includes("credential_access_request"));
    }
    assert.equal(output.toolActivity, undefined);
    assert.deepEqual(
      output.collaboration?.map((task) => ({
        role: task.role,
        description: task.description,
        status: task.status,
        summary: task.summary,
        toolActivity: task.toolActivity,
      })),
      [
        {
          role: "scout",
          description: "分类 alpha",
          status: "completed",
          summary: "TIMEOUT",
          toolActivity: ["读取项目文件"],
        },
        {
          role: "planner",
          description: "分类 beta",
          status: "completed",
          summary: "PERMISSION",
          toolActivity: ["读取项目文件"],
        },
        {
          role: "reviewer",
          description: "分类 gamma",
          status: "completed",
          summary: "DISK",
          toolActivity: ["读取项目文件"],
        },
      ],
    );
    assert.ok(
      events.some(
        (event) => event.type === "status" && /3 个并行/u.test(event.label),
      ),
    );
    assert.ok(
      events.some(
        (event) => event.type === "status" && /个仍在运行/u.test(event.label),
      ),
    );
  } finally {
    await runtime.dispose();
  }
});

test("one failed child does not discard successful sibling tool results", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    subagentCalls([
      {
        id: "child-healthy",
        agent: "reviewer",
        task: "Review the healthy synthetic sample.",
        description: "审查正常样本",
      },
      {
        id: "child-broken",
        agent: "scout",
        task: "Inspect the broken synthetic sample.",
        description: "检查失败样本",
      },
    ]),
    (context) => {
      const results = toolResults(context);
      assert.equal(results.length, 2);
      assert.equal(results.filter((result) => result.isError).length, 1);
      assert.ok(results.some((result) => toolText(result) === "可用结论"));
      return fauxAssistantMessage("保留成功结果，并报告另一个子任务失败。");
    },
  ]);
  const runtime = runtimeWith(faux, {
    execute: async (input) => {
      if (input.role === "scout") {
        throw new Error("fixture specialist unavailable");
      }
      return {
        content: "可用结论",
        modelRef: "provider-special:model-special",
        toolActivity: [],
      };
    },
  });

  try {
    const output = await runtime.run(
      runInput("并行分析两个样本。"),
      new AbortController().signal,
    );
    assert.equal(output.content, "保留成功结果，并报告另一个子任务失败。");
    assert.deepEqual(output.collaboration?.map((task) => task.status).sort(), [
      "completed",
      "failed",
    ]);
  } finally {
    await runtime.dispose();
  }
});

test("subagent blocks credential-like task text before a child receives it", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    subagentCalls([
      {
        id: "child-unsafe",
        agent: "reviewer",
        task: "Review password: delegation-secret-fixture-42",
        description: "检查配置",
      },
    ]),
    (context) => {
      const [result] = toolResults(context);
      assert.ok(result?.isError);
      assert.match(toolText(result), /疑似凭据/u);
      return fauxAssistantMessage("已阻止把凭据发送给其他模型。");
    },
  ]);
  let executions = 0;
  const runtime = runtimeWith(faux, {
    execute: async () => {
      executions += 1;
      return {
        content: "unexpected",
        modelRef: "unexpected",
        toolActivity: [],
      };
    },
  });

  try {
    const output = await runtime.run(
      runInput("不要把凭据发给协作 Agent。"),
      new AbortController().signal,
    );
    assert.equal(output.content, "已阻止把凭据发送给其他模型。");
    assert.equal(executions, 0);
  } finally {
    await runtime.dispose();
  }
});

test("a parent run refuses a fourth direct child", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    subagentCalls(
      ["one", "two", "three", "four"].map((id) => ({
        id: `child-${id}`,
        agent: "reviewer" as const,
        task: `Review synthetic sample ${id}.`,
        description: `审查 ${id}`,
      })),
    ),
    (context) => {
      const results = toolResults(context);
      assert.equal(results.length, 4);
      assert.equal(results.filter((result) => result.isError).length, 1);
      assert.ok(
        results.some((result) => /最多启动 3 个/u.test(toolText(result))),
      );
      return fauxAssistantMessage("第四个协作 Agent 已被拒绝。");
    },
  ]);
  let executions = 0;
  const runtime = runtimeWith(faux, {
    execute: async () => {
      executions += 1;
      return { content: "ok", modelRef: "fixture", toolActivity: [] };
    },
  });

  try {
    const output = await runtime.run(
      runInput("尝试启动四个协作 Agent。"),
      new AbortController().signal,
    );
    assert.equal(output.content, "第四个协作 Agent 已被拒绝。");
    assert.equal(executions, 3);
  } finally {
    await runtime.dispose();
  }
});
