import assert from "node:assert/strict";
import test from "node:test";

import type {
  CredentialSecret,
  CredentialVaultItem,
  CredentialVaultPort,
} from "../../application/ports/credential-vault.ts";
import { CredentialAccessBroker } from "./credential-access-broker.ts";

const item: CredentialVaultItem = {
  id: "credential-01234567-89ab-4def-8123-456789abcdef",
  label: "Production password",
  kind: "password",
  projectIds: ["launch"],
  source: "manual",
  createdAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T12:00:00.000Z",
};

class FixtureVault implements CredentialVaultPort {
  items = [item];
  secret: CredentialSecret = {
    kind: "password",
    password: "PASSWORD-FIXTURE",
  };

  async list() {
    return this.items;
  }

  async create(): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }

  async update(): Promise<CredentialVaultItem> {
    throw new Error("not used");
  }

  async remove() {}

  async readForProject(credentialId: string, projectId: string) {
    const match = this.items.find(
      (candidate) =>
        candidate.id === credentialId &&
        candidate.projectIds.includes(projectId),
    );
    if (!match) throw new Error("grant revoked");
    return { item: match, secret: this.secret };
  }
}

function requestInput() {
  return {
    credentialId: item.id,
    projectId: "launch",
    projectName: "BoltPocket",
    conversationId: "conversation-launch",
    purpose: "Authenticate to the approved read-only project service",
  };
}

async function waitForPending() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("the broker reveals a secret only after an explicit one-time approval", async () => {
  const broker = new CredentialAccessBroker(
    new FixtureVault(),
    () => "request-one",
    () => new Date("2026-08-04T12:00:00.000Z"),
  );
  const observed: (string | null)[] = [];
  broker.subscribe((pending) => observed.push(pending?.requestId ?? null));

  const resultPromise = broker.requestAccess(requestInput());
  await waitForPending();
  assert.equal(broker.pending()?.requestId, "request-one");
  assert.deepEqual(observed, [null, "request-one"]);

  broker.approve("request-one");
  assert.deepEqual(await resultPromise, {
    approved: true,
    item,
    secret: { kind: "password", password: "PASSWORD-FIXTURE" },
  });
  assert.equal(broker.pending(), null);
});

test("denial and task cancellation never read the secret", async () => {
  const vault = new FixtureVault();
  let reads = 0;
  const originalRead = vault.readForProject.bind(vault);
  vault.readForProject = async (...args) => {
    reads += 1;
    return originalRead(...args);
  };
  let requestSequence = 0;
  const broker = new CredentialAccessBroker(
    vault,
    () => `request-${(requestSequence += 1)}`,
  );

  const denied = broker.requestAccess(requestInput());
  await waitForPending();
  broker.deny("request-1");
  assert.deepEqual(await denied, { approved: false });

  const controller = new AbortController();
  const aborted = broker.requestAccess(requestInput(), controller.signal);
  await waitForPending();
  controller.abort();
  assert.deepEqual(await aborted, { approved: false });
  assert.equal(reads, 0);
});

test("revocation is checked again after the user approves", async () => {
  const vault = new FixtureVault();
  const broker = new CredentialAccessBroker(vault, () => "request-race");
  const pending = broker.requestAccess(requestInput());
  await waitForPending();
  vault.items = [];
  broker.approve("request-race");

  await assert.rejects(pending, /grant revoked/u);
});

test("cancellation while authorization metadata loads never queues a request", async () => {
  const vault = new FixtureVault();
  let releaseList: () => void = () => undefined;
  const listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  vault.list = async () => {
    await listGate;
    return vault.items;
  };
  const broker = new CredentialAccessBroker(vault, () => "request-late");
  const controller = new AbortController();
  const result = broker.requestAccess(requestInput(), controller.signal);

  await waitForPending();
  controller.abort();
  releaseList();

  assert.deepEqual(await result, { approved: false });
  assert.equal(broker.pending(), null);
});

test("SSH credentials can never enter the manual secret-reading queue", async () => {
  const vault = new FixtureVault();
  vault.items = [
    {
      ...item,
      kind: "ssh",
      endpoint: "ssh://raspi.local:22/home/pi",
      username: "pi",
      sshAuthentication: "password",
      sshHostKey: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:fixture-host-key",
      },
    },
  ];
  vault.secret = {
    kind: "ssh",
    authentication: "password",
    password: "SSH-PASSWORD-FIXTURE",
  };
  let reads = 0;
  const originalRead = vault.readForProject.bind(vault);
  vault.readForProject = async (...args) => {
    reads += 1;
    return originalRead(...args);
  };
  const broker = new CredentialAccessBroker(vault, () => "request-ssh");

  await assert.rejects(
    () => broker.requestAccess(requestInput()),
    /SSH 凭据不能读取明文/u,
  );
  assert.equal(broker.pending(), null);
  assert.equal(reads, 0);
});

test("internal-only credentials are invisible to the agent access broker", async () => {
  const vault = new FixtureVault();
  vault.items = [{ ...item, agentAccess: "internal-only" }];
  let reads = 0;
  const originalRead = vault.readForProject.bind(vault);
  vault.readForProject = async (...args) => {
    reads += 1;
    return originalRead(...args);
  };
  const broker = new CredentialAccessBroker(vault, () => "request-internal");

  assert.deepEqual(await broker.listAuthorized("launch"), []);
  await assert.rejects(
    () => broker.requestAccess(requestInput()),
    /没有这条密码本记录的授权/u,
  );
  assert.equal(broker.pending(), null);
  assert.equal(reads, 0);
});
