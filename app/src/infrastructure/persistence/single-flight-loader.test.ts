import assert from "node:assert/strict";
import test from "node:test";

import {
  createMutableSingleFlightLoader,
  createSingleFlightLoader,
} from "./single-flight-loader.ts";

test("single-flight loader runs one operation for concurrent and later callers", async () => {
  let calls = 0;
  const load = createSingleFlightLoader(async () => {
    calls += 1;
    await Promise.resolve();
    return "database-key";
  });

  const first = load();
  const second = load();
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second, load()]), [
    "database-key",
    "database-key",
    "database-key",
  ]);
  assert.equal(calls, 1);
});

test("single-flight loader clears a rejected operation for an explicit retry", async () => {
  let calls = 0;
  const load = createSingleFlightLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("device locked");
    return "database-key";
  });

  await assert.rejects(load(), /device locked/u);
  assert.equal(await load(), "database-key");
  assert.equal(calls, 2);
});

test("mutable single-flight loader replaces and invalidates cached values", async () => {
  let calls = 0;
  const loader = createMutableSingleFlightLoader(async () => {
    calls += 1;
    await Promise.resolve();
    return `value-${calls}`;
  });

  const first = loader.load();
  assert.equal(loader.load(), first);
  assert.equal(await first, "value-1");
  assert.equal(await loader.load(), "value-1");

  loader.replace("saved-value");
  assert.equal(await loader.load(), "saved-value");
  assert.equal(calls, 1);

  loader.invalidate();
  assert.equal(await loader.load(), "value-2");
  assert.equal(calls, 2);
});

test("mutable single-flight loader retries rejected operations", async () => {
  let calls = 0;
  const loader = createMutableSingleFlightLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("device locked");
    return "recovered";
  });

  await assert.rejects(loader.load(), /device locked/u);
  assert.equal(await loader.load(), "recovered");
  assert.equal(calls, 2);
});
