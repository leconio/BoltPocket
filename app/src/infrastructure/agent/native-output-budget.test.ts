import assert from "node:assert/strict";
import test from "node:test";
import { localOutputTokens } from "./native-output-budget.ts";

test("normal chat can generate beyond the benchmark's 256-token sample", () => {
  assert.equal(localOutputTokens(), 2048);
  assert.equal(localOutputTokens(1024), 1024);
  assert.equal(localOutputTokens(4096), 4096);
});

test("explicit short samples and the advertised model limit remain bounded", () => {
  assert.equal(localOutputTokens(16), 16);
  assert.equal(localOutputTokens(256), 256);
  assert.equal(localOutputTokens(100_000), 4096);
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => localOutputTokens(value));
  }
});
