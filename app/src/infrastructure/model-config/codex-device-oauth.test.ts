import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexDeviceOAuth,
  CodexDeviceOAuthError,
} from "./codex-device-oauth.ts";

const NOW = 1_700_000_000_000;
const PROVIDER_ID = "provider-codex";

test("device authorization polls, exchanges, and stores only a local credential", async () => {
  const store = new MemorySecureStore();
  const calls: RecordedRequest[] = [];
  const accessToken = jwt("account-1", NOW + 60 * 60_000);
  const idToken = jwt("account-1", NOW + 60 * 60_000, {
    email: "alice@example.com",
    plan: "plus",
  });
  let pollCount = 0;
  const service = new CodexDeviceOAuth({
    now: () => NOW,
    secureStore: store,
    sleep: async () => undefined,
    fetch: recordFetch(calls, async (url) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: "1",
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        pollCount += 1;
        return pollCount === 1
          ? new Response(null, { status: 403 })
          : jsonResponse({
              authorization_code: "authorization-code-1",
              code_verifier: "code-verifier-1",
            });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: accessToken,
          refresh_token: "refresh-token-1",
          id_token: idToken,
          expires_in: 3_600,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  });

  let deviceCode: string | null = null;
  const result = await service.login(PROVIDER_ID, (information) => {
    deviceCode = information.userCode;
    assert.equal(
      information.verificationUri,
      "https://auth.openai.com/codex/device",
    );
    assert.equal(information.intervalMs, 1_000);
  });

  assert.equal(deviceCode, "ABCD-EFGH");
  assert.deepEqual(result, {
    accountId: "account-1",
    email: "alice@example.com",
    plan: "plus",
    expiresAt: NOW + 60 * 60_000,
  });
  assert.deepEqual(await service.status(PROVIDER_ID), result);
  assert.equal(calls.length, 4);
  assert.match(String(calls[3]?.init?.body), /grant_type=authorization_code/u);
  assert.doesNotMatch(String(calls[0]?.init?.body), /refresh-token/u);
  assert.equal(store.values.size, 1);
  assert.match([...store.values.values()][0] ?? "", /refresh-token-1/u);
});

test("Codex requests refresh once after 401 and never expose the token to another host", async () => {
  const store = new MemorySecureStore();
  const firstAccessToken = jwt("account-1", NOW + 60 * 60_000);
  const secondAccessToken = jwt("account-1", NOW + 2 * 60 * 60_000);
  const idToken = jwt("account-1", NOW + 2 * 60 * 60_000);
  const backendAuthorization: string[] = [];
  const service = new CodexDeviceOAuth({
    now: () => NOW,
    secureStore: store,
    sleep: async () => undefined,
    fetch: (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: 1,
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "authorization-code-1",
          code_verifier: "code-verifier-1",
        });
      }
      if (url.endsWith("/oauth/token")) {
        const body = String(init?.body);
        if (body.includes("refresh_token")) {
          return jsonResponse({
            access_token: secondAccessToken,
            refresh_token: "refresh-token-2",
            id_token: idToken,
          });
        }
        return jsonResponse({
          access_token: firstAccessToken,
          refresh_token: "refresh-token-1",
          id_token: idToken,
        });
      }
      if (url === "https://chatgpt.com/backend-api/codex/responses") {
        const headers = new Headers(init?.headers);
        backendAuthorization.push(headers.get("authorization") ?? "");
        assert.equal(headers.get("chatgpt-account-id"), "account-1");
        assert.equal(init?.credentials, "omit");
        return backendAuthorization.length === 1
          ? new Response(null, { status: 401 })
          : new Response("ok", { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });
  await service.login(PROVIDER_ID, () => undefined);

  const codexFetch = service.authorizedFetch(PROVIDER_ID);
  const response = await codexFetch(
    "https://chatgpt.com/backend-api/codex/responses",
    { method: "POST", body: "{}", headers: { originator: "boltpocket" } },
  );
  assert.equal(await response.text(), "ok");
  assert.deepEqual(backendAuthorization, [
    `Bearer ${firstAccessToken}`,
    `Bearer ${secondAccessToken}`,
  ]);

  await assert.rejects(
    codexFetch("https://models.example.com/backend-api/codex/responses"),
    (error: unknown) => codexErrorCode(error) === "invalid-response",
  );
  await assert.rejects(
    codexFetch("https://chatgpt.com:444/backend-api/codex/responses"),
    (error: unknown) => codexErrorCode(error) === "invalid-response",
  );
  assert.equal(backendAuthorization.length, 2);
});

test("a refreshed credential cannot silently switch ChatGPT accounts", async () => {
  const store = new MemorySecureStore();
  const originalAccessToken = jwt("account-1", NOW + 60 * 60_000);
  const originalIdToken = jwt("account-1", NOW + 60 * 60_000);
  let exchanges = 0;
  const service = new CodexDeviceOAuth({
    now: () => NOW,
    secureStore: store,
    sleep: async () => undefined,
    fetch: (async (input) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: 1,
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "authorization-code-1",
          code_verifier: "code-verifier-1",
        });
      }
      if (url.endsWith("/oauth/token")) {
        exchanges += 1;
        return exchanges === 1
          ? jsonResponse({
              access_token: originalAccessToken,
              refresh_token: "refresh-token-1",
              id_token: originalIdToken,
            })
          : jsonResponse({
              access_token: jwt("account-2", NOW + 2 * 60 * 60_000),
              refresh_token: "refresh-token-2",
              id_token: jwt("account-2", NOW + 2 * 60 * 60_000),
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });
  await service.login(PROVIDER_ID, () => undefined);

  await assert.rejects(
    service.authorization(PROVIDER_ID, { forceRefresh: true }),
    (error: unknown) => codexErrorCode(error) === "account-changed",
  );
  assert.equal((await service.status(PROVIDER_ID))?.accountId, "account-1");
});

test("logout removes the on-device credential even when remote revocation fails", async () => {
  const store = new MemorySecureStore();
  const service = new CodexDeviceOAuth({
    now: () => NOW,
    secureStore: store,
    sleep: async () => undefined,
    fetch: (async (input) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: 1,
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "authorization-code-1",
          code_verifier: "code-verifier-1",
        });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: jwt("account-1", NOW + 60 * 60_000),
          refresh_token: "refresh-token-1",
          id_token: jwt("account-1", NOW + 60 * 60_000),
        });
      }
      if (url.endsWith("/oauth/revoke")) throw new Error("offline");
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });
  await service.login(PROVIDER_ID, () => undefined);

  await service.logout(PROVIDER_ID);

  assert.equal(await service.status(PROVIDER_ID), null);
  assert.equal(store.values.size, 0);
});

