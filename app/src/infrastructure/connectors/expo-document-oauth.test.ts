import assert from "node:assert/strict";
import test from "node:test";

import { ExpoDocumentOAuth } from "./expo-document-oauth.ts";

const CONNECTION_ID = `conn_${"c".repeat(32)}`;
const RECEIPT = "r".repeat(43);
const SESSION_TOKEN = `ihs_${"s".repeat(43)}`;
const VERIFIER = "v".repeat(43);
const VALID_SECURE_STORE_KEY = /^[A-Za-z0-9._-]+$/u;

test("Mainland document OAuth cannot read a global broker session", async () => {
  const values = new Map<string, string>([
    ["boltpocket-document-oauth-index-v1", JSON.stringify([CONNECTION_ID])],
    [
      `boltpocket-document-oauth-session-v1.${CONNECTION_ID}`,
      JSON.stringify({
        accountId: "account-1",
        accountName: "reader@example.com",
        connectionId: CONNECTION_ID,
        expiresAt: 4_600,
        provider: "google",
        sessionToken: SESSION_TOKEN,
      }),
    ],
  ]);
  const readKeys: string[] = [];
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.mainland.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore: {
        async deleteItemAsync(key: string) {
          values.delete(key);
        },
        async getItemAsync(key: string) {
          readKeys.push(key);
          return values.get(key) ?? null;
        },
        async setItemAsync(key: string, value: string) {
          values.set(key, value);
        },
      },
      storageNamespace: "china-mainland",
      fetch: (async () => {
        throw new Error("global session must not reach the Mainland broker");
      }) as typeof fetch,
    },
  );

  assert.deepEqual(await oauth.list(), []);
  assert.deepEqual(readKeys, ["boltpocket-document-oauth-index-v1.china-mainland"]);
});

test("OAuth handoff uses valid SecureStore keys and never persists an access-token lease", async () => {
  const values = new Map<string, string>();
  const touchedKeys: string[] = [];
  const secureStore = {
    async getItemAsync(key: string) {
      assert.match(key, VALID_SECURE_STORE_KEY);
      touchedKeys.push(key);
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      assert.match(key, VALID_SECURE_STORE_KEY);
      touchedKeys.push(key);
      values.set(key, value);
    },
    async deleteItemAsync(key: string) {
      assert.match(key, VALID_SECURE_STORE_KEY);
      touchedKeys.push(key);
      values.delete(key);
    },
  };
  let leaseRequests = 0;
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      randomVerifier: async () => VERIFIER,
      sha256Base64Url: async () => "h".repeat(43),
      secureStore,
      openAuthSession: (async () => ({
        type: "success",
        url: `boltpocket://oauth/complete?provider=google&connection_id=${CONNECTION_ID}&receipt=${RECEIPT}`,
      })) as never,
      fetch: (async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/oauth/google/start")) {
          return new Response(
            JSON.stringify({
              authorizationUrl: "https://accounts.example.com/authorize",
              expiresAt: 1_300,
              provider: "google",
            }),
            { status: 201 },
          );
        }
        if (url.endsWith("/v1/oauth/complete")) {
          return new Response(
            JSON.stringify({
              connection: {
                accountId: "account-1",
                accountName: "reader@example.com",
                id: CONNECTION_ID,
                provider: "google",
              },
              expiresAt: 4_600,
              sessionToken: SESSION_TOKEN,
            }),
          );
        }
        if (url.endsWith(`/v1/connections/${CONNECTION_ID}/token`)) {
          leaseRequests += 1;
          return new Response(
            JSON.stringify({
              accessToken: "provider-access-token",
              connectionId: CONNECTION_ID,
              leaseExpiresAt: 1_300,
              provider: "google",
              tokenType: "Bearer",
            }),
          );
        }
        return new Response("", { status: 404 });
      }) as typeof fetch,
    },
  );

  const connection = await oauth.connect("google");
  assert.equal(connection?.connectionId, CONNECTION_ID);
  assert.ok(
    touchedKeys.includes(`boltpocket-document-oauth-session-v1.${CONNECTION_ID}`),
  );
  assert.equal(
    touchedKeys.some((key) => key.includes(":")),
    false,
  );

  assert.equal(
    (await oauth.lease(CONNECTION_ID)).accessToken,
    "provider-access-token",
  );
  assert.equal(
    (await oauth.lease(CONNECTION_ID)).accessToken,
    "provider-access-token",
  );
  assert.equal(leaseRequests, 1);
  assert.equal(
    [...values.values()].some((value) =>
      value.includes("provider-access-token"),
    ),
    false,
  );
});

