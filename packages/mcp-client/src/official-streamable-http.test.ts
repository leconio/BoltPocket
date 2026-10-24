import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { OfficialStreamableHttpClientFactory } from "./official-streamable-http.ts";

test("official adapter negotiates and uses stateless Streamable HTTP", async () => {
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: string | number;
      method: string;
      params?: Record<string, unknown>;
    };
    methods.push(message.method);
    if (message.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (message.method === "server/discover") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      return;
    }
    if (message.method === "initialize") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (message.method === "tools/list") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "read_fixture",
                description: "Read fixture data",
                inputSchema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                  additionalProperties: false,
                },
                annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                },
              },
            ],
          },
        }),
      );
      return;
    }
    if (message.method === "tools/call") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "fixture-result" }],
            isError: false,
          },
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const factory = new OfficialStreamableHttpClientFactory({
    connectTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  let client: Awaited<ReturnType<typeof factory.connect>> | undefined;
  try {
    client = await factory.connect({
      id: "fixture",
      name: "Fixture",
      revision: "1",
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    const tools = await client.listTools();
    assert.equal(tools[0]?.name, "read_fixture");
    const result = await client.callTool(tools[0]!, { id: "42" });
    assert.deepEqual(result, {
      content: [{ type: "text", text: "fixture-result" }],
      isError: false,
    });
    assert.ok(methods.includes("initialize"));
    assert.ok(methods.includes("tools/list"));
    assert.ok(methods.includes("tools/call"));
  } finally {
    await client?.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("broker-backed OAuth performs one interactive insufficient-scope upgrade", async () => {
  let accessToken = "initial-token";
  const observedScopes: (string | undefined)[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: string | number;
      method: string;
      params?: Record<string, unknown>;
    };
    if (message.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (message.method === "server/discover") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      return;
    }
    if (message.method === "initialize") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "scope-fixture", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (
      message.method === "tools/list" &&
      request.headers.authorization !== "Bearer upgraded-token"
    ) {
      response.setHeader(
        "WWW-Authenticate",
        'Bearer error="insufficient_scope", scope="repo:write issues:write"',
      );
      response.writeHead(403).end();
      return;
    }
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: [] },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const factory = new OfficialStreamableHttpClientFactory({
    connectTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  let client: Awaited<ReturnType<typeof factory.connect>> | undefined;
  try {
    client = await factory.connect({
      id: "scope-fixture",
      name: "Scope fixture",
      revision: "1",
      url: "https://scope-fixture.example.test/mcp",
      fetch: (input, init) => {
        const requestUrl = new URL(String(input));
        return fetch(
          `http://127.0.0.1:${address.port}${requestUrl.pathname}${requestUrl.search}`,
          init,
        );
      },
      authProvider: { token: async () => accessToken },
      onInsufficientScope: async (scope) => {
        observedScopes.push(scope);
        accessToken = "upgraded-token";
      },
    });
    assert.deepEqual(await client.listTools(), []);
    assert.deepEqual(observedScopes, ["repo:write issues:write"]);
  } finally {
    await client?.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