test("a late authorization response cannot restore a credential after logout", async () => {
  const store = new MemorySecureStore();
  let markExchangeStarted!: () => void;
  const exchangeStarted = new Promise<void>((resolve) => {
    markExchangeStarted = resolve;
  });
  let finishExchange!: () => void;
  const exchangeGate = new Promise<void>((resolve) => {
    finishExchange = resolve;
  });
  const service = new CodexDeviceOAuth({
    now: () => NOW,
    secureStore: store,
    sleep: async () => undefined,
    fetch: (async (input) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: 1,
        });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({
          authorization_code: "authorization-code-1",
          code_verifier: "code-verifier-1",
        });
      }
      if (url.endsWith("/oauth/token")) {
        markExchangeStarted();
        await exchangeGate;
        return jsonResponse({
          access_token: jwt("account-1", NOW + 60 * 60_000),
          refresh_token: "refresh-token-1",
          id_token: jwt("account-1", NOW + 60 * 60_000),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch,
  });

  const login = service.login(PROVIDER_ID, () => undefined);
  await exchangeStarted;
  await service.logout(PROVIDER_ID);
  finishExchange();

  await assert.rejects(
    login,
    (error: unknown) => codexErrorCode(error) === "cancelled",
  );
  assert.equal(await service.status(PROVIDER_ID), null);
  assert.equal(store.values.size, 0);
});

type RecordedRequest = Readonly<{ url: string; init?: RequestInit }>;

class MemorySecureStore {
  readonly values = new Map<string, string>();

  async deleteItem(key: string) {
    this.values.delete(key);
  }

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function recordFetch(
  calls: RecordedRequest[],
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jwt(
  accountId: string,
  expiresAt: number,
  profile: Readonly<{ email?: string; plan?: string }> = {},
) {
  const claims = {
    exp: Math.floor(expiresAt / 1_000),
    ...(profile.email ? { email: profile.email } : {}),
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      ...(profile.plan ? { chatgpt_plan_type: profile.plan } : {}),
    },
  };
  return `${base64Url({ alg: "none" })}.${base64Url(claims)}.signature`;
}

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function codexErrorCode(error: unknown) {
  return error instanceof CodexDeviceOAuthError ? error.code : null;
}
