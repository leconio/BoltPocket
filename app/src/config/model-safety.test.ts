import assert from "node:assert/strict";
import test from "node:test";

import { loadModelSafetyConfig } from "./model-safety.ts";

test("model safety uses the general first-party API by default", () => {
  assert.equal(
    loadModelSafetyConfig().baseUrl,
    "https://boltpocket-api.example.invalid",
  );
});

test("an explicit test origin overrides the compiled model-safety origin", () => {
  assert.equal(
    loadModelSafetyConfig("https://safety.example.com").baseUrl,
    "https://safety.example.com",
  );
});
