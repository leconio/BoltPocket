import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_AUTHORIZATION_HEADER,
  DISTRIBUTION_REGION_HEADER,
  createFirstPartyAuthenticatedFetch,
} from "./first-party-authenticated-fetch.ts";
import { AccountAuthenticationRequiredError } from "@/application/ports/authentication";
import { AuthenticationError } from "./casdoor-authentication.ts";

test("first-party fetch adds account auth without replacing endpoint auth", async () => {
  let headers = new Headers();
  const authenticatedFetch = createFirstPartyAuthenticatedFetch({
    allowedOrigins: ["https://boltpocket-api.example.com"],
    authentication: { accessToken: async () => "account-access-token-value" },
    distributionRegion: "china-mainland",
    fetch: (async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ ok: true });
    }) as typeof fetch,
  });

  await authenticatedFetch("https://boltpocket-api.example.com/v1/test", {
    headers: { Authorization: "Bearer opaque-service-session" },
  });

  assert.equal(
    headers.get(ACCOUNT_AUTHORIZATION_HEADER),
    "Bearer account-access-token-value",
  );
  assert.equal(headers.get("Authorization"), "Bearer opaque-service-session");
  assert.equal(headers.get(DISTRIBUTION_REGION_HEADER), "china-mainland");
});

test("first-party fetch never sends the account token cross-origin", async () => {
  let tokenReads = 0;
  const authenticatedFetch = createFirstPartyAuthenticatedFetch({
    allowedOrigins: ["https://boltpocket-api.example.com"],
    authentication: {
      async accessToken() {
        tokenReads += 1;
        return "account-access-token-value";
      },
    },
    distributionRegion: "global",
    fetch: (async () => Response.json({ ok: true })) as typeof fetch,
  });

  await assert.rejects(
    authenticatedFetch("https://attacker.example.com/v1/test"),
    /non-first-party/u,
  );
  assert.equal(tokenReads, 0);
});

test("first-party fetch turns an expired local account into a recoverable sign-in error", async () => {
  const authenticatedFetch = createFirstPartyAuthenticatedFetch({
    allowedOrigins: ["https://boltpocket-api.example.com"],
    authentication: {
      async accessToken() {
        throw new AuthenticationError("session_expired");
      },
    },
    distributionRegion: "global",
    fetch: (async () => {
      throw new Error("an expired account must not reach the network");
    }) as typeof fetch,
  });

  await assert.rejects(
    authenticatedFetch("https://boltpocket-api.example.com/v1/test"),
    AccountAuthenticationRequiredError,
  );
});

test("first-party fetch recognizes only the BoltPocket account challenge", async () => {
  let requestCount = 0;
  const authenticatedFetch = createFirstPartyAuthenticatedFetch({
    allowedOrigins: ["https://boltpocket-api.example.com"],
    authentication: { accessToken: async () => "account-access-token-value" },
    distributionRegion: "global",
    fetch: (async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate":
            'Bearer realm="BoltPocket account", error="invalid_token"',
        },
        status: 401,
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    authenticatedFetch("https://boltpocket-api.example.com/v1/test"),
    AccountAuthenticationRequiredError,
  );
  assert.equal(requestCount, 1);
});

test("first-party fetch leaves endpoint-specific unauthorized responses intact", async () => {
  const authenticatedFetch = createFirstPartyAuthenticatedFetch({
    allowedOrigins: ["https://boltpocket-api.example.com"],
    authentication: { accessToken: async () => "account-access-token-value" },
    distributionRegion: "global",
    fetch: (async () =>
      new Response(JSON.stringify({ error: "service_session_expired" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })) as typeof fetch,
  });

  const response = await authenticatedFetch(
    "https://boltpocket-api.example.com/v1/test",
  );
  assert.equal(response.status, 401);
});
