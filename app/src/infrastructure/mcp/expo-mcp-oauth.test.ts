import assert from "node:assert/strict";
import test from "node:test";

import { AccountAuthenticationRequiredError } from "@/application/ports/authentication";
import { ExpoMcpOAuth } from "./expo-mcp-oauth.ts";

const AUTHORIZATION_ID = `mcpa_${"a".repeat(43)}`;
const SESSION_TOKEN = `mcps_${"s".repeat(43)}`;
const RECEIPT = "r".repeat(43);
const CHALLENGE = "c".repeat(43);
const VERIFIER = "v".repeat(43);
const SERVER_URL = "https://mcp.example.com/mcp";

test("Mainland MCP OAuth cannot use a global broker session", async () => {
  const values = new Map<string, string>();
  values.set(
    `boltpocket-mcp-oauth-session-v1.${AUTHORIZATION_ID}`,
    JSON.stringify({
      authorizationId: AUTHORIZATION_ID,
      expiresAt: 4_600,
      requiresReauthorization: false,
      serverUrl: SERVER_URL,
      sessionToken: SESSION_TOKEN,
    }),
  );
  const oauth = new ExpoMcpOAuth(
    {
      baseUrl: "https://broker.mainland.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore: memoryStore(values),
      storageNamespace: "china-mainland",
      fetch: (async () => {
        throw new Error("global session must not reach the Mainland broker");
      }) as typeof fetch,
    },
  );

  await assert.rejects(oauth.lease(AUTHORIZATION_ID, SERVER_URL), /已过期/u);
});

test("MCP OAuth preserves a rejected BoltPocket account session for UI recovery", async () => {
  const oauth = new ExpoMcpOAuth(
    {
      baseUrl: "https://broker.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      randomVerifier: async () => VERIFIER,
      sha256Base64Url: async () => CHALLENGE,
      secureStore: memoryStore(new Map()),
      fetch: (async () => {
        throw new AccountAuthenticationRequiredError();
      }) as typeof fetch,
    },
  );

  await assert.rejects(
    oauth.connect(SERVER_URL),
    AccountAuthenticationRequiredError,
  );
});

test("MCP OAuth persists only an opaque broker session and keeps token leases in memory", async () => {
  const values = new Map<string, string>();
  let leaseRequests = 0;
  let startBody: unknown;
  const oauth = new ExpoMcpOAuth(
    {
      baseUrl: "https://broker.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      randomVerifier: async () => VERIFIER,
      sha256Base64Url: async () => CHALLENGE,
      secureStore: memoryStore(values),
      openAuthSession: async () => ({
        type: "success",
        url: callbackUrl(),
      }),
      fetch: (async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/mcp/oauth/start")) {
          startBody = JSON.parse(String(init?.body)) as unknown;
          return jsonResponse({
            authorizationUrl: "https://auth.example.com/authorize",
            expiresAt: 1_300,
            serverUrl: SERVER_URL,
          });
        }
        if (url.endsWith("/v1/mcp/oauth/complete")) {
          return jsonResponse({
            authorization: {
              id: AUTHORIZATION_ID,
              requiresReauthorization: false,
              serverUrl: SERVER_URL,
            },
            expiresAt: 4_600,
            sessionToken: SESSION_TOKEN,
          });
        }
        if (url.endsWith(`/${AUTHORIZATION_ID}/token`)) {
          leaseRequests += 1;
          const body = JSON.parse(String(init?.body)) as {
            forceRefresh: boolean;
          };
          return jsonResponse({
            accessToken: body.forceRefresh
              ? "refreshed-access-token"
              : "initial-access-token",
            authorizationId: AUTHORIZATION_ID,
            leaseExpiresAt: 1_300,
            serverUrl: SERVER_URL,
            sessionExpiresAt: 8_776_000,
            tokenType: "Bearer",
          });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch,
    },
  );

  const authorization = await oauth.connect(SERVER_URL, [
    "repo:write",
    "issues:write",
  ]);
  assert.equal(authorization?.authorizationId, AUTHORIZATION_ID);
  assert.deepEqual(startBody, {
    appChallenge: CHALLENGE,
    scopes: ["issues:write", "repo:write"],
    serverUrl: SERVER_URL,
  });
  assert.equal(
    [...values.values()].some(
      (value) =>
        value.includes("initial-access-token") ||
        value.includes("refreshed-access-token") ||
        value.includes(VERIFIER),
    ),
    false,
  );

  assert.equal(
    (await oauth.lease(AUTHORIZATION_ID, SERVER_URL)).accessToken,
    "initial-access-token",
  );
  assert.equal(
    (await oauth.lease(AUTHORIZATION_ID, SERVER_URL)).accessToken,
    "initial-access-token",
  );
  assert.equal(leaseRequests, 1);
  assert.equal(
    JSON.parse(
      values.get(`boltpocket-mcp-oauth-session-v1.${AUTHORIZATION_ID}`) ?? "{}",
    ).expiresAt,
    8_776_000,
  );

  await oauth.invalidate(AUTHORIZATION_ID);
  assert.equal(
    (await oauth.lease(AUTHORIZATION_ID, SERVER_URL)).accessToken,
    "refreshed-access-token",
  );
  assert.equal(leaseRequests, 2);
  assert.equal(
    [...values.values()].some((value) => value.includes("access-token")),
    false,
  );
});

test("MCP OAuth binds an opaque session and lease to the exact server URL", async () => {
  const values = new Map<string, string>();
  values.set(
    `boltpocket-mcp-oauth-session-v1.${AUTHORIZATION_ID}`,
    JSON.stringify({
      authorizationId: AUTHORIZATION_ID,
      expiresAt: 4_600,
      requiresReauthorization: false,
      serverUrl: SERVER_URL,
      sessionToken: SESSION_TOKEN,
    }),
  );
  const oauth = new ExpoMcpOAuth(
    {
      baseUrl: "https://broker.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore: memoryStore(values),
      fetch: (async () => {
        throw new Error("network must not be reached");
      }) as typeof fetch,
    },
  );

  await assert.rejects(
    oauth.lease(AUTHORIZATION_ID, "https://attacker.example/mcp"),
    /不匹配/u,
  );
});

test("disconnect requires broker deletion before removing the local recovery session", async () => {
  const values = new Map<string, string>();
  const sessionKey = `boltpocket-mcp-oauth-session-v1.${AUTHORIZATION_ID}`;
  values.set(
    sessionKey,
    JSON.stringify({
      authorizationId: AUTHORIZATION_ID,
      expiresAt: 4_600,
      requiresReauthorization: false,
      serverUrl: SERVER_URL,
      sessionToken: SESSION_TOKEN,
    }),
  );
  let authorizationHeader = "";
  const oauth = new ExpoMcpOAuth(
    {
      baseUrl: "https://broker.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore: memoryStore(values),
      fetch: (async (_input, init) => {
        authorizationHeader =
          new Headers(init?.headers).get("authorization") ?? "";
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    },
  );

  await oauth.disconnect(AUTHORIZATION_ID);

  assert.equal(authorizationHeader, `Bearer ${SESSION_TOKEN}`);
  assert.equal(values.has(sessionKey), false);
});

function callbackUrl() {
  return `boltpocket://oauth/mcp/complete?authorization_id=${AUTHORIZATION_ID}&app_challenge=${CHALLENGE}&receipt=${RECEIPT}`;
}

function memoryStore(values: Map<string, string>) {
  return {
    async deleteItemAsync(key: string) {
      values.delete(key);
    },
    async getItemAsync(key: string) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}
