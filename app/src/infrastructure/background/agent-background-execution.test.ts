import assert from "node:assert/strict";
import test from "node:test";

import { NativeAgentBackgroundExecution } from "./agent-background-execution.ts";

class FakeBackgroundService {
  running = false;
  starts = 0;
  stops = 0;
  updates: string[] = [];
  expiration: (() => void) | null = null;

  isRunning() {
    return this.running;
  }

  on(_event: "expiration", listener: () => void) {
    this.expiration = listener;
  }

  removeListener() {}

  async start(_task: () => Promise<void>) {
    this.running = true;
    this.starts += 1;
  }

  async updateNotification(options: { taskDesc: string }) {
    this.updates.push(options.taskDesc);
  }

  async stop() {
    this.running = false;
    this.stops += 1;
  }
}

function createExecution(
  service: FakeBackgroundService,
  prepareAndroidForegroundService: () => Promise<void> = () =>
    Promise.resolve(),
) {
  return new NativeAgentBackgroundExecution({
    nativePlatform: "android",
    loadService: async () => service,
    prepareAndroidForegroundService,
  });
}

test("one native background task represents up to three Agent runs", async () => {
  const service = new FakeBackgroundService();
  const execution = createExecution(service);

  await execution.syncActiveConversations(["one"]);
  await execution.syncActiveConversations(["one", "two", "three"]);
  assert.equal(service.starts, 1);
  assert.deepEqual(service.updates, ["3 个对话正在运行"]);

  await assert.rejects(
    execution.syncActiveConversations(["one", "two", "three", "four"]),
    /后台任务列表无效/u,
  );
  await execution.stop();
  assert.equal(service.stops, 1);
});

test("Android prepares notification visibility once without blocking the foreground service", async () => {
  const service = new FakeBackgroundService();
  let preparations = 0;
  const execution = createExecution(service, async () => {
    preparations += 1;
    throw new Error("permission prompt unavailable");
  });

  await execution.syncActiveConversations(["one"]);
  await execution.stop();
  await execution.syncActiveConversations(["two"]);

  assert.equal(preparations, 1);
  assert.equal(service.starts, 2);
});

test("iOS expiration is surfaced so live runs can become retryable", async () => {
  const service = new FakeBackgroundService();
  const execution = new NativeAgentBackgroundExecution({
    nativePlatform: "ios",
    loadService: async () => service,
  });
  let expirations = 0;
  execution.subscribeToExpiration(() => {
    expirations += 1;
  });

  await execution.syncActiveConversations(["one"]);
  service.expiration?.();
  await Promise.resolve();
  assert.equal(expirations, 1);
  assert.equal(service.running, false);
});

test("iOS background protection failure does not block a foreground run", async () => {
  const service = new FakeBackgroundService();
  service.start = async () => {
    service.starts += 1;
    throw new Error("background task unavailable");
  };
  const execution = new NativeAgentBackgroundExecution({
    nativePlatform: "ios",
    loadService: async () => service,
  });

  await execution.syncActiveConversations(["one"]);
  await execution.stop();

  assert.equal(service.starts, 1);
  assert.equal(service.stops, 0);
});

test(
  "an immediate retry waits for expiration cleanup before starting again",
  { timeout: 2_000 },
  async () => {
    const service = new FakeBackgroundService();
    let releaseStop: () => void = () => undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    service.stop = async () => {
      service.stops += 1;
      await stopGate;
      service.running = false;
    };
    const execution = createExecution(service);

    await execution.syncActiveConversations(["one"]);
    service.expiration?.();
    const restarted = execution.syncActiveConversations(["two"]);
    await Promise.resolve();
    assert.equal(service.starts, 1);

    releaseStop();
    await restarted;
    assert.equal(service.stops, 1);
    assert.equal(service.starts, 2);
    assert.equal(service.running, true);
  },
);

test("web keeps bookkeeping without loading a native service", async () => {
  let loaded = false;
  const execution = new NativeAgentBackgroundExecution({
    nativePlatform: "web",
    loadService: async () => {
      loaded = true;
      return new FakeBackgroundService();
    },
  });
  await execution.syncActiveConversations(["one"]);
  await execution.stop();
  assert.equal(loaded, false);
});
