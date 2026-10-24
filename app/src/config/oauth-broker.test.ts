import assert from "node:assert/strict";
import test from "node:test";

import { loadOAuthBrokerConfig } from "./oauth-broker.ts";

test("OAuth Broker accepts an HTTPS origin with or without a trailing slash", () => {
  assert.deepEqual(loadOAuthBrokerConfig("https://broker.example.com"), {
    baseUrl: "https://broker.example.com",
    returnUrl: "boltpocket://oauth/complete",
  });
  assert.deepEqual(loadOAuthBrokerConfig("https://broker.example.com/"), {
    baseUrl: "https://broker.example.com",
    returnUrl: "boltpocket://oauth/complete",
  });
});

test("OAuth Broker rejects non-HTTPS and non-origin URLs", () => {
  assert.throws(() => loadOAuthBrokerConfig("http://broker.example.com"));
  assert.throws(() => loadOAuthBrokerConfig("https://broker.example.com/path"));
  assert.throws(() =>
    loadOAuthBrokerConfig("https://broker.example.com?mode=test"),
  );
  assert.throws(() => loadOAuthBrokerConfig("https://user@broker.example.com"));
});
