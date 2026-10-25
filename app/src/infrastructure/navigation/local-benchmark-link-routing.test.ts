import assert from "node:assert/strict";
import test from "node:test";

import { redirectLocalBenchmarkSystemPath } from "./local-benchmark-link-routing.ts";

test("explicit performance links reach the separate benchmark stack route", () => {
  for (const [input, expected] of [
    ["boltpocket://?demo=1", "/local-benchmark?demo=1"],
    ["/?bench=1&cache=off", "/local-benchmark?bench=1&cache=off"],
    ["boltpocket:///?probe=decode", "/local-benchmark?probe=decode"],
    ["boltpocket://local-benchmark?probe=short", "/local-benchmark?probe=short"],
    ["/?probe=long-2048", "/local-benchmark?probe=long-2048"],
  ]) {
    assert.equal(redirectLocalBenchmarkSystemPath(input!), expected);
  }
});

test("ordinary navigation and external callbacks do not become benchmark routes", () => {
  for (const input of [
    "/",
    "/?market=1",
    "/settings?demo=1",
    "boltpocket://project/project-one?bench=1",
    "boltpocket://auth/callback?code=example",
    "boltpocket://oauth/complete?code=example",
    "https://example.com/?demo=1",
    "/?demo=0",
    "/?demo=1&bench=1",
    "/?demo=1&demo=0",
    "/?probe=long-2049",
    "/?probe=long--1",
    "/?probe=unknown",
  ]) {
    assert.equal(redirectLocalBenchmarkSystemPath(input), input);
  }
});
