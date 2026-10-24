import assert from "node:assert/strict";
import test from "node:test";

import { redirectOAuthSystemPath } from "./oauth-callback-routing.ts";

test("document OAuth callbacks are consumed without changing the current route", () => {
  assert.equal(
    redirectOAuthSystemPath(
      "boltpocket://oauth/complete?provider=notion&connection_id=conn_example&receipt=example",
    ),
    null,
  );
  assert.equal(
    redirectOAuthSystemPath(
      "boltpocket://oauth/mcp/complete?authorization_id=mcpa_example&receipt=example",
    ),
    null,
  );
});

test("account OAuth callbacks are consumed without exposing their code to Router", () => {
  assert.equal(
    redirectOAuthSystemPath(
      "boltpocket://auth/callback?code=one_time_code&state=expected_state",
    ),
    null,
  );
});

test("lookalike and ordinary routes continue through Expo Router", () => {
  for (const path of [
    "/settings",
    "boltpocket://oauth.example/complete",
    "boltpocket://oauth/complete-extra",
    "boltpocket://auth.example/callback",
    "boltpocket://auth/callback-extra",
    "https://oauth/complete",
    "https://auth/callback",
    "not a URL",
  ]) {
    assert.equal(redirectOAuthSystemPath(path), path);
  }
});
