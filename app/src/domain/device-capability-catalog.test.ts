import assert from "node:assert/strict";
import test from "node:test";

import { DEVICE_CAPABILITY_IDS } from "../application/ports/device-capabilities.ts";
import {
  DEVICE_CAPABILITY_CATALOG,
  P0_DEVICE_CAPABILITY_POLICIES,
} from "./device-capability-catalog.ts";

test("the native capability inventory is unique and explicitly classified", () => {
  assert.equal(DEVICE_CAPABILITY_CATALOG.length >= 25, true);
  assert.equal(
    new Set(DEVICE_CAPABILITY_CATALOG.map((entry) => entry.id)).size,
    DEVICE_CAPABILITY_CATALOG.length,
  );
  assert.equal(
    DEVICE_CAPABILITY_CATALOG.every(
      (entry) => entry.platforms.length > 0 && entry.examples.length > 0,
    ),
    true,
  );
  assert.equal(
    DEVICE_CAPABILITY_CATALOG.some((entry) => entry.release === "blocked"),
    true,
  );
  assert.equal(
    DEVICE_CAPABILITY_CATALOG.some((entry) => entry.release === "handoff"),
    true,
  );
});

test("every executable P0 permission has exactly one browser-style default", () => {
  assert.deepEqual(Object.keys(P0_DEVICE_CAPABILITY_POLICIES), [
    ...DEVICE_CAPABILITY_IDS,
  ]);
  assert.equal(Object.isFrozen(P0_DEVICE_CAPABILITY_POLICIES), true);
  assert.deepEqual(P0_DEVICE_CAPABILITY_POLICIES, {
    "device-status": "allow",
    power: "allow",
    storage: "allow",
    network: "allow",
    location: "ask",
    wifi: "ask",
    bluetooth: "ask",
    "local-network": "ask",
    "external-apps": "ask",
    calendar: "ask",
    reminders: "ask",
    sensors: "ask",
    audio: "ask",
  });
});
