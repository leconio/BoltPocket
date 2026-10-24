import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareForDistributionTransition,
  registerDistributionTransitionHandler,
} from "./distribution-transition.ts";

test("distribution transition waits for every registered runtime boundary", async () => {
  const calls: string[] = [];
  const releaseRuntime = registerDistributionTransitionHandler(async () => {
    calls.push("runtime");
  });
  const releaseApplication = registerDistributionTransitionHandler(async () => {
    calls.push("application");
  });

  try {
    await prepareForDistributionTransition();
    assert.deepEqual(calls, ["runtime", "application"]);
  } finally {
    releaseApplication();
    releaseRuntime();
  }

  calls.length = 0;
  await prepareForDistributionTransition();
  assert.deepEqual(calls, []);
});

test("a failed boundary does not let the region switch past unfinished cleanup", async () => {
  let releaseCleanup: (() => void) | undefined;
  let cleanupFinished = false;
  const unregisterFailure = registerDistributionTransitionHandler(async () => {
    throw new Error("failed boundary");
  });
  const unregisterCleanup = registerDistributionTransitionHandler(
    () =>
      new Promise<void>((resolve) => {
        releaseCleanup = () => {
          cleanupFinished = true;
          resolve();
        };
      }),
  );

  try {
    const transition = prepareForDistributionTransition();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cleanupFinished, false);
    releaseCleanup?.();
    await assert.rejects(transition, /failed boundary/u);
    assert.equal(cleanupFinished, true);
  } finally {
    unregisterCleanup();
    unregisterFailure();
  }
});
