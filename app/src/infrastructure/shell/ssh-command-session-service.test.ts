import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  CredentialSecret,
  CredentialVaultItem,
  CredentialVaultPort,
} from "../../application/ports/credential-vault.ts";
import type { Project } from "../../domain/models.ts";
import { SshConnectionTestError } from "../../application/ports/ssh-command-sessions.ts";
import {
  SshCommandProfileVault,
  type PersistedSshCommandProfile,
  type SecureStringStore,
} from "./ssh-command-credential-vault.ts";
import {
  SshCommandSessionManager,
  type NativeSshCommandClient,
} from "./ssh-command-session-service.ts";

class MemorySecureStore implements SecureStringStore {
  readonly values = new Map<string, string>();

  async isAvailable() {
    return true;
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.values.delete(key);
  }
}

const project: Project = {
  id: "launch",
  name: "Launch",
  symbol: "L",
  description: "Fixture",
  instructions: "Read only what is needed.",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 0,
  resourceCount: 0,
};
const hostKey = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:fixture",
};
const credentialId = "credential-01234567-89ab-4def-8123-456789abcdef";

class FixtureCredentialVault implements CredentialVaultPort {
  readonly item: CredentialVaultItem;

  constructor(readonly secret: CredentialSecret) {
    this.item = {
      id: credentialId,
      label: "Production SSH",
      kind: secret.kind,
      ...(secret.kind === "ssh"
        ? { sshAuthentication: secret.authentication }
        : {}),
      projectIds: [project.id],
      source: "manual",
      createdAt: "2026-08-04T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:00.000Z",
    };
  }

  async list() {
    return [this.item];
  }

  async create(): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }

  async update(): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }

  async remove() {}

  async readForProject(candidateId: string, projectId: string) {
    if (candidateId !== credentialId || projectId !== project.id) {
      throw new Error("credential is not granted");
    }
    return { item: this.item, secret: this.secret };
  }
}

function passwordCredentialVault() {
  return new FixtureCredentialVault({
    kind: "ssh",
    authentication: "password",
    password: "fixture-password",
  });
}

function profileId(projectId: string, alias: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify([projectId, alias]))
    .digest("hex");
  return Promise.resolve(`ssh-${digest.slice(0, 16)}`);
}

async function savedProfile(): Promise<PersistedSshCommandProfile> {
  return {
    version: 3,
    profileId: await profileId(project.id, "production"),
    credentialId,
    projectId: project.id,
    alias: "production",
    host: "server.internal",
    port: 22,
    username: "deploy",
    root: "/srv/project",
    expectedHostKey: hostKey,
  };
}

function createNative(
  overrides: Partial<NativeSshCommandClient> = {},
): NativeSshCommandClient {
  return {
    isAvailable: true,
    async probeHostKey() {
      return hostKey;
    },
    async connectWithPassword() {
      return hostKey;
    },
    async connectWithKey() {
      throw new Error("unexpected key authentication");
    },
    async resolveLoginDirectory() {
      return "/home/deploy";
    },
    async disconnect() {},
    async disconnectAll() {},
    ...overrides,
  };
}

test("an unsaved SSH connection test authenticates, resolves pwd, and disconnects", async () => {
  const events: string[] = [];
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const service = new SshCommandSessionManager({
    native: createNative({
      async connectWithPassword(input) {
        events.push(`connect:${input.sessionId}`);
        assert.equal(input.password, "draft-password");
        return hostKey;
      },
      async resolveLoginDirectory(sessionId) {
        events.push(`pwd:${sessionId}`);
        return "/home/deploy";
      },
      async disconnect(sessionId) {
        events.push(`disconnect:${sessionId}`);
      },
    }),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-test-draft",
    profileId,
  });

  const result = await service.testConnection({
    host: "server.internal",
    port: 22,
    username: " deploy ",
    expectedHostKey: hostKey,
    credentials: { kind: "password", password: "draft-password" },
  });

  assert.deepEqual(result, {
    account: "deploy@server.internal:22",
    root: "/home/deploy",
    verification: "ssh-ed25519 SHA256:fixture",
  });
  assert.deepEqual(events, [
    "connect:session-test-draft",
    "pwd:session-test-draft",
    "disconnect:session-test-draft",
  ]);
  assert.deepEqual(service.activeForProject(project.id), []);
  assert.deepEqual(await profileVault.list(), []);
  assert.doesNotMatch(JSON.stringify(result), /draft-password/u);
});

