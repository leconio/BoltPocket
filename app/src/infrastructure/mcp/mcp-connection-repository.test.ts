import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";

import {
  McpConnectionRepository,
  McpConnectionStorageError,
} from "./mcp-connection-repository.ts";

const CONNECTION_ID = "mcp-aaaaaaaaaaaaaaaa";

function input() {
  return {
    projectId: null,
    name: " Design MCP ",
    serverUrl: "https://mcp.example.test/mcp",
    authentication: { kind: "none" as const },
    enabled: true,
  };
}

test("MCP connections persist normalized non-secret metadata", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new McpConnectionRepository(
    store,
    () => CONNECTION_ID,
    () => new Date("2026-08-10T12:00:00.000Z"),
  );

  const created = await repository.create(input());
  assert.deepEqual(created, {
    id: CONNECTION_ID,
    projectId: null,
    name: "Design MCP",
    serverUrl: "https://mcp.example.test/mcp",
    authentication: { kind: "none" },
    enabled: true,
    trustToolAnnotations: false,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
  });

  const restored = new McpConnectionRepository(store, () => "unused");
  assert.deepEqual(await restored.list(), [created]);
  const persisted = await store.read("mcp:connections:manifest:v1");
  assert.equal(persisted?.includes("token"), false);
  assert.equal(JSON.parse(persisted ?? "null").version, 6);
});

test("legacy project-scoped grants migrate to one global connection", async () => {
  const store = new InMemoryDurableDocumentStore();
  await store.write(
    "mcp:connections:manifest:v1",
    JSON.stringify({
      version: 1,
      connections: [
        {
          id: CONNECTION_ID,
          serverUrl: input().serverUrl,
          authentication: input().authentication,
          enabled: input().enabled,
          name: "Legacy MCP",
          projectIds: ["project-1", "project-2"],
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
        },
      ],
    }),
  );
  const repository = new McpConnectionRepository(store, () => "unused");
  const [migrated] = await repository.list();
  assert.equal(migrated?.name, "Legacy MCP");
  assert.equal(migrated?.projectId, null);
  assert.equal("projectIds" in (migrated ?? {}), false);

  await repository.update(CONNECTION_ID, {
    ...input(),
    name: "Global MCP",
  });
  const persisted = JSON.parse(
    (await store.read("mcp:connections:manifest:v1")) ?? "null",
  ) as { version: number; connections: Record<string, unknown>[] };
  assert.equal(persisted.version, 6);
  assert.equal("projectIds" in persisted.connections[0]!, false);
  assert.equal(persisted.connections[0]?.projectId, null);
});

test("MCP approval globs and local annotation trust persist as policy metadata", async () => {
  const repository = new McpConnectionRepository(
    new InMemoryDurableDocumentStore(),
    () => CONNECTION_ID,
  );
  const created = await repository.create({
    ...input(),
    approveTools: ["delete_*", "*", "delete_*"],
    allowedToolNames: ["get_issue", "create_issue"],
    trustToolAnnotations: false,
  });
  assert.deepEqual(created.approveTools, ["*", "delete_*"]);
  assert.deepEqual(created.allowedToolNames, ["create_issue", "get_issue"]);
  assert.equal(created.trustToolAnnotations, false);
});

test("MCP connections allow local HTTP credentials while public and OAuth endpoints require HTTPS", async () => {
  const repository = new McpConnectionRepository(
    new InMemoryDurableDocumentStore(),
    () => CONNECTION_ID,
  );
  const local = await repository.create({
    ...input(),
    serverUrl: "http://192.168.51.72:8787/mcp",
    authentication: {
      kind: "vault-token",
      credentialIds: ["credential-aaaaaaaaaaaaaaaa"],
    },
  });
  assert.equal(local.serverUrl, "http://192.168.51.72:8787/mcp");
  assert.throws(
    () =>
      repository.create({
        ...input(),
        serverUrl: "http://mcp.example.com/mcp",
      }),
    /公网.*HTTPS/u,
  );
  assert.throws(
    () =>
      repository.create({
        ...input(),
        serverUrl: "http://raspi.local:8787/mcp",
        authentication: {
          kind: "oauth",
          authorizationId: "oauth-aaaaaaaaaaaaaaaa",
        },
      }),
    /OAuth.*HTTPS/u,
  );
});

