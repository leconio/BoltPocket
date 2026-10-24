import assert from "node:assert/strict";
import test from "node:test";

import { loadAuthenticationConfig } from "./authentication.ts";

test("authentication config defaults to the production Casdoor origin", () => {
  assert.equal(
    loadAuthenticationConfig(undefined, undefined).serverUrl,
    "https://auth.example.invalid",
  );
});

test("authentication config accepts a public HTTPS origin and client ID", () => {
  assert.deepEqual(
    loadAuthenticationConfig("https://auth.example.com/", "mobile-client_1"),
    {
      serverUrl: "https://auth.example.com",
      clientId: "mobile-client_1",
      scope: "openid profile email",
      redirectUri: "boltpocket://auth/callback",
    },
  );
});

test("authentication config rejects unsafe origins and malformed client IDs", () => {
  assert.throws(() =>
    loadAuthenticationConfig("http://auth.example.com", "mobile-client_1"),
  );
  assert.throws(() =>
    loadAuthenticationConfig(
      "https://auth.example.com/path",
      "mobile-client_1",
    ),
  );
  assert.throws(() =>
    loadAuthenticationConfig("https://auth.example.com", "short"),
  );
});
