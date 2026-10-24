import assert from "node:assert/strict";
import test from "node:test";
import { NativeInferenceProgressStore } from "./native-inference-progress.ts";

test("restored prefix transitions into an incremental disk-cache preparation count", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "r");
  store.update("a", { type: "cache_restore_begin", tag: "r" });
  assert.equal(store.get("a")?.phase, "restoring");
  store.update("a", {
    type: "begin",
    tag: "r",
    prompt_tokens: 7506,
    cache_reused_tokens: 7400,
    cache_origin: "disk",
  });
  assert.equal(store.get("a")?.phase, "prefill");
  assert.equal(store.get("a")?.cacheOrigin, "disk");
  assert.equal(store.get("a")?.totalTokens, 106);
});

test("prefill counts only newly evaluated tokens after an exact cached prefix", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "request-1");
  store.update("a", {
    type: "begin",
    tag: "request-1",
    prompt_tokens: 8685,
    cache_reused_tokens: 7554,
  });
  store.update("a", {
    type: "prefill_submitted",
    tag: "request-1",
    prompt_tokens: 8685,
    tokens: 7810,
  });
  assert.equal(store.get("a")?.totalTokens, 1131);
  assert.equal(store.get("a")?.processedTokens, 256);
});

test("progress remains monotonic and rejects inconsistent or malformed counters", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "r");
  store.update("a", {
    type: "begin",
    tag: "r",
    prompt_tokens: 1000,
    cache_reused_tokens: 0,
  });
  store.update("a", {
    type: "prefill_submitted",
    tag: "r",
    prompt_tokens: 1000,
    tokens: 512,
  });
  for (const event of [
    { prompt_tokens: 999, tokens: 768 },
    { prompt_tokens: 1000, tokens: NaN },
    { prompt_tokens: 1000, tokens: 1001 },
    { prompt_tokens: 1000, tokens: 256 },
  ])
    store.update("a", { type: "prefill_submitted", tag: "r", ...event });
  assert.equal(store.get("a")?.processedTokens, 512);
});

test("complete prompt evaluation remains prefill until generation actually starts", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "r");
  store.update("a", {
    type: "begin",
    tag: "r",
    prompt_tokens: 20,
    cache_reused_tokens: 0,
  });
  store.update("a", {
    type: "prefill_submitted",
    tag: "r",
    prompt_tokens: 20,
    tokens: 20,
  });
  assert.equal(store.get("a")?.phase, "prefill");
  store.update("a", { type: "token", tag: "r", tokens: 1 });
  assert.equal(store.get("a")?.phase, "decoding");
  assert.equal(store.get("a")?.outputTokens, 1);
});

test("stale requests cannot change or clear a newer run", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "old");
  store.start("a", "new");
  store.update("a", {
    type: "begin",
    tag: "old",
    prompt_tokens: 20,
    cache_reused_tokens: 0,
  });
  store.finish("a", "old");
  assert.equal(store.get("a")?.tag, "new");
  assert.equal(store.get("a")?.phase, "queued");
});

test("sessions are isolated and completion and cancellation remove transient state", () => {
  const store = new NativeInferenceProgressStore();
  store.start("a", "one");
  store.start("b", "two");
  store.update("a", { type: "done", tag: "one" });
  assert.equal(store.get("a"), undefined);
  assert.equal(store.get("b")?.tag, "two");
  store.finish("b", "two");
  assert.equal(store.get("b"), undefined);
});

test("unsubscribed views receive no later progress notifications", () => {
  const store = new NativeInferenceProgressStore();
  let a = 0,
    b = 0;
  const unsubscribe = store.subscribe("a", () => a++);
  store.subscribe("b", () => b++);
  store.start("a", "r");
  unsubscribe();
  store.loading("a", "r");
  assert.equal(a, 1);
  assert.equal(b, 0);
});