test("query API keys persist only their safe parameter name", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new McpConnectionRepository(store, () => CONNECTION_ID);
  const created = await repository.create({
    ...input(),
    serverUrl: "https://mcp.amap.example/mcp",
    authentication: {
      kind: "vault-token",
      credentialIds: ["credential-aaaaaaaaaaaaaaaa"],
      queryParameterName: "key",
    },
  });
  assert.equal(created.serverUrl, "https://mcp.amap.example/mcp");
  assert.equal(
    created.authentication.kind === "vault-token"
      ? created.authentication.queryParameterName
      : undefined,
    "key",
  );
  assert.doesNotMatch(
    (await store.read("mcp:connections:manifest:v1")) ?? "",
    /secret|\?key=/u,
  );
  assert.throws(
    () =>
      repository.update(CONNECTION_ID, {
        ...input(),
        authentication: {
          kind: "vault-token",
          credentialIds: ["credential-aaaaaaaaaaaaaaaa"],
          queryParameterName: "bad name",
        },
      }),
    /认证配置无效/u,
  );
});

test("multiple API header credentials persist as non-secret references", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new McpConnectionRepository(store, () => CONNECTION_ID);
  const created = await repository.create({
    ...input(),
    authentication: {
      kind: "vault-token",
      credentialIds: [
        "credential-aaaaaaaaaaaaaaaa",
        "credential-bbbbbbbbbbbbbbbb",
      ],
    },
  });

  assert.deepEqual(
    created.authentication.kind === "vault-token"
      ? created.authentication.credentialIds
      : [],
    ["credential-aaaaaaaaaaaaaaaa", "credential-bbbbbbbbbbbbbbbb"],
  );
  assert.doesNotMatch(
    (await store.read("mcp:connections:manifest:v1")) ?? "",
    /secret-token/u,
  );
});

test("MCP authentication rejects duplicate or excessive credential references", () => {
  const repository = new McpConnectionRepository(
    new InMemoryDurableDocumentStore(),
    () => CONNECTION_ID,
  );
  assert.throws(
    () =>
      repository.create({
        ...input(),
        authentication: {
          kind: "vault-token",
          credentialIds: [
            "credential-aaaaaaaaaaaaaaaa",
            "credential-aaaaaaaaaaaaaaaa",
          ],
        },
      }),
    /认证配置无效/u,
  );
  assert.throws(
    () =>
      repository.create({
        ...input(),
        authentication: {
          kind: "vault-token",
          credentialIds: Array.from(
            { length: 9 },
            (_, index) => `credential-${String(index).padStart(16, "a")}`,
          ),
        },
      }),
    /认证配置无效/u,
  );
});

test("version 3 single credential references migrate to credential arrays", async () => {
  const store = new InMemoryDurableDocumentStore();
  await store.write(
    "mcp:connections:manifest:v1",
    JSON.stringify({
      version: 3,
      connections: [
        {
          id: CONNECTION_ID,
          name: "Legacy token MCP",
          serverUrl: input().serverUrl,
          enabled: input().enabled,
          authentication: {
            kind: "vault-token",
            credentialId: "credential-aaaaaaaaaaaaaaaa",
          },
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
        },
      ],
    }),
  );

  const [migrated] = await new McpConnectionRepository(
    store,
    () => "unused",
  ).list();
  assert.deepEqual(migrated?.authentication, {
    kind: "vault-token",
    credentialIds: ["credential-aaaaaaaaaaaaaaaa"],
  });
});

test("repository serializes concurrent mutations", async () => {
  const store = new InMemoryDurableDocumentStore();
  let sequence = 0;
  const repository = new McpConnectionRepository(store, () => {
    sequence += 1;
    return `mcp-${String(sequence).padStart(16, "a")}`;
  });

  await Promise.all([
    repository.create({ ...input(), name: "First" }),
    repository.create({ ...input(), name: "Second" }),
  ]);
  assert.equal((await repository.list()).length, 2);
});

test("manifest validation fails closed on unknown fields", async () => {
  const store = new InMemoryDurableDocumentStore();
  await store.write(
    "mcp:connections:manifest:v1",
    JSON.stringify({
      version: 1,
      connections: [
        {
          id: CONNECTION_ID,
          serverUrl: input().serverUrl,
          authentication: input().authentication,
          enabled: input().enabled,
          name: "Design MCP",
          projectIds: ["project-1"],
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
          secret: "must-not-be-accepted",
        },
      ],
    }),
  );
  const repository = new McpConnectionRepository(store, () => CONNECTION_ID);
  await assert.rejects(repository.list(), McpConnectionStorageError);
});
