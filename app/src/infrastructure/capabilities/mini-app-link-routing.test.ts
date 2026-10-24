import assert from "node:assert/strict";
import test from "node:test";

import { redirectMiniAppSystemPath } from "./mini-app-link-routing.ts";

test("rewrites production mini-app universal links", () => {
  assert.equal(
    redirectMiniAppSystemPath(
      "https://boltpocket-api.example.invalid/mini-apps/privacy-check",
    ),
    "/skill-market/privacy-check",
  );
  assert.equal(
    redirectMiniAppSystemPath("https://api.example.invalid/mini-apps/test-plan"),
    "/skill-market/test-plan",
  );
});

test("does not rewrite untrusted hosts or malformed identifiers", () => {
  const untrusted = "https://example.com/mini-apps/privacy-check";
  assert.equal(redirectMiniAppSystemPath(untrusted), untrusted);
  assert.equal(
    redirectMiniAppSystemPath("/mini-apps/%2Fsettings"),
    "/mini-apps/%2Fsettings",
  );
});
