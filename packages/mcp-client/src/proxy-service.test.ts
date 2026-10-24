import assert from "node:assert/strict";
import test from "node:test";

import type {
  McpRemoteCallResult,
  McpRemoteClient,
  McpRemoteClientFactory,
  McpRemoteTool,
  McpServerRuntimeDefinition,
  McpServerSource,
  McpToolApprovalPort,
} from "./contracts.ts";
import { McpProxyService } from "./proxy-service.ts";

class FakeClient implements McpRemoteClient {
  listCalls = 0;
  callCalls: { name: string; arguments: Readonly<Record<string, unknown>> }[] =
    [];
  closeCalls = 0;
  toolsChangedHandler: () => void = () => undefined;
  readonly tools: readonly McpRemoteTool[];
  readonly callResult: McpRemoteCallResult;

  constructor(
    tools: readonly McpRemoteTool[],
    callResult: McpRemoteCallResult = {
      content: [{ type: "text", text: "ok" }],
    },
  ) {
    this.tools = tools;
    this.callResult = callResult;
  }

  serverInfo() {
    return { protocolEra: "modern" as const, protocolVersion: "2026-07-28" };
  }

  setToolsChangedHandler(handler: () => void) {
    this.toolsChangedHandler = handler;
  }

  async listTools() {
    this.listCalls += 1;
    return this.tools;
  }

  async callTool(
    tool: McpRemoteTool,
    arguments_: Readonly<Record<string, unknown>>,
  ) {
    this.callCalls.push({ name: tool.name, arguments: arguments_ });
    return this.callResult;
  }

  async ping() {
    return {};
  }

  async listPrompts() {
    return { prompts: [] };
  }

  async getPrompt(name: string) {
    return { description: name, messages: [] };
  }

  async listResources() {
    return { resources: [] };
  }

  async listResourceTemplates() {
    return { resourceTemplates: [] };
  }

  async readResource(uri: string) {
    return { contents: [{ uri, text: "fixture" }] };
  }

  async complete() {
    return { completion: { values: [] } };
  }

  async close() {
    this.closeCalls += 1;
  }
}

class FakeFactory implements McpRemoteClientFactory {
  connectCalls: string[] = [];
  readonly clients: Readonly<Record<string, FakeClient>>;

  constructor(clients: Readonly<Record<string, FakeClient>>) {
    this.clients = clients;
  }

  async connect(server: McpServerRuntimeDefinition) {
    this.connectCalls.push(server.id);
    const client = this.clients[server.id];
    if (!client) throw new Error(`missing fake client: ${server.id}`);
    return client;
  }
}

class FakeSource implements McpServerSource {
  servers: readonly McpServerRuntimeDefinition[];

  constructor(servers: readonly McpServerRuntimeDefinition[]) {
    this.servers = servers;
  }

  async listForProject() {
    return this.servers;
  }
}

function server(
  id: string,
  overrides: Partial<McpServerRuntimeDefinition> = {},
): McpServerRuntimeDefinition {
  return {
    id,
    name: id === "design" ? "Design" : "Documents",
    revision: "1",
    trustToolAnnotations: true,
    url: `https://${id}.example.test/mcp`,
    ...overrides,
  };
}