test("reauthorizing the same provider account replaces the older broker session", async () => {
  const firstConnectionId = `conn_${"a".repeat(32)}`;
  const secondConnectionId = `conn_${"b".repeat(32)}`;
  const values = new Map<string, string>();
  const secureStore = {
    async getItemAsync(key: string) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      values.set(key, value);
    },
    async deleteItemAsync(key: string) {
      values.delete(key);
    },
  };
  let attempt = 0;
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      randomVerifier: async () => VERIFIER,
      sha256Base64Url: async () => "h".repeat(43),
      secureStore,
      openAuthSession: (async () => {
        const connectionId =
          attempt === 0 ? firstConnectionId : secondConnectionId;
        attempt += 1;
        return {
          type: "success",
          url: `boltpocket://oauth/complete?provider=google&connection_id=${connectionId}&receipt=${RECEIPT}`,
        };
      }) as never,
      fetch: (async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/oauth/google/start")) {
          return new Response(
            JSON.stringify({
              authorizationUrl: "https://accounts.example.com/authorize",
              expiresAt: 1_300,
              provider: "google",
            }),
            { status: 201 },
          );
        }
        if (url.endsWith("/v1/oauth/complete")) {
          const request = JSON.parse(String(init?.body)) as {
            connectionId: string;
          };
          const suffix = request.connectionId === firstConnectionId ? "1" : "2";
          return new Response(
            JSON.stringify({
              connection: {
                accountId: "account-1",
                accountName: "reader@example.com",
                id: request.connectionId,
                provider: "google",
              },
              expiresAt: 4_600,
              sessionToken: `ihs_${suffix.repeat(43)}`,
            }),
          );
        }
        return new Response("", { status: 404 });
      }) as typeof fetch,
    },
  );

  assert.equal(
    (await oauth.connect("google"))?.connectionId,
    firstConnectionId,
  );
  assert.equal(
    (await oauth.connect("google"))?.connectionId,
    secondConnectionId,
  );
  assert.deepEqual(
    (await oauth.list("google")).map((connection) => connection.connectionId),
    [secondConnectionId],
  );
  assert.equal(
    values.has(`boltpocket-document-oauth-session-v1.${firstConnectionId}`),
    false,
  );
});

test("disconnect deletes the broker grant before removing the local recovery session", async () => {
  const values = new Map<string, string>();
  const secureStore = {
    async getItemAsync(key: string) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      values.set(key, value);
    },
    async deleteItemAsync(key: string) {
      values.delete(key);
    },
  };
  values.set("boltpocket-document-oauth-index-v1", JSON.stringify([CONNECTION_ID]));
  values.set(
    `boltpocket-document-oauth-session-v1.${CONNECTION_ID}`,
    JSON.stringify({
      accountId: "account-1",
      accountName: "reader@example.com",
      connectionId: CONNECTION_ID,
      expiresAt: 4_600,
      provider: "google",
      sessionToken: SESSION_TOKEN,
    }),
  );
  let request: {
    authorization: string | undefined;
    method: string | undefined;
  } | null = null;
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore,
      fetch: (async (_input, init) => {
        request = {
          authorization:
            new Headers(init?.headers).get("authorization") ?? undefined,
          method: init?.method,
        };
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    },
  );

  await oauth.disconnect(CONNECTION_ID);

  assert.deepEqual(request, {
    authorization: `Bearer ${SESSION_TOKEN}`,
    method: "DELETE",
  });
  assert.deepEqual(
    JSON.parse(values.get("boltpocket-document-oauth-index-v1") ?? "[]"),
    [],
  );
  assert.equal(
    values.has(`boltpocket-document-oauth-session-v1.${CONNECTION_ID}`),
    false,
  );
});

test("provider invalidation is persisted for offline fail-closed behavior", async () => {
  const values = new Map<string, string>();
  const sessionKey = `boltpocket-document-oauth-session-v1.${CONNECTION_ID}`;
  values.set("boltpocket-document-oauth-index-v1", JSON.stringify([CONNECTION_ID]));
  values.set(
    sessionKey,
    JSON.stringify({
      accountId: "account-1",
      accountName: "reader@example.com",
      connectionId: CONNECTION_ID,
      expiresAt: 4_600,
      provider: "google",
      sessionToken: SESSION_TOKEN,
    }),
  );
  let online = true;
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      now: () => 1_000,
      secureStore: {
        async getItemAsync(key: string) {
          return values.get(key) ?? null;
        },
        async setItemAsync(key: string, value: string) {
          values.set(key, value);
        },
        async deleteItemAsync(key: string) {
          values.delete(key);
        },
      },
      fetch: (async () => {
        if (!online) throw new Error("offline");
        return Response.json({
          connection: {
            accountId: "account-1",
            accountName: "reader@example.com",
            id: CONNECTION_ID,
            provider: "google",
            requiresReauthorization: true,
          },
        });
      }) as typeof fetch,
    },
  );

  assert.equal((await oauth.list())[0]?.requiresReauthorization, true);
  online = false;
  assert.equal((await oauth.list())[0]?.requiresReauthorization, true);
  assert.equal(
    JSON.parse(values.get(sessionKey) ?? "{}").requiresReauthorization,
    true,
  );
});

test("a distribution policy can block cloud document OAuth before any network request", async () => {
  let fetches = 0;
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      assertConnectionPermitted() {
        throw new Error("中国大陆发行版暂不提供云文档连接。");
      },
      fetch: (async () => {
        fetches += 1;
        throw new Error("unexpected fetch");
      }) as typeof fetch,
      secureStore: {
        async getItemAsync() {
          return null;
        },
        async setItemAsync() {},
        async deleteItemAsync() {},
      },
    },
  );

  await assert.rejects(() => oauth.connect("google"), /暂不提供/u);
  await assert.rejects(
    () => oauth.lease("conn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    /暂不提供/u,
  );
  assert.equal(fetches, 0);
});

test("broker requests abort on a bounded timeout", async () => {
  const oauth = new ExpoDocumentOAuth(
    {
      baseUrl: "https://oauth.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      requestTimeoutMs: 5,
      randomVerifier: async () => VERIFIER,
      sha256Base64Url: async () => "h".repeat(43),
      secureStore: {
        async getItemAsync() {
          return null;
        },
        async setItemAsync() {},
        async deleteItemAsync() {},
      },
      fetch: (async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        })) as typeof fetch,
    },
  );

  await assert.rejects(() => oauth.connect("google"), /无法连接文档授权服务/u);
});
