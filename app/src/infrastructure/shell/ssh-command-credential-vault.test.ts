import assert from "node:assert/strict";
import test from "node:test";

import {
  SshCommandProfileStorageError,
  SshCommandProfileVault,
  type PersistedSshCommandProfile,
  type SecureStringStore,
} from "./ssh-command-credential-vault.ts";

class MemorySecureStore implements SecureStringStore {
  readonly values = new Map<string, string>();
  failKey?: string;

  async isAvailable() {
    return true;
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    if (key === this.failKey) throw new Error("secure write failed");
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.values.delete(key);
  }
}

const profile: PersistedSshCommandProfile = {
  version: 3,
  profileId: "ssh-0123456789abcdef",
  credentialId: "credential-01234567-89ab-4def-8123-456789abcdef",
  projectId: "launch",
  alias: "production",
  host: "server.internal",
  port: 22,
  username: "deploy",
  root: "/srv/project",
  expectedHostKey: {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:fixture",
  },
};

test("SSH command profiles store only an opaque credential reference", async () => {
  const store = new MemorySecureStore();
  const vault = new SshCommandProfileVault(store);
  await vault.save(profile);

  assert.deepEqual(await vault.list(), [profile]);
  assert.doesNotMatch(
    JSON.stringify([...store.values.values()]),
    /fixture-password|PRIVATE KEY/u,
  );
  assert.ok(
    [...store.values.keys()].every((key) =>
      key.startsWith("boltpocket.ssh.command-profile"),
    ),
  );

  await vault.remove(profile.profileId);
  assert.deepEqual(await vault.list(), []);
});

test("invalid aliases, paths, and profile IDs fail closed", async () => {
  const vault = new SshCommandProfileVault(new MemorySecureStore());
  await assert.rejects(
    vault.save({ ...profile, alias: "Production Host" }),
    SshCommandProfileStorageError,
  );
  await assert.rejects(
    vault.save({ ...profile, root: "relative/path" }),
    SshCommandProfileStorageError,
  );
  await assert.rejects(
    vault.save({ ...profile, profileId: "ssh-invalid" }),
    SshCommandProfileStorageError,
  );
});

test("a failed profile write restores the profile index", async () => {
  const store = new MemorySecureStore();
  const vault = new SshCommandProfileVault(store);
  store.failKey = `boltpocket.ssh.command-profile.v3.${profile.profileId}`;

  await assert.rejects(vault.save(profile), SshCommandProfileStorageError);
  store.failKey = undefined;
  assert.deepEqual(await vault.list(), []);
});