const designTools: readonly McpRemoteTool[] = [
  {
    name: "get_design_context",
    title: "Get design context",
    description: "Read selected design nodes and component metadata.",
    inputSchema: { type: "object", properties: { nodeId: { type: "string" } } },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "publish_component",
    description: "Publish a component mutation.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

test("status is lazy and search connects only when a catalog is requested", async () => {
  let now = 1_000;
  const source = new FakeSource([server("design")]);
  const client = new FakeClient(designTools);
  const factory = new FakeFactory({ design: client });
  const proxy = new McpProxyService({
    source,
    factory,
    catalogTtlMs: 5_000,
    now: () => now,
  });

  const idle = await proxy.execute("project-1", { action: "status" });
  assert.equal(factory.connectCalls.length, 0);
  assert.deepEqual(idle, {
    action: "status",
    transport: "streamable-http",
    servers: [
      {
        id: "design",
        name: "Design",
        state: "idle",
        catalog: "not-loaded",
      },
    ],
    lazy: true,
  });

  const found = (await proxy.execute("project-1", {
    action: "search",
    query: "design context",
  })) as { matches: { score: number; tool: { name: string } }[] };
  assert.equal(found.matches[0]?.tool.name, "get_design_context");
  assert.deepEqual(factory.connectCalls, ["design"]);
  assert.equal(client.listCalls, 1);

  await proxy.execute("project-1", {
    action: "search",
    query: "component",
  });
  assert.equal(client.listCalls, 1, "fresh catalogs are reused");

  now += 5_001;
  await proxy.execute("project-1", {
    action: "search",
    query: "component",
  });
  assert.equal(client.listCalls, 2, "expired catalogs are refreshed");
});

test("idle Streamable HTTP clients close while their lazy catalogs stay cached", async () => {
  type Timer = {
    callback: () => void;
    cancelled: boolean;
  };
  const timers: Timer[] = [];
  const client = new FakeClient(designTools);
  const factory = new FakeFactory({ design: client });
  const proxy = new McpProxyService({
    source: new FakeSource([server("design")]),
    factory,
    connectionIdleMs: 15_000,
    now: () => 1_000,
    scheduleIdle(callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancelIdle(timer) {
      (timer as unknown as Timer).cancelled = true;
    },
  });

  await proxy.execute("project-1", {
    action: "list",
    serverId: "design",
  });
  assert.equal(timers.length, 1);
  timers[0]!.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(client.closeCalls, 1);

  const idle = (await proxy.execute("project-1", { action: "status" })) as {
    servers: { state: string; catalog: string; toolCount?: number }[];
  };
  assert.deepEqual(idle.servers, [
    {
      id: "design",
      name: "Design",
      state: "idle",
      catalog: "loaded",
      toolCount: 2,
      loadedAt: new Date(1_000).toISOString(),
    },
  ]);

  await proxy.execute("project-1", {
    action: "call",
    serverId: "design",
    toolName: "get_design_context",
    arguments: {},
  });
  assert.deepEqual(factory.connectCalls, ["design", "design"]);
  assert.equal(client.listCalls, 1, "reconnect reuses the cached tool catalog");
});

test("an Agent run lease keeps Streamable HTTP sessions alive between calls", async () => {
  type Timer = {
    callback: () => void;
    cancelled: boolean;
  };
  const timers: Timer[] = [];
  const client = new FakeClient(designTools);
  const proxy = new McpProxyService({
    source: new FakeSource([server("design")]),
    factory: new FakeFactory({ design: client }),
    connectionIdleMs: 15_000,
    scheduleIdle(callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancelIdle(timer) {
      (timer as unknown as Timer).cancelled = true;
    },
  });

  const release = proxy.retainProject("project-1");
  await proxy.execute("project-1", {
    action: "list",
    serverId: "design",
  });
  assert.equal(timers.length, 0, "the run lease suppresses the idle timer");

  release();
  release();
  assert.equal(timers.length, 1, "an idempotent release starts one idle timer");
  timers[0]!.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(client.closeCalls, 1);
});

test("schema exposes risk and directly calls trusted read-only tools", async () => {
  const client = new FakeClient(designTools, {
    content: [
      { type: "text", text: "token-secret result" },
      { type: "image", mimeType: "image/png", data: "very-large-base64" },
    ],
    structuredContent: { selected: 3 },
  });
  const factory = new FakeFactory({ design: client });
  const proxy = new McpProxyService({
    source: new FakeSource([
      server("design", {
        redact: (value) => value.replaceAll("token-secret", "••••"),
      }),
    ]),
    factory,
  });

  const schema = (await proxy.execute("project-1", {
    action: "schema",
    serverId: "design",
    toolName: "get_design_context",
  })) as { tool: { callable: boolean; inputSchema: unknown } };
  assert.equal(schema.tool.callable, true);
  assert.deepEqual(schema.tool.inputSchema, designTools[0]!.inputSchema);

  const result = (await proxy.execute("project-1", {
    action: "call",
    serverId: "design",
    toolName: "get_design_context",
    arguments: { nodeId: "1:2" },
  })) as { result: { content: unknown[] } };
  assert.deepEqual(client.callCalls, [
    { name: "get_design_context", arguments: { nodeId: "1:2" } },
  ]);
  assert.equal(JSON.stringify(result).includes("token-secret"), false);
  assert.equal(JSON.stringify(result).includes("very-large-base64"), false);
  assert.equal(JSON.stringify(result).includes("binary omitted"), true);

  await assert.rejects(
    proxy.execute("project-1", {
      action: "call",
      serverId: "design",
      toolName: "publish_component",
      arguments: {},
    }),
    /requires interactive approval/u,
  );
  assert.equal(client.callCalls.length, 1);
});

test("write tools require exact approval and are rechecked before execution", async () => {
  const client = new FakeClient(designTools);
  const requests: Parameters<McpToolApprovalPort["authorize"]>[0][] = [];
  const approval: McpToolApprovalPort = {
    async authorize(request) {
      requests.push(request);
      return { approved: true, scope: "once" };
    },
  };
  const proxy = new McpProxyService({
    source: new FakeSource([server("design")]),
    factory: new FakeFactory({ design: client }),
    approval,
  });

  await proxy.execute(
    "project-1",
    {
      action: "call",
      serverId: "design",
      toolName: "publish_component",
      arguments: { componentId: "1:2" },
    },
    undefined,
    { approvalSessionId: "session-1", projectName: "Launch" },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.risk, "destructive");
  assert.equal(requests[0]?.approvalSessionId, "session-1");
  assert.deepEqual(client.callCalls, [
    { name: "publish_component", arguments: { componentId: "1:2" } },
  ]);
  assert.equal(client.listCalls, 2, "approval forces a fresh schema recheck");
});

test("approveTools globs can require approval for an otherwise trusted read", async () => {
  const client = new FakeClient(designTools);
  let approvals = 0;
  const proxy = new McpProxyService({
    source: new FakeSource([
      server("design", { approveTools: ["get_*", "docs/delete_*"] }),
    ]),
    factory: new FakeFactory({ design: client }),
    approval: {
      async authorize() {
        approvals += 1;
        return { approved: false };
      },
    },
  });

  const listing = (await proxy.execute("project-1", {
    action: "list",
    serverId: "design",
  })) as { tools: { name: string; approvalRequired: boolean }[] };
  assert.equal(listing.tools[0]?.approvalRequired, true);
  await assert.rejects(
    proxy.execute("project-1", {
      action: "call",
      serverId: "design",
      toolName: "get_design_context",
      arguments: {},
    }),
    /denied by the user/u,
  );
  assert.equal(approvals, 1);
  assert.equal(client.callCalls.length, 0);
});

test("the same proxy exposes prompts, resources, templates, completion, and ping", async () => {
  const client = new FakeClient(designTools);
  const proxy = new McpProxyService({
    source: new FakeSource([server("design")]),
    factory: new FakeFactory({ design: client }),
  });

  for (const input of [
    { action: "ping", serverId: "design" } as const,
    { action: "prompts", serverId: "design" } as const,
    { action: "get-prompt", serverId: "design", promptName: "review" } as const,
    { action: "resources", serverId: "design" } as const,
    { action: "resource-templates", serverId: "design" } as const,
    {
      action: "read-resource",
      serverId: "design",
      uri: "design://fixture/1",
    } as const,
    {
      action: "complete",
      serverId: "design",
      ref: { type: "ref/prompt", name: "review" },
      argument: { name: "tone", value: "con" },
    } as const,
  ]) {
    const result = (await proxy.execute("project-1", input)) as {
      action: string;
      serverId: string;
    };
    assert.equal(result.action, input.action);
    assert.equal(result.serverId, "design");
  }
});

test("local allow-list narrows remotely read-only tools", async () => {
  const client = new FakeClient(designTools);
  const proxy = new McpProxyService({
    source: new FakeSource([
      server("design", { allowedToolNames: ["another_tool"] }),
    ]),
    factory: new FakeFactory({ design: client }),
  });

  await assert.rejects(
    proxy.execute("project-1", {
      action: "call",
      serverId: "design",
      toolName: "get_design_context",
      arguments: {},
    }),
    /allow-list/u,
  );
  assert.equal(client.callCalls.length, 0);
});

test("changing a server revision retires the old lazy client", async () => {
  const first = new FakeClient(designTools);
  const second = new FakeClient(designTools);
  const source = new FakeSource([server("design")]);
  let active = first;
  const factory: McpRemoteClientFactory = {
    async connect() {
      return active;
    },
  };
  const proxy = new McpProxyService({ source, factory });

  await proxy.execute("project-1", {
    action: "list",
    serverId: "design",
  });
  active = second;
  source.servers = [server("design", { revision: "2" })];
  await proxy.execute("project-1", {
    action: "list",
    serverId: "design",
  });

  assert.equal(first.closeCalls, 1);
  assert.equal(second.listCalls, 1);
});

test("one broken server does not hide results from other servers", async () => {
  const source = new FakeSource([server("design"), server("docs")]);
  const factory: McpRemoteClientFactory = {
    async connect(definition) {
      if (definition.id === "docs") throw new Error("docs unavailable");
      return new FakeClient(designTools);
    },
  };
  const proxy = new McpProxyService({ source, factory });

  const result = (await proxy.execute("project-1", {
    action: "search",
    query: "design",
  })) as { matches: unknown[]; errors: { serverId: string }[] };
  assert.ok(result.matches.length > 0);
  assert.deepEqual(result.errors, [
    {
      serverId: "docs",
      serverName: "Documents",
      error: "docs unavailable",
    },
  ]);
});
