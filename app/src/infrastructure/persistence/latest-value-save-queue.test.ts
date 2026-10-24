import assert from "node:assert/strict";
import test from "node:test";

import { LatestValueSaveQueue } from "./latest-value-save-queue.ts";

test("pending snapshots coalesce to the newest value", async () => {
  const saved: number[] = [];
  let releaseFrame: (() => void) | undefined;
  const frame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });
  const queue = new LatestValueSaveQueue<number>({
    beforeSave: () => frame,
    async save(value) {
      saved.push(value);
    },
  });

  const first = queue.enqueue(1);
  const second = queue.enqueue(2);
  const third = queue.enqueue(3);
  releaseFrame?.();
  await Promise.all([first, second, third, queue.flush()]);

  assert.deepEqual(saved, [3]);
});

test("a value arriving during a write is saved next and flush waits for it", async () => {
  const saved: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = new LatestValueSaveQueue<number>({
    async save(value) {
      saved.push(value);
      if (value === 1) await firstWrite;
    },
  });

  const first = queue.enqueue(1);
  await Promise.resolve();
  const second = queue.enqueue(2);
  const flushed = queue.flush();
  releaseFirst?.();
  await Promise.all([first, second, flushed]);

  assert.deepEqual(saved, [1, 2]);
});

test("failed saves reject their waiters and later writes can recover", async () => {
  const queue = new LatestValueSaveQueue<number>({
    async save(value) {
      if (value === 1) throw new Error("write failed");
    },
  });

  await assert.rejects(queue.enqueue(1), /write failed/u);
  await assert.doesNotReject(queue.enqueue(2));
  await assert.doesNotReject(queue.flush());
});

test("a failed interaction gate rejects pending work without wedging the queue", async () => {
  let gateAttempts = 0;
  const saved: number[] = [];
  const queue = new LatestValueSaveQueue<number>({
    beforeSave: async () => {
      gateAttempts += 1;
      if (gateAttempts === 1) throw new Error("frame unavailable");
    },
    save: async (value) => {
      saved.push(value);
    },
  });

  await assert.rejects(queue.enqueue(1), /frame unavailable/u);
  await queue.enqueue(2);

  assert.deepEqual(saved, [2]);
});
