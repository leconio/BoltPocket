import assert from "node:assert/strict";
import test from "node:test";

import { McpCatalogClient } from "./mcp-catalog-client.ts";

const response = {
  catalogVersion: "2026-08-12.3",
  region: "china-mainland",
  services: [
    {
      id: "maxcompute",
      name: { zhCN: "阿里云 MaxCompute", en: "Alibaba Cloud MaxCompute" },
      provider: { zhCN: "阿里云", en: "Alibaba Cloud" },
      description: { zhCN: "数据分析", en: "Data analytics" },
      documentationUrl: "https://help.aliyun.com/maxcompute",
      support: "phase-one",
      configuration: {
        serverUrl: "https://mcp.cn-hangzhou.maxcompute.aliyun.com/mcp",
        authentication: { kind: "oauth" },
      },
    },
  ],
};

test("MCP catalog client passes region and validates configuration", async () => {
  let requested = "";
  const client = new McpCatalogClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (input) => {
        requested = String(input);
        return Response.json(response);
      }) as typeof fetch,
    },
  );
  const catalog = await client.load("china-mainland");
  assert.equal(
    requested,
    "https://api.example.com/v1/mcp/catalog?region=china-mainland",
  );
  assert.equal(
    catalog.services[0]?.configuration?.serverUrl,
    response.services[0]!.configuration.serverUrl,
  );
});

test("MCP catalog client rejects oversized, mismatched, and secret-bearing data", async () => {
  const load = (body: unknown, headers?: HeadersInit) =>
    new McpCatalogClient(
      { baseUrl: "https://api.example.com" },
      {
        fetch: (async () => Response.json(body, { headers })) as typeof fetch,
      },
    ).load("china-mainland");

  await assert.rejects(load({ ...response, region: "global" }), /invalid/u);
  await assert.rejects(
    load({
      ...response,
      services: [
        {
          ...response.services[0],
          configuration: {
            ...response.services[0]!.configuration,
            serverUrl:
              "https://mcp.cn-hangzhou.maxcompute.aliyun.com/mcp?key=secret",
          },
        },
      ],
    }),
    /permitted|invalid/u,
  );
  await assert.rejects(
    load(response, { "Content-Length": String(128 * 1024 + 1) }),
    /large/u,
  );
  await assert.rejects(
    load({
      ...response,
      services: [{ ...response.services[0], configuration: undefined }],
    }),
    /invalid/u,
  );
  await assert.rejects(
    load({
      ...response,
      services: [{ ...response.services[0], support: "confirmed" }],
    }),
    /invalid/u,
  );
});
