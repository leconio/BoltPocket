import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreateCredentialInput,
  CredentialSecret,
  CredentialVaultItem,
  InternalCredentialVaultPort,
  UpdateCredentialInput,
} from "@/application/ports/credential-vault";
import type {
  McpConnection,
  McpConnectionInput,
  McpConnectionRepositoryPort,
} from "@/application/ports/mcp-connections";

import { ProjectMcpServerSource } from "./project-mcp-server-source.ts";

const item: CredentialVaultItem = {
  id: "credential-aaaaaaaaaaaaaaaa",
  label: "Design token",
  kind: "api-token",
  service: "Design",
  endpoint: "https://mcp.example.test/api",
  apiAuthentication: "bearer",
  agentAccess: "internal-only",
  projectIds: [],
  source: "manual",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

const connection: McpConnection = {
  id: "mcp-aaaaaaaaaaaaaaaa",
  projectId: null,
  name: "Design MCP",
  serverUrl: "https://mcp.example.test/mcp",
  authentication: {
    kind: "vault-token",
    credentialIds: [item.id],
  },
  enabled: true,
  trustToolAnnotations: true,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

class FakeConnections implements McpConnectionRepositoryPort {
  constructor(readonly values: McpConnection[]) {}
  async list(projectId?: string) {
    return this.values.filter(
      (value) => projectId === undefined || value.projectId === projectId,
    );
  }
  async create(_input: McpConnectionInput): Promise<McpConnection> {
    throw new Error("not used");
  }
  async update(id: string, input: McpConnectionInput): Promise<McpConnection> {
    const index = this.values.findIndex((value) => value.id === id);
    if (index < 0) throw new Error("missing");
    const previous = this.values[index]!;
    const updated: McpConnection = {
      ...previous,
      ...input,
      trustToolAnnotations: input.trustToolAnnotations ?? false,
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    this.values[index] = updated;
    return updated;
  }
  async remove() {}
}

class FakeVault implements InternalCredentialVaultPort {
  reads = 0;
  constructor(
    readonly values: readonly CredentialVaultItem[],
    readonly secret: CredentialSecret = {
      kind: "api-token",
      token: "secret-token",
    },
  ) {}
  async list() {
    return [...this.values];
  }
  async create(_input: CreateCredentialInput): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }
  async update(
    _id: string,
    _input: UpdateCredentialInput,
  ): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }
  async remove() {}
  async readForProject(credentialId: string, projectId: string) {
    const found = this.values.find(
      (candidate) => candidate.id === credentialId,
    );
    if (!found || !found.projectIds.includes(projectId))
      throw new Error("denied");
    return { item: found, secret: this.secret };
  }
  async readInternal(credentialId: string) {
    this.reads += 1;
    const found = this.values.find(
      (candidate) =>
        candidate.id === credentialId &&
        candidate.agentAccess === "internal-only",
    );
    if (!found) throw new Error("denied");
    return { item: found, secret: this.secret };
  }
}

test("listing MCP servers does not read password-vault secrets", async () => {
  const vault = new FakeVault([item]);
  const scopedFetch = (async () =>
    new Response(null, { status: 202 })) as typeof fetch;
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([connection]),
    fetch: scopedFetch,
    vault,
  });
  const [runtime] = await source.listForProject("project-1");
  assert.equal(vault.reads, 0);
  assert.ok(runtime?.authProvider && "token" in runtime.authProvider);
  assert.equal(runtime?.fetch, scopedFetch);

  const token = await runtime.authProvider.token();
  assert.equal(token, "secret-token");
  assert.equal(vault.reads, 1);
  assert.equal(runtime.redact?.("error secret-token"), "error ••••");
});

test("custom header tokens are injected without exposing a bearer provider", async () => {
  const headerItem: CredentialVaultItem = {
    ...item,
    apiAuthentication: "header",
    apiHeaderName: "X-API-Key",
  };
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([connection]),
    vault: new FakeVault([headerItem]),
  });
  const [runtime] = await source.listForProject("project-1");
  assert.equal(runtime?.authProvider, undefined);
  assert.deepEqual(await runtime?.requestHeaders?.(), {
    "X-API-Key": "secret-token",
  });
});

test("query tokens are resolved lazily without entering the stored server URL", async () => {
  const queryConnection: McpConnection = {
    ...connection,
    serverUrl: "https://mcp.example.test/mcp",
    authentication: {
      kind: "vault-token",
      credentialIds: [item.id],
      queryParameterName: "key",
    },
  };
  const vault = new FakeVault([item]);
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([queryConnection]),
    vault,
  });
  const [runtime] = await source.listForProject("project-1");
  assert.equal(runtime?.url, "https://mcp.example.test/mcp");
  assert.equal(vault.reads, 0);
  assert.deepEqual(await runtime?.requestQuery?.(), { key: "secret-token" });
  assert.equal(vault.reads, 1);
  assert.equal(runtime?.redact?.("key=secret-token"), "key=••••");
});

test("vault token endpoint must match the MCP server origin", async () => {
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([connection]),
    vault: new FakeVault([{ ...item, endpoint: "https://other.example/mcp" }]),
  });
  const [runtime] = await source.listForProject("project-1");
  assert.ok(runtime?.authProvider && "token" in runtime.authProvider);
  await assert.rejects(runtime.authProvider.token(), /不同源/u);
});

test("multiple custom header tokens are resolved lazily and injected together", async () => {
  const secondItem: CredentialVaultItem = {
    ...item,
    id: "credential-bbbbbbbbbbbbbbbb",
    label: "Tenant token",
    apiAuthentication: "header",
    apiHeaderName: "X-Tenant-Key",
  };
  const firstItem: CredentialVaultItem = {
    ...item,
    apiAuthentication: "header",
    apiHeaderName: "X-API-Key",
  };
  const headerConnection: McpConnection = {
    ...connection,
    authentication: {
      kind: "vault-token",
      credentialIds: [firstItem.id, secondItem.id],
    },
  };
  const vault = new FakeVault([firstItem, secondItem]);
  vault.readInternal = async (credentialId: string) => {
    vault.reads += 1;
    const found = vault.values.find(
      (candidate) => candidate.id === credentialId,
    );
    if (!found) throw new Error("denied");
    return {
      item: found,
      secret: {
        kind: "api-token",
        token:
          credentialId === firstItem.id ? "primary-secret" : "tenant-secret",
      },
    };
  };
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([headerConnection]),
    vault,
  });

  const [runtime] = await source.listForProject("project-1");
  assert.equal(vault.reads, 0);
  assert.deepEqual(await runtime?.requestHeaders?.(), {
    "X-API-Key": "primary-secret",
    "X-Tenant-Key": "tenant-secret",
  });
  assert.equal(vault.reads, 2);
  assert.equal(runtime?.redact?.("primary-secret tenant-secret"), "•••• ••••");
});

test("global MCP connections are available from every project runtime", async () => {
  const source = new ProjectMcpServerSource({
    connections: new FakeConnections([connection]),
    vault: new FakeVault([item]),
  });
  assert.equal((await source.listForProject("project-1")).length, 1);
  assert.equal((await source.listForProject("project-2")).length, 1);
});
