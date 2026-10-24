import assert from "node:assert/strict";
import test from "node:test";

import type { CredentialVaultItem } from "@/application/ports/credential-vault";

import {
  formatSshCredentialEndpoint,
  parseSshCredentialEndpoint,
  sshAliasForCredential,
  sshConnectionInputFromCredential,
} from "./ssh-credential-endpoint.ts";

const item: CredentialVaultItem = {
  id: "credential-1234567890abcdef",
  label: "Raspberry Pi",
  kind: "ssh",
  endpoint: "ssh://raspi.local:2222/home/pi/project",
  username: "pi",
  sshAuthentication: "private-key",
  sshHostKey: { algorithm: "ssh-ed25519", fingerprint: "SHA256:test" },
  projectIds: ["project-one"],
  source: "manual",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

test("SSH credential endpoints accept simple host and port fields", () => {
  assert.equal(
    formatSshCredentialEndpoint("raspi.local", "2222"),
    "ssh://raspi.local:2222",
  );
  assert.deepEqual(parseSshCredentialEndpoint("ssh://raspi.local:2222"), {
    host: "raspi.local",
    port: 2222,
  });
  assert.deepEqual(parseSshCredentialEndpoint("ssh://raspi.local/"), {
    host: "raspi.local",
    port: 22,
  });
  assert.equal(
    formatSshCredentialEndpoint("2001:db8::1", 22),
    "ssh://[2001:db8::1]:22",
  );
  assert.deepEqual(parseSshCredentialEndpoint("ssh://[2001:db8::1]:22"), {
    host: "2001:db8::1",
    port: 22,
  });
  assert.throws(() => formatSshCredentialEndpoint("raspi.local", "0"));
  assert.throws(() => formatSshCredentialEndpoint("ssh://raspi.local", 22));
  assert.throws(() => formatSshCredentialEndpoint("raspi.local/path", 22));
});

test("legacy SSH credential endpoints retain their remote start directory", () => {
  assert.equal(
    formatSshCredentialEndpoint("raspi.local", 2222, "/home/pi/project"),
    item.endpoint,
  );
  assert.deepEqual(parseSshCredentialEndpoint(item.endpoint!), {
    host: "raspi.local",
    port: 2222,
    root: "/home/pi/project",
  });
  assert.throws(() => parseSshCredentialEndpoint("ssh://pi@raspi.local/"));
  assert.throws(() => parseSshCredentialEndpoint("https://raspi.local/a"));
});

test("an authorized SSH credential becomes an internal connection without exposing its secret", () => {
  const input = sshConnectionInputFromCredential(item);
  assert.equal(input.host, "raspi.local");
  assert.equal(input.username, "pi");
  assert.equal(input.root, "/home/pi/project");
  assert.equal(input.credentialId, item.id);
  assert.equal(input.persistProfile, true);
  assert.equal(input.alias, sshAliasForCredential(item));
  assert.doesNotMatch(JSON.stringify(input), /privateKey|password/u);
});

test("a simple SSH credential defers its directory to connection time", () => {
  const input = sshConnectionInputFromCredential({
    ...item,
    endpoint: "ssh://raspi.local:22",
  });
  assert.equal(input.host, "raspi.local");
  assert.equal(input.port, 22);
  assert.equal("root" in input, false);
});
