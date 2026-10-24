import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialVault,
  CredentialVaultStorageError,
  type CredentialSecureStringStore,
} from "./credential-vault.ts";

class MemorySecureStore implements CredentialSecureStringStore {
  readonly values = new Map<string, string>();
  failSetKey?: string;

  async isAvailable() {
    return true;
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    if (key === this.failSetKey) throw new Error("secure write failed");
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.values.delete(key);
  }
}

const credentialId = "credential-01234567-89ab-4def-8123-456789abcdef";
const indexKey = "boltpocket.credential-vault.index.v2";
const recordKey = `boltpocket.credential-vault.item.v2.${credentialId}`;

function createVault(store = new MemorySecureStore()) {
  return {
    store,
    vault: new CredentialVault(
      store,
      () => credentialId,
      () => new Date("2026-08-04T12:00:00.000Z"),
    ),
  };
}

test("credential metadata and secret round-trip through separate secure records", async () => {
  const { store, vault } = createVault();
  const item = await vault.create({
    label: "Production SSH",
    kind: "ssh",
    username: "deploy",
    sshAuthentication: "private-key",
    projectIds: ["launch"],
    source: "manual",
    secret: {
      kind: "ssh",
      authentication: "private-key",
      privateKey: "PRIVATE-KEY-FIXTURE",
      passphrase: "PASSPHRASE-FIXTURE",
    },
  });

  assert.equal(item.id, credentialId);
  assert.doesNotMatch(store.values.get(indexKey) ?? "", /PRIVATE-KEY-FIXTURE/u);
  assert.doesNotMatch(store.values.get(indexKey) ?? "", /PASSPHRASE-FIXTURE/u);
  assert.match(store.values.get(recordKey) ?? "", /PRIVATE-KEY-FIXTURE/u);
  assert.deepEqual(await vault.list(), [item]);
  assert.deepEqual(await vault.readForProject(credentialId, "launch"), {
    item,
    secret: {
      kind: "ssh",
      authentication: "private-key",
      privateKey: "PRIVATE-KEY-FIXTURE",
      passphrase: "PASSPHRASE-FIXTURE",
    },
  });
  await assert.rejects(
    vault.readForProject(credentialId, "another-project"),
    /没有这条密码本记录的授权/u,
  );
  await assert.rejects(vault.readInternal(credentialId), /不允许内部服务/u);
});

test("SSH host-key metadata survives a secure-store JSON round-trip", async () => {
  const { vault } = createVault();
  const item = await vault.create({
    label: "Pinned SSH",
    kind: "ssh",
    username: "deploy",
    endpoint: "server.example.com:22",
    sshAuthentication: "password",
    sshHostKey: {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:fixture-host-key",
    },
    projectIds: ["launch"],
    source: "manual",
    secret: {
      kind: "ssh",
      authentication: "password",
      password: "PASSWORD-FIXTURE",
    },
  });

  assert.deepEqual(await vault.list(), [item]);
  assert.deepEqual(
    (await vault.readForProject(item.id, "launch")).item.sshHostKey,
    item.sshHostKey,
  );
});

test("project grants can be revoked without reading or rewriting the secret", async () => {
  const { store, vault } = createVault();
  const item = await vault.create({
    label: "Service password",
    kind: "password",
    projectIds: ["launch", "research"],
    source: "conversation",
    secret: { kind: "password", password: "PASSWORD-FIXTURE" },
  });
  const originalRecord = store.values.get(recordKey);

  const updated = await vault.update(item.id, {
    label: item.label,
    kind: item.kind,
    projectIds: ["research"],
  });

  assert.deepEqual(updated.projectIds, ["research"]);
  assert.equal(store.values.get(recordKey), originalRecord);
  await assert.rejects(
    vault.readForProject(item.id, "launch"),
    CredentialVaultStorageError,
  );
  assert.deepEqual((await vault.readForProject(item.id, "research")).secret, {
    kind: "password",
    password: "PASSWORD-FIXTURE",
  });
});

