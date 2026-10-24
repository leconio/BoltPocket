import assert from "node:assert/strict";
import test from "node:test";

import { PiAgentRuntime } from "@boltpocket/agent-runtime";
import type { McpProxyInput, McpProxyPort } from "@boltpocket/mcp-client";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import type {
  AgentRunEvent,
  AgentRunInput,
} from "@/application/ports/agent-runtime";
import { GLOBAL_MCP_SCOPE_ID } from "@/application/ports/mcp-connections";

import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

const mcpProject: NonNullable<AgentRunInput["project"]> = {
  id: "mcp-project",
  name: "MCP Project",
  symbol: "MP",
  description: "",
  instructions: "",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 1,
  resourceCount: 0,
};

test("mobile PI discovers and uses app-global MCP", async () => {
  const calls: { scopeId: string; input: McpProxyInput }[] = [];
  const transportLifecycle: string[] = [];
  const mcpProxy: McpProxyPort & {
    retainProject(projectId: string): () => void;
  } = {
    retainProject(projectId) {
      transportLifecycle.push(`retain:${projectId}`);
      return () => transportLifecycle.push(`release:${projectId}`);
    },
    async execute(scopeId, input) {
      calls.push({ scopeId, input });
      return {
        action: "status",
        transport: "streamable-http",
        servers: [{ id: "mcp-design", name: "Design", state: "idle" }],
        lazy: true,
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.filter((tool) => tool.name === "mcp").length,
        1,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "get_design_context"),
        false,
      );
      assert.match(
        context.systemPrompt ?? "",
        /app has enabled these global MCP services/u,
      );
      assert.match(context.systemPrompt ?? "", /mcp-design/u);
      assert.match(context.systemPrompt ?? "", /matching enabled MCP first/u);
      return fauxAssistantMessage(
        fauxToolCall("mcp", {
          action: "call",
          serverId: "mcp-design",
          toolName: "get_design_context",
          arguments: { nodeId: "fixture-node" },
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.toolName, "mcp");
      assert.match(JSON.stringify(result.content), /streamable-http/u);
      return fauxAssistantMessage("MCP 已配置，目录尚未加载。");
    },
  ]);
  const events: AgentRunEvent[] = [];
  const input: AgentRunInput = {
    runId: "mcp-run",
    conversationId: "mcp-conversation",
    prompt: "检查 MCP 状态。",
    project: mcpProject,
    memories: [],
    skills: [],
    resources: [],
    attachments: [],
  };
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    mcpProxy,
    projectShellJavaScriptRuntime: null,
    registryFactory: () =>
      ({
        descriptors: () => [],
        listResources: async () => [],
      }) as never,
  });

  try {
    const output = await runtime.run(
      input,
      new AbortController().signal,
      (event) => events.push(event),
    );
    assert.equal(output.content, "MCP 已配置，目录尚未加载。");
    assert.deepEqual(calls, [
      { scopeId: GLOBAL_MCP_SCOPE_ID, input: { action: "status" } },
      {
        scopeId: GLOBAL_MCP_SCOPE_ID,
        input: {
          action: "call",
          serverId: "mcp-design",
          toolName: "get_design_context",
          arguments: { nodeId: "fixture-node" },
        },
      },
    ]);
    assert.deepEqual(transportLifecycle, [
      `retain:${GLOBAL_MCP_SCOPE_ID}`,
      `release:${GLOBAL_MCP_SCOPE_ID}`,
    ]);
    assert.equal(
      events.some(
        (event) =>
          event.type === "tool-started" &&
          event.label === "调用 MCP：Design · get_design_context",
      ),
      true,
    );
  } finally {
    await runtime.dispose();
  }
});

test("MCP protocol failures become failed activity with a visible reason", async () => {
  const mcpProxy: McpProxyPort = {
    async execute(_scopeId, input) {
      if (input.action === "status") {
        return {
          action: "status",
          servers: [{ id: "mcp-github", name: "GitHub", state: "idle" }],
        };
      }
      assert.equal(input.action, "call");
      return {
        action: "call",
        serverId: "mcp-github",
        toolName: "search_repositories",
        isError: true,
        result: {
          content: [
            { type: "text", text: "GitHub authentication has expired." },
          ],
        },
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("mcp", {
        action: "call",
        serverId: "mcp-github",
        toolName: "search_repositories",
        arguments: { query: "BoltPocket" },
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.isError, true);
      assert.match(
        JSON.stringify(result.content),
        /GitHub authentication has expired/u,
      );
      return fauxAssistantMessage("GitHub MCP 认证已过期。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    mcpProxy,
    projectShellJavaScriptRuntime: null,
    registryFactory: () =>
      ({ descriptors: () => [], listResources: async () => [] }) as never,
  });
  const events: AgentRunEvent[] = [];

  try {
    const output = await runtime.run(
      {
        runId: "mcp-error-run",
        conversationId: "mcp-error-conversation",
        prompt: "搜索 GitHub。",
        project: mcpProject,
        memories: [],
        skills: [],
        resources: [],
        attachments: [],
      },
      new AbortController().signal,
      (event) => events.push(event),
    );

    assert.equal(output.content, "GitHub MCP 认证已过期。");
    assert.equal(
      events.some(
        (event) =>
          event.type === "tool-completed" &&
          event.outcome === "failed" &&
          event.failureReason === "GitHub authentication has expired.",
      ),
      true,
    );
    assert.equal(
      output.activity?.some(
        (item) =>
          item.kind === "tool" &&
          item.status === "failed" &&
          item.failureReason === "GitHub authentication has expired.",
      ),
      true,
    );
  } finally {
    await runtime.dispose();
  }
});

test("quick conversations can see app-global MCP", async () => {
  let proxyCalled = false;
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "mcp"),
        true,
      );
      assert.match(
        context.systemPrompt ?? "",
        /app has enabled these global MCP services/u,
      );
      return fauxAssistantMessage("快速对话可以使用全局 MCP。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    mcpProxy: {
      async execute(scopeId, input) {
        proxyCalled = true;
        assert.equal(scopeId, GLOBAL_MCP_SCOPE_ID);
        assert.equal(input.action, "status");
        return {
          action: "status",
          servers: [{ id: "mcp-global", name: "Global", state: "idle" }],
        };
      },
    },
    projectShellJavaScriptRuntime: null,
    registryFactory: () =>
      ({ descriptors: () => [], listResources: async () => [] }) as never,
  });

  try {
    const output = await runtime.run(
      {
        runId: "mcp-quick-run",
        conversationId: "mcp-quick-conversation",
        prompt: "检查 MCP。",
        project: null,
        memories: [],
        skills: [],
        resources: [],
        attachments: [],
      },
      new AbortController().signal,
    );

    assert.equal(output.content, "快速对话可以使用全局 MCP。");
    assert.equal(proxyCalled, true);
  } finally {
    await runtime.dispose();
  }
});
