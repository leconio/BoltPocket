import assert from "node:assert/strict";
import test from "node:test";

import {
  SENSOR_TYPES,
  SensorOperations,
  type SensorDependencies,
} from "./sensor-operations.ts";

function fixture(options: { platform?: string; emit?: boolean } = {}) {
  let removed = 0;
  let now = 1_000;
  const adapter = {
    isAvailable: async () => true,
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    setInterval: () => undefined,
    subscribe: (listener: (sample: unknown) => void) => {
      if (options.emit !== false) listener({ x: 1, y: 2, z: 3 });
      return { remove: () => (removed += 1) };
    },
  };
  const dependencies: SensorDependencies = {
    platform: options.platform ?? "ios",
    sensors: Object.fromEntries(
      SENSOR_TYPES.map((type) => [type, adapter]),
    ) as unknown as SensorDependencies["sensors"],
    stepCount: async () => 321,
    wait: async () => {
      now += 500;
    },
    now: () => now,
  };
  return { dependencies, removed: () => removed };
}

test("sensor sampling is bounded and always removes the foreground subscription", async () => {
  const { dependencies, removed } = fixture();
  const operations = new SensorOperations(dependencies);
  const result = (await operations.read({
    action: "sensor_read",
    purpose: "Measure current motion",
    sensorType: "accelerometer",
    durationMs: 500,
    intervalMs: 100,
  })) as unknown as {
    count: number;
    samples: { x: number }[];
  };
  assert.equal(result.count, 1);
  assert.equal(result.samples[0]?.x, 1);
  assert.equal(removed(), 1);
});

test("an empty sampling window returns an explicit result rather than a tool timeout", async () => {
  const { dependencies } = fixture({ emit: false });
  const operations = new SensorOperations(dependencies);
  const result = (await operations.read({
    action: "sensor_read",
    purpose: "Read ambient light",
    sensorType: "light",
    durationMs: 500,
  })) as unknown as { count: number; message: string };
  assert.equal(result.count, 0);
  assert.match(result.message, /没有上报数据/u);
});

test("pedometer history is explicit iOS-only behavior", async () => {
  const { dependencies } = fixture({ platform: "android" });
  const operations = new SensorOperations(dependencies);
  await assert.rejects(
    operations.read({
      action: "sensor_read",
      purpose: "Count today's steps",
      sensorType: "pedometer",
      startAt: "2026-08-17T00:00:00.000Z",
      endAt: "2026-08-17T12:00:00.000Z",
    }),
    /Android/u,
  );
});
