import assert from "node:assert/strict";
import test from "node:test";

import { authorizeMcpOAuthWithAccountRecovery } from "@/application/mcp-oauth-account-recovery";
import { AccountAuthenticationRejectedAfterSignInError } from "@/application/account-authentication-recovery";
import { AccountAuthenticationRequiredError } from "@/application/ports/authentication";
import type { McpOAuthAuthorization } from "@/application/ports/mcp-connections";

const authorization = {
  authorizationId: `mcpa_${"a".repeat(43)}`,
  expiresAt: 4_600,
  requiresReauthorization: false,
  serverUrl: "https://api.githubcopilot.com/mcp/",
} satisfies McpOAuthAuthorization;

const profile = {
  avatarUrl: null,
  displayName: "BoltPocket Tester",
  email: "tester@example.com",
  adminRole: null,
  subject: "subject-1",
  username: "tester",
};

test("MCP OAuth signs in once and retries after account authentication expires", async () => {
  let authorizeCalls = 0;
  let signInCalls = 0;
  const result = await authorizeMcpOAuthWithAccountRecovery({
    async authorize() {
      authorizeCalls += 1;
      if (authorizeCalls === 1) {
        throw new AccountAuthenticationRequiredError();
      }
      return authorization;
    },
    async signIn() {
      signInCalls += 1;
      return profile;
    },
  });

  assert.equal(result, authorization);
  assert.equal(authorizeCalls, 2);
  assert.equal(signInCalls, 1);
});

test("MCP OAuth cancellation stays cancelled without retrying authorization", async () => {
  let authorizeCalls = 0;
  const result = await authorizeMcpOAuthWithAccountRecovery({
    async authorize() {
      authorizeCalls += 1;
      throw new AccountAuthenticationRequiredError();
    },
    async signIn() {
      return null;
    },
  });

  assert.equal(result, null);
  assert.equal(authorizeCalls, 1);
});

test("MCP OAuth does not turn other failures into an account login", async () => {
  let signInCalls = 0;
  await assert.rejects(
    authorizeMcpOAuthWithAccountRecovery({
      async authorize() {
        throw new Error("provider unavailable");
      },
      async signIn() {
        signInCalls += 1;
        return profile;
      },
    }),
    /provider unavailable/u,
  );
  assert.equal(signInCalls, 0);
});

test("MCP OAuth distinguishes a second account rejection without looping", async () => {
  let authorizeCalls = 0;
  await assert.rejects(
    authorizeMcpOAuthWithAccountRecovery({
      async authorize() {
        authorizeCalls += 1;
        throw new AccountAuthenticationRequiredError();
      },
      async signIn() {
        return profile;
      },
    }),
    AccountAuthenticationRejectedAfterSignInError,
  );
  assert.equal(authorizeCalls, 2);
});
