import assert from "node:assert/strict";
import test from "node:test";

import { createDistributionRuntimeLifetime } from "./distribution-runtime-lifetime.ts";

test("distribution shutdown aborts in-flight requests and rejects later work", async () => {
  let calls = 0;
  const baseFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      init?.signal?.addEventListener("abort", abort, { once: true });
      if (init?.signal?.aborted) abort();
    });
  }) as typeof fetch;
  const lifetime = createDistributionRuntimeLifetime(baseFetch);

  const request = lifetime.fetch("https://global.example.test/data");
  lifetime.abort();

  await assert.rejects(request, { name: "AbortError" });
  await assert.rejects(lifetime.fetch("https://mainland.example.test/data"), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
});

test("distribution requests retain their caller cancellation signal", async () => {
  const baseFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  }) as typeof fetch;
  const lifetime = createDistributionRuntimeLifetime(baseFetch);
  const operation = new AbortController();
  const request = lifetime.fetch("https://example.test/data", {
    signal: operation.signal,
  });

  operation.abort();

  await assert.rejects(request, { name: "AbortError" });
  assert.equal(lifetime.signal.aborted, false);
});
