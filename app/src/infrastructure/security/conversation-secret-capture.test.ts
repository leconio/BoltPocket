import assert from "node:assert/strict";
import test from "node:test";

import { captureConversationSecrets } from "./conversation-secret-capture.ts";

test("an explicit password is captured and removed before chat persistence", () => {
  const value = "login password: CorrectHorseBatteryStaple; then inspect logs";
  const result = captureConversationSecrets(value);

  assert.equal(result.captures.length, 1);
  assert.equal(result.captures[0]?.kind, "password");
  assert.deepEqual(result.captures[0]?.secret, {
    kind: "password",
    password: "CorrectHorseBatteryStaple",
  });
  assert.doesNotMatch(result.redactedContent, /CorrectHorseBatteryStaple/u);
  assert.match(result.redactedContent, /已安全保存到密码本/u);
  assert.match(result.redactedContent, /then inspect logs/u);
});

test("full-width punctuation from a Chinese iOS keyboard is captured", () => {
  const result = captureConversationSecrets("password：autocapture-fixture-42");

  assert.equal(result.captures[0]?.kind, "password");
  assert.deepEqual(result.captures[0]?.secret, {
    kind: "password",
    password: "autocapture-fixture-42",
  });
  assert.doesNotMatch(result.redactedContent, /autocapture-fixture-42/u);
  assert.match(result.redactedContent, /已安全保存到密码本/u);
});

test("product-owned capture labels follow the selected app language", () => {
  const result = captureConversationSecrets(
    "password: locale-aware-secret-fixture",
    "en",
  );

  assert.equal(result.captures[0]?.label, "Password from conversation");
  assert.equal(
    result.redactedContent,
    "password: [Saved securely to the password book: Password from conversation · ••••]",
  );
  assert.doesNotMatch(result.redactedContent, /[\u3400-\u9fff]/u);
});

test("a pasted SSH private key is captured as one secret", () => {
  const privateKeyType = ["OPENSSH", "PRIVATE", "KEY"].join(" ");
  const privateKey = [
    `-----BEGIN ${privateKeyType}-----`,
    "b3BlbnNzaC1rZXktdjEAAAAAfixture",
    `-----END ${privateKeyType}-----`,
  ].join("\n");
  const result = captureConversationSecrets(`请使用这个私钥：\n${privateKey}`);

  assert.deepEqual(result.captures, [
    {
      label: "对话中的 SSH 私钥",
      kind: "ssh",
      secret: {
        kind: "ssh",
        authentication: "private-key",
        privateKey,
      },
    },
  ]);
  assert.doesNotMatch(result.redactedContent, /OPENSSH PRIVATE KEY/u);
});

test("one private-key passphrase is attached to the key instead of saved separately", () => {
  const privateKeyType = ["OPENSSH", "PRIVATE", "KEY"].join(" ");
  const privateKey = [
    `-----BEGIN ${privateKeyType}-----`,
    "b3BlbnNzaC1rZXktdjEAAAAAfixture",
    `-----END ${privateKeyType}-----`,
  ].join("\n");
  const result = captureConversationSecrets(
    `${privateKey}\n私钥口令：key-passphrase-fixture`,
  );

  assert.deepEqual(result.captures, [
    {
      label: "对话中的 SSH 私钥",
      kind: "ssh",
      secret: {
        kind: "ssh",
        authentication: "private-key",
        privateKey,
        passphrase: "key-passphrase-fixture",
      },
    },
  ]);
  assert.doesNotMatch(result.redactedContent, /key-passphrase-fixture/u);
});

test("known token prefixes are captured even without a label", () => {
  const token = ["g", "hp_0123456789abcdefghijklmnopqrstuv"].join("");
  const result = captureConversationSecrets(`用 ${token} 读取仓库`);

  assert.equal(result.captures[0]?.kind, "api-token");
  assert.doesNotMatch(result.redactedContent, new RegExp(token, "u"));
});

test("ordinary discussion of passwords and token budgets is not captured", () => {
  const result = captureConversationSecrets(
    "请评估 password manager，并把 token: 8192 作为上下文预算。",
  );

  assert.deepEqual(result, {
    redactedContent:
      "请评估 password manager，并把 token: 8192 作为上下文预算。",
    captures: [],
  });
});
