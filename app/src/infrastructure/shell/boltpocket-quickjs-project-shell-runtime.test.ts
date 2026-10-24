import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectShellJavaScriptExecuteInput } from "@boltpocket/project-shell";

import {
  adaptBoltPocketQuickJsExecutor,
  type BoltPocketQuickJsExecutorPort,
} from "./boltpocket-quickjs-project-shell-runtime.ts";

function request(
  overrides: Partial<ProjectShellJavaScriptExecuteInput> = {},
): ProjectShellJavaScriptExecuteInput {
  return {
    source: "console.log(input.args[0])",
    filename: "/project/script.js",
    args: ["hello"],
    cwd: "/project",
    stdin: "piped value",
    files: [{ path: "/project/value.txt", contents: "value" }],
    limits: {
      memoryBytes: 16 * 1024 * 1024,
      stackBytes: 512 * 1024,
      outputBytes: 4 * 1024 * 1024,
      timeoutMs: 30_000,
    },
    ...overrides,
  };
}

test("maps ProjectShell input to the bounded JSON-only QuickJS API", async () => {
  let received: Parameters<BoltPocketQuickJsExecutorPort["execute"]>[0] | undefined;
  const runtime = adaptBoltPocketQuickJsExecutor({
    isAvailable: true,
    async execute(input) {
      received = input;
      return {
        stdout: "hello\n",
        stderr: "",
        result: '{"answer":42}',
        exitCode: 0,
      };
    },
  });

  const result = await runtime.execute(request());

  assert.deepEqual(result, {
    stdout: "hello\n",
    stderr: "",
    result: '{"answer":42}',
    exitCode: 0,
  });
  assert.equal(received?.timeoutMs, 10_000);
  assert.equal(received?.maxOutputBytes, 1024 * 1024);
  assert.deepEqual(received?.input, {
    args: ["hello"],
    cwd: "/project",
    stdin: "piped value",
    files: [{ path: "/project/value.txt", contents: "value" }],
  });
});

test("fails closed when native isolation is unavailable or cannot honor limits", async () => {
  let calls = 0;
  const runtime = adaptBoltPocketQuickJsExecutor({
    isAvailable: false,
    async execute() {
      calls += 1;
      throw new Error("must not execute");
    },
  });
  assert.match((await runtime.execute(request())).stderr, /unavailable/u);
  assert.equal(calls, 0);

  const available = adaptBoltPocketQuickJsExecutor({
    isAvailable: true,
    async execute() {
      calls += 1;
      throw new Error("must not execute");
    },
  });
  const result = await available.execute(
    request({
      limits: {
        ...request().limits,
        stackBytes: 64 * 1024,
      },
    }),
  );
  assert.match(result.stderr, /too small/u);
  assert.equal(calls, 0);
});

test("redacts native failures and preserves cancellation", async () => {
  const failed = adaptBoltPocketQuickJsExecutor({
    isAvailable: true,
    async execute() {
      throw new Error("private project contents leaked from native");
    },
  });
  const result = await failed.execute(request());
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /private|contents/u);

  const cancelled = adaptBoltPocketQuickJsExecutor({
    isAvailable: true,
    async execute() {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    },
  });
  await assert.rejects(cancelled.execute(request()), { name: "AbortError" });
});
