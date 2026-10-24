import assert from "node:assert/strict";
import test from "node:test";

import type { McpServerRuntimeDefinition } from "./contracts.ts";
import {
  createMcpFetch,
  McpSecurityError,
  validatedMcpServerUrl,
} from "./security.ts";

function definition(
  overrides: Partial<McpServerRuntimeDefinition> = {},
): McpServerRuntimeDefinition {
  return {
    id: "server-1",
    name: "Server",
    revision: "1",
    url: "https://mcp.example.test/mcp",
    ...overrides,
  };
}

test("MCP endpoints allow authenticated HTTP locally but require HTTPS publicly", () => {
  assert.equal(
    validatedMcpServerUrl(definition({ url: "http://raspi.local:8787/mcp" }))
      .origin,
    "http://raspi.local:8787",
  );
  assert.equal(
    validatedMcpServerUrl(
      definition({
        url: "http://192.168.51.72:8787/mcp",
        requestHeaders: async () => ({ "X-API-Key": "secret" }),
      }),
    ).origin,
    "http://192.168.51.72:8787",
  );
  assert.throws(
    () =>
      validatedMcpServerUrl(
        definition({
          url: "http://mcp.example.com/mcp",
        }),
      ),
    /requires HTTPS/u,
  );
});

test("dynamic credential headers are same-origin and resolved per request", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  let token = "first";
  const fetch = createMcpFetch(
    definition({
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
      requestHeaders: async () => ({ "X-API-Key": token }),
    }),
  );

  await fetch("https://mcp.example.test/mcp", { method: "POST" });
  token = "second";
  await fetch("https://mcp.example.test/mcp", { method: "GET" });

  assert.equal(
    new Headers(requests[0]!.init?.headers).get("X-API-Key"),
    "first",
  );
  assert.equal(
    new Headers(requests[1]!.init?.headers).get("X-API-Key"),
    "second",
  );
  assert.equal(requests[0]!.init?.credentials, "omit");
  assert.equal(requests[0]!.init?.redirect, "manual");
  await assert.rejects(fetch("https://attacker.example/mcp"), /cross-origin/u);
});

test("transport-owned and hop-by-hop headers cannot be supplied by credentials", async () => {
  const fetch = createMcpFetch(
    definition({
      fetch: async () => new Response(null, { status: 202 }),
      requestHeaders: async () => ({ "Mcp-Session-Id": "forged" }),
    }),
  );
  await assert.rejects(fetch("https://mcp.example.test/mcp"), /not permitted/u);
});

test("dynamic query credentials are appended only at the transport boundary", async () => {
  const requests: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response("ok");
  }) as typeof globalThis.fetch;
  const secured = createMcpFetch({
    id: "maps",
    name: "Maps",
    url: "https://mcp.example.test/mcp?mode=streamable",
    revision: "1",
    fetch,
    requestQuery: async () => ({ key: "secret value" }),
  });

  await secured("https://mcp.example.test/mcp?mode=streamable", {});
  assert.equal(
    requests[0],
    "https://mcp.example.test/mcp?mode=streamable&key=secret+value",
  );
});

test("dynamic query credential names and values fail closed", async () => {
  for (const requestQuery of [
    async () => ({ "bad name": "token" }),
    async () => ({ key: "" }),
    async () => ({ key: "line\nbreak" }),
  ]) {
    const secured = createMcpFetch({
      id: "maps",
      name: "Maps",
      url: "https://mcp.example.test/mcp",
      revision: "1",
      fetch: globalThis.fetch,
      requestQuery,
    });
    await assert.rejects(
      secured("https://mcp.example.test/mcp", {}),
      McpSecurityError,
    );
  }
});