test("a saved SSH connection test resolves its secret through project authorization", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const disconnected: string[] = [];
  const service = new SshCommandSessionManager({
    native: createNative({
      async connectWithPassword(input) {
        assert.equal(input.password, "fixture-password");
        return hostKey;
      },
      async disconnect(sessionId) {
        disconnected.push(sessionId);
      },
    }),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-test-saved",
    profileId,
  });

  await service.testConnection({
    host: "server.internal",
    port: 22,
    username: "deploy",
    expectedHostKey: hostKey,
    credentialId,
    projectId: project.id,
  });

  assert.deepEqual(disconnected, ["session-test-saved"]);
  assert.deepEqual(await profileVault.list(), []);
});

test("connection tests replace native call stacks with a stable failure code", async () => {
  const disconnected: string[] = [];
  const service = new SshCommandSessionManager({
    native: createNative({
      async connectWithPassword() {
        throw new Error(
          "FunctionCallException: connectWithPassword failed with fixture-password; SSH authentication failed at BoltPocketSshModule.swift:274",
        );
      },
      async disconnect(sessionId) {
        disconnected.push(sessionId);
      },
    }),
    profileVault: new SshCommandProfileVault(new MemorySecureStore()),
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-test-error",
    profileId,
  });

  await assert.rejects(
    service.testConnection({
      host: "server.internal",
      port: 22,
      username: "deploy",
      expectedHostKey: hostKey,
      credentials: { kind: "password", password: "fixture-password" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SshConnectionTestError);
      assert.equal(error.code, "authentication_failed");
      assert.doesNotMatch(
        error.message,
        /FunctionCallException|fixture-password|\.swift/u,
      );
      return true;
    },
  );
  assert.deepEqual(disconnected, ["session-test-error"]);
});

test("saved SSH profiles re-probe host identity before authentication", async () => {
  const events: string[] = [];
  const disconnected: string[] = [];
  let currentHostKey = hostKey;
  const native = createNative({
    async probeHostKey() {
      events.push("probe");
      return currentHostKey;
    },
    async connectWithPassword(input) {
      events.push("connect");
      assert.equal(input.password, "fixture-password");
      return hostKey;
    },
    async disconnect(sessionId) {
      disconnected.push(sessionId);
    },
  });
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  await profileVault.save(await savedProfile());
  let sequence = 0;
  const service = new SshCommandSessionManager({
    native,
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => `session-${++sequence}`,
    profileId,
  });

  const [connected] = await service.load([project]);
  assert.deepEqual(events, ["probe", "connect"]);
  assert.equal(connected?.alias, "production");
  assert.equal(service.activeForProject(project.id).length, 1);

  currentHostKey = { ...hostKey, fingerprint: "SHA256:changed" };
  events.length = 0;
  assert.deepEqual(await service.load([project]), []);
  assert.deepEqual(events, ["probe"]);
  assert.deepEqual(disconnected, ["session-1"]);

  currentHostKey = hostKey;
  events.length = 0;
  assert.deepEqual(await service.load([project]), []);
  assert.deepEqual(events, []);
});

test("explicit configuration creates a project-only command alias", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  let sequence = 0;
  const service = new SshCommandSessionManager({
    native: createNative(),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => `session-${++sequence}`,
    profileId,
  });

  const connected = await service.connect(project, {
    alias: " Production ",
    host: "server.internal",
    port: 22,
    username: "deploy",
    root: "/srv/project/./docs/..",
    expectedHostKey: hostKey,
    credentialId,
    persistProfile: true,
  });

  assert.equal(connected.alias, "production");
  assert.equal(connected.root, "/srv/project");
  assert.equal(service.activeForProject(project.id)[0]?.sessionId, "session-1");
  assert.deepEqual(service.activeForProject("another-project"), []);
  assert.equal((await profileVault.list())[0]?.alias, "production");
});

