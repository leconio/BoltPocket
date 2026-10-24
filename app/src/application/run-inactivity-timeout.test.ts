import assert from "node:assert/strict";
import test from "node:test";

import { createRunInactivityTimeout } from "./run-inactivity-timeout.ts";

type Scheduled = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
};

function fakeClock() {
  let now = 0;
  const scheduled: Scheduled[] = [];
  return {
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    scheduled,
    schedule(callback: () => void, delayMs: number) {
      const task = { callback, delayMs, cancelled: false };
      scheduled.push(task);
      return task as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(handle: ReturnType<typeof setTimeout>) {
      (handle as unknown as Scheduled).cancelled = true;
    },
  };
}

test("stream activity extends one deadline without recreating its timer", () => {
  const clock = fakeClock();
  let timedOut = 0;
  const timeout = createRunInactivityTimeout({
    timeoutMs: 1_000,
    onTimeout: () => {
      timedOut += 1;
    },
    now: clock.now,
    schedule: clock.schedule,
    cancelScheduled: clock.cancel,
  });

  timeout.touch();
  for (let index = 0; index < 500; index += 1) timeout.touch();

  assert.equal(clock.scheduled.length, 1);
  clock.advance(1_000);
  clock.scheduled[0]!.callback();
  assert.equal(timedOut, 1);
});

test("the deadline re-arms once when activity arrives after the timer starts", () => {
  const clock = fakeClock();
  let timedOut = 0;
  const timeout = createRunInactivityTimeout({
    timeoutMs: 1_000,
    onTimeout: () => {
      timedOut += 1;
    },
    now: clock.now,
    schedule: clock.schedule,
    cancelScheduled: clock.cancel,
  });

  timeout.touch();
  clock.advance(700);
  timeout.touch();
  clock.advance(300);
  clock.scheduled[0]!.callback();

  assert.equal(timedOut, 0);
  assert.equal(clock.scheduled.length, 2);
  assert.equal(clock.scheduled[1]!.delayMs, 700);

  clock.advance(700);
  clock.scheduled[1]!.callback();
  assert.equal(timedOut, 1);
});

test("cancelling prevents a pending timeout", () => {
  const clock = fakeClock();
  let timedOut = false;
  const timeout = createRunInactivityTimeout({
    timeoutMs: 1_000,
    onTimeout: () => {
      timedOut = true;
    },
    now: clock.now,
    schedule: clock.schedule,
    cancelScheduled: clock.cancel,
  });

  timeout.touch();
  timeout.cancel();
  clock.advance(1_000);
  if (!clock.scheduled[0]!.cancelled) clock.scheduled[0]!.callback();

  assert.equal(timedOut, false);
  assert.equal(clock.scheduled[0]!.cancelled, true);
});
