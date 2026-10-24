import assert from "node:assert/strict";
import test from "node:test";

import { loadFirstPartyApiConfig } from "./first-party-api.ts";

test("first-party API uses the MNZ general API by default", () => {
  assert.equal(
    loadFirstPartyApiConfig("").baseUrl,
    "https://boltpocket-api.example.invalid",
  );
  assert.equal(
    loadFirstPartyApiConfig("https://api.example.com/").baseUrl,
    "https://api.example.com",
  );
  assert.throws(() => loadFirstPartyApiConfig("https://user@example.com"));
  assert.throws(() => loadFirstPartyApiConfig("https://example.com/path"));
});
