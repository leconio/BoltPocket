import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuickJsExecutor,
  QUICK_JS_LIMITS,
  type QuickJsNativeAdapter,
} from "./executor.ts";

test("normalizes a bounded request for the native adapter", async () => {
  const calls: unknown[][] = [];
  const adapter: QuickJsNativeAdapter = {
    execute: async (...args) => {
      calls.push(args);
      return {
        stdout: "ok\n",
        stderr: "",
        result: '{"answer":42}',
        exitCode: 0,
      };
    },
  };
  const runtime = createQuickJsExecutor(adapter);

  const result = await runtime.execute({
    code: "console.log(input.name); ({ answer: 42 })",
    filename: "/private/device/agent.js",
    input: { name: "BoltPocket" },
  });

  assert.equal(runtime.isAvailable, true);
  assert.deepEqual(result, {
    stdout: "ok\n",
    stderr: "",
    result: '{"answer":42}',
    exitCode: 0,
  });
  assert.deepEqual(calls, [
    [
      1,
      "console.log(input.name); ({ answer: 42 })",
      "agent.js",
      '{"name":"BoltPocket"}',
      QUICK_JS_LIMITS.timeoutMs.default,
      QUICK_JS_LIMITS.memoryLimitBytes.default,
      QUICK_JS_LIMITS.stackLimitBytes.default,
      QUICK_JS_LIMITS.maxOutputBytes.default,
    ],
  ]);
});

test("unavailable executors fail closed", async () => {
  const runtime = createQuickJsExecutor(null);
  assert.equal(runtime.availability.available, false);
  await assert.rejects(
    runtime.execute({ code: "1 + 1" }),
    /unavailable in this build/u,
  );
});

test("rejects oversized or non-JSON inputs before native execution", async () => {
  let calls = 0;
  const runtime = createQuickJsExecutor({
    execute: async () => {
      calls += 1;
      return { stdout: "", stderr: "", result: null, exitCode: 0 };
    },
  });
  const circular: { self?: unknown } = {};
  circular.self = circular;

  await assert.rejects(
    runtime.execute({ code: "x".repeat(QUICK_JS_LIMITS.codeBytes + 1) }),
    /code exceeds/u,
  );
  await assert.rejects(
    runtime.execute({ code: "input", input: circular }),
    /JSON-serializable/u,
  );
  await assert.rejects(
    runtime.execute({ code: "1", timeoutMs: 60_000 }),
    /timeoutMs/u,
  );
  assert.equal(calls, 0);
});

test("validates untrusted native results", async () => {
  const runtime = createQuickJsExecutor({
    execute: async () => ({ stdout: "", stderr: "", exitCode: "0" }),
  });
  await assert.rejects(runtime.execute({ code: "1" }), /invalid result/u);
});

test("rechecks the combined UTF-8 native output against the requested limit", async () => {
  const exact = createQuickJsExecutor({
    execute: async () => ({
      stdout: "界".repeat(170),
      stderr: "界".repeat(170),
      result: "😀",
      exitCode: 0,
    }),
  });
  const exactResult = await exact.execute({ code: "1", maxOutputBytes: 1024 });
  assert.equal(exactResult.stdout.length, 170);
  assert.equal(exactResult.stderr.length, 170);
  assert.equal(exactResult.result, "😀");

  const oversized = createQuickJsExecutor({
    execute: async () => ({
      stdout: "界".repeat(170),
      stderr: "界".repeat(170),
      result: "😀😀",
      exitCode: 0,
    }),
  });
  await assert.rejects(
    oversized.execute({ code: "1", maxOutputBytes: 1024 }),
    /requested UTF-8 output limit/u,
  );
});

test("forwards AbortSignal cancellation and fails with AbortError", async () => {
  const controller = new AbortController();
  let cancelledId: number | undefined;
  let finish: ((value: unknown) => void) | undefined;
  const runtime = createQuickJsExecutor({
    execute: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    cancel: (executionId) => {
      cancelledId = executionId;
      finish?.({
        stdout: "",
        stderr: "cancelled\n",
        result: null,
        exitCode: 130,
      });
    },
  });

  const pending = runtime.execute({
    code: "while (true) {}",
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(typeof cancelledId, "number");
});