test("credentials without a directory use the authenticated login directory", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const resolvedSessions: string[] = [];
  const service = new SshCommandSessionManager({
    native: createNative({
      async resolveLoginDirectory(sessionId) {
        resolvedSessions.push(sessionId);
        return "/home/deploy";
      },
    }),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-home",
    profileId,
  });

  const connected = await service.connect(project, {
    alias: "production",
    host: "server.internal",
    port: 22,
    username: "deploy",
    expectedHostKey: hostKey,
    credentialId,
    persistProfile: true,
  });

  assert.deepEqual(resolvedSessions, ["session-home"]);
  assert.equal(connected.root, "/home/deploy");
  assert.equal((await profileVault.list())[0]?.root, "/home/deploy");
});

test("an invalid login directory closes the new SSH session", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const disconnected: string[] = [];
  const service = new SshCommandSessionManager({
    native: createNative({
      async resolveLoginDirectory() {
        return "/home/deploy/..";
      },
      async disconnect(sessionId) {
        disconnected.push(sessionId);
      },
    }),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-invalid-home",
    profileId,
  });

  await assert.rejects(
    service.connect(project, {
      alias: "production",
      host: "server.internal",
      port: 22,
      username: "deploy",
      expectedHostKey: hostKey,
      credentialId,
      persistProfile: true,
    }),
    /无法确定 SSH 登录目录/u,
  );
  assert.deepEqual(disconnected, ["session-invalid-home"]);
  assert.deepEqual(await profileVault.list(), []);
});

test("a private key is resolved from the shared vault without entering the SSH profile", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const credentialVault = new FixtureCredentialVault({
    kind: "ssh",
    authentication: "private-key",
    privateKey: "PRIVATE-KEY-FIXTURE",
    publicKey: "PUBLIC-KEY-FIXTURE",
    passphrase: "PASSPHRASE-FIXTURE",
  });
  let keyConnections = 0;
  const service = new SshCommandSessionManager({
    native: createNative({
      async connectWithPassword() {
        throw new Error("unexpected password authentication");
      },
      async connectWithKey(input) {
        keyConnections += 1;
        assert.equal(input.privateKey, "PRIVATE-KEY-FIXTURE");
        assert.equal(input.publicKey, "PUBLIC-KEY-FIXTURE");
        assert.equal(input.passphrase, "PASSPHRASE-FIXTURE");
        return hostKey;
      },
    }),
    profileVault,
    credentialVault,
    createSessionId: () => "session-key",
    profileId,
  });

  await service.connect(project, {
    alias: "production",
    host: "server.internal",
    port: 22,
    username: "deploy",
    root: "/srv/project",
    expectedHostKey: hostKey,
    credentialId,
    persistProfile: true,
  });

  assert.equal(keyConnections, 1);
  assert.equal((await profileVault.list())[0]?.credentialId, credentialId);
});

test("revoking a credential disconnects its active SSH profile", async () => {
  const profileVault = new SshCommandProfileVault(new MemorySecureStore());
  const disconnected: string[] = [];
  const service = new SshCommandSessionManager({
    native: createNative({
      async disconnect(sessionId) {
        disconnected.push(sessionId);
      },
    }),
    profileVault,
    credentialVault: passwordCredentialVault(),
    createSessionId: () => "session-revoked",
    profileId,
  });
  await service.connect(project, {
    alias: "production",
    host: "server.internal",
    port: 22,
    username: "deploy",
    root: "/srv/project",
    expectedHostKey: hostKey,
    credentialId,
    persistProfile: true,
  });

  await service.invalidateCredential(credentialId, true);

  assert.deepEqual(disconnected, ["session-revoked"]);
  assert.deepEqual(service.activeForProject(project.id), []);
  assert.deepEqual(await profileVault.list(), []);
});