test("internal-only access policy round-trips without exposing the secret in metadata", async () => {
  const { store, vault } = createVault();
  const item = await vault.create({
    label: "MCP token",
    kind: "api-token",
    service: "Example MCP",
    endpoint: "https://mcp.example.com/mcp",
    apiAuthentication: "bearer",
    agentAccess: "internal-only",
    projectIds: [],
    source: "manual",
    secret: { kind: "api-token", token: "MCP-TOKEN-FIXTURE" },
  });

  assert.equal(item.agentAccess, "internal-only");
  assert.doesNotMatch(store.values.get(indexKey) ?? "", /MCP-TOKEN-FIXTURE/u);
  assert.equal((await vault.list())[0]?.agentAccess, "internal-only");

  const updated = await vault.update(item.id, {
    label: "Renamed MCP token",
    kind: "api-token",
    service: item.service,
    endpoint: item.endpoint,
    apiAuthentication: item.apiAuthentication,
    agentAccess: item.agentAccess,
    projectIds: item.projectIds,
  });
  assert.equal(updated.agentAccess, "internal-only");
  assert.deepEqual((await vault.readInternal(item.id)).secret, {
    kind: "api-token",
    token: "MCP-TOKEN-FIXTURE",
  });
  await assert.rejects(
    vault.readForProject(item.id, "launch"),
    CredentialVaultStorageError,
  );
});

test("a failed index update restores the previous secret record", async () => {
  const { store, vault } = createVault();
  const item = await vault.create({
    label: "API token",
    kind: "api-token",
    service: "Example API",
    endpoint: "https://api.example.com",
    apiAuthentication: "header",
    apiHeaderName: "X-API-Key",
    projectIds: ["launch"],
    source: "manual",
    secret: { kind: "api-token", token: "TOKEN-ORIGINAL-FIXTURE" },
  });
  store.failSetKey = indexKey;

  await assert.rejects(
    vault.update(item.id, {
      label: "Changed",
      kind: "api-token",
      service: "Example API",
      endpoint: "https://api.example.com",
      apiAuthentication: "header",
      apiHeaderName: "X-API-Key",
      projectIds: ["launch"],
      secret: { kind: "api-token", token: "TOKEN-REPLACEMENT-FIXTURE" },
    }),
    /更新失败/u,
  );
  store.failSetKey = undefined;

  assert.deepEqual((await vault.readForProject(item.id, "launch")).secret, {
    kind: "api-token",
    token: "TOKEN-ORIGINAL-FIXTURE",
  });
  assert.equal((await vault.list())[0]?.label, "API token");
});

test("deleting a credential removes both metadata and secret", async () => {
  const { store, vault } = createVault();
  const item = await vault.create({
    label: "Disposable",
    kind: "secret-text",
    projectIds: [],
    source: "manual",
    secret: { kind: "secret-text", value: "DISPOSABLE-FIXTURE" },
  });

  await vault.remove(item.id);

  assert.deepEqual(await vault.list(), []);
  assert.equal(store.values.has(recordKey), false);
});

test("credential kinds and SSH authentication fields cannot drift apart", async () => {
  const { vault } = createVault();
  await assert.rejects(
    vault.create({
      label: "Mismatched SSH",
      kind: "ssh",
      sshAuthentication: "private-key",
      projectIds: ["launch"],
      source: "manual",
      secret: {
        kind: "ssh",
        authentication: "password",
        password: "fixture-password",
      },
    }),
    /认证方式与秘密内容不匹配/u,
  );

  const item = await vault.create({
    label: "SSH password",
    kind: "ssh",
    sshAuthentication: "password",
    projectIds: ["launch"],
    source: "manual",
    secret: {
      kind: "ssh",
      authentication: "password",
      password: "fixture-password",
    },
  });
  await assert.rejects(
    vault.update(item.id, {
      label: item.label,
      kind: "ssh",
      sshAuthentication: "private-key",
      projectIds: item.projectIds,
    }),
    /必须填写新内容/u,
  );
});
