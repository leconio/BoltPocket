import assert from "node:assert/strict";
import test from "node:test";

import {
  boundTailText,
  boundText,
  BoundedTextAccumulator,
} from "./bounded-text.ts";

test("bounded streams retain the beginning and latest tail within the limit", () => {
  const accumulator = new BoundedTextAccumulator(256);
  accumulator.append(`BEGIN-${"a".repeat(240)}`);
  accumulator.append(`${"b".repeat(240)}-LATEST`);
  const result = accumulator.value();

  assert.equal(accumulator.truncated, true);
  assert.ok(result.length <= 256);
  assert.match(result, /^BEGIN-/u);
  assert.match(result, /-LATEST$/u);
  assert.match(result, /中间内容已省略/u);
});

test("many tiny deltas remain bounded and short values stay unchanged", () => {
  const accumulator = new BoundedTextAccumulator(512);
  for (let index = 0; index < 10_000; index += 1) {
    accumulator.append(String(index % 10));
  }
  assert.ok(accumulator.value().length <= 512);
  assert.equal(boundText("ordinary response", 512), "ordinary response");
});

test("live previews retain only a bounded latest window", () => {
  const value = `old-${"x".repeat(2_000)}-latest`;
  const preview = boundTailText(value, 64);

  assert.equal(preview.length, 64);
  assert.match(preview, /^…\n/u);
  assert.match(preview, /-latest$/u);
  assert.equal(boundTailText("short", 64), "short");
});
