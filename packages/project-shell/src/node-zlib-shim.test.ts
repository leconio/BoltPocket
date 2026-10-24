import assert from "node:assert/strict";
import test from "node:test";

import { gunzipSync, gzipSync } from "./node-zlib-shim.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("zlib shim returns Uint8Array-compatible deterministic round trips", () => {
  const source = encoder.encode("hello 你好 ".repeat(100));
  const compressed = gzipSync(source, { level: 6, maxOutputLength: 4_096 });
  assert.ok(compressed instanceof Uint8Array);
  const restored = gunzipSync(compressed, {
    maxOutputLength: source.byteLength,
  });
  assert.ok(restored instanceof Uint8Array);
  assert.equal(decoder.decode(restored), decoder.decode(source));
});

test("gunzip rejects a normal expansion bomb before returning output", () => {
  const bomb = gzipSync(encoder.encode("x".repeat(512 * 1024)), {
    maxOutputLength: 8_192,
  });
  assert.throws(
    () => gunzipSync(bomb, { maxOutputLength: 4_096 }),
    /exceeds limit/u,
  );
});

test("gunzip enforces cumulative output for concatenated members", () => {
  const large = gzipSync(encoder.encode("a".repeat(256 * 1024)), {
    maxOutputLength: 8_192,
  });
  const small = gzipSync(encoder.encode("ok"), { maxOutputLength: 128 });
  const concatenated = new Uint8Array(large.byteLength + small.byteLength);
  concatenated.set(large);
  concatenated.set(small, large.byteLength);
  assert.throws(
    () => gunzipSync(concatenated, { maxOutputLength: 4_096 }),
    /exceeds limit/u,
  );
});

test("gzip validates output limits before and after compression", () => {
  assert.throws(
    () => gzipSync(encoder.encode("hello"), { maxOutputLength: 8 }),
    /exceeds limit/u,
  );
  assert.throws(
    () => gzipSync(encoder.encode("hello"), { maxOutputLength: -1 }),
    /non-negative/u,
  );
});
