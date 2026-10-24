import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveResponsiveForegroundLocation,
  type ResponsiveLocationPosition,
} from "./responsive-foreground-location.ts";

const now = Date.parse("2026-08-17T10:00:00.000Z");

function position(
  timestamp: number,
  accuracy = 30,
): ResponsiveLocationPosition {
  return {
    coords: {
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
    mocked: false,
  };
}

function provider() {
  return {
    locationServicesEnabled: true,
    backgroundModeEnabled: false,
    gpsAvailable: false,
    networkAvailable: true,
    passiveAvailable: true,
  };
}

test("a recent system position avoids waiting for another location fix", async () => {
  let watched = false;
  const result = await resolveResponsiveForegroundLocation({
    now: () => now,
    dependencies: {
      servicesEnabled: async () => true,
      providerStatus: async () => provider(),
      lastKnown: async () => position(now - 5_000),
      watch: async () => {
        watched = true;
        return { remove() {} };
      },
    },
  });
  assert.equal(watched, false);
  assert.equal(result.source, "lastKnown");
  assert.equal(result.ageMs, 5_000);
  assert.equal(result.currentAttempted, false);
});

test("a bounded current fix replaces an older cached position", async () => {
  const current = position(now - 1_000, 12);
  let removed = false;
  const result = await resolveResponsiveForegroundLocation({
    now: () => now,
    timeoutMs: 100,
    dependencies: {
      servicesEnabled: async () => true,
      providerStatus: async () => provider(),
      lastKnown: async () => position(now - 3 * 60_000),
      watch: async (onLocation) => {
        queueMicrotask(() => onLocation(current));
        return { remove: () => void (removed = true) };
      },
    },
  });
  assert.equal(result.source, "current");
  assert.equal(result.position, current);
  assert.equal(removed, true);
});

test("current timeout falls back to a bounded recent position and reports why", async () => {
  let removed = false;
  const result = await resolveResponsiveForegroundLocation({
    now: () => now,
    timeoutMs: 5,
    dependencies: {
      servicesEnabled: async () => true,
      providerStatus: async () => provider(),
      lastKnown: async () => position(now - 4 * 60_000, 300),
      watch: async () => ({ remove: () => void (removed = true) }),
    },
  });
  assert.equal(result.source, "lastKnown");
  assert.equal(result.fallbackReason, "current-timeout");
  assert.equal(result.ageMs, 4 * 60_000);
  assert.equal(removed, true);
});

test("disabled services and a genuine no-fix timeout are distinguishable", async () => {
  const base = {
    providerStatus: async () => provider(),
    lastKnown: async () => null,
    watch: async () => ({ remove() {} }),
  };
  await assert.rejects(
    resolveResponsiveForegroundLocation({
      dependencies: { ...base, servicesEnabled: async () => false },
    }),
    /定位服务已关闭/u,
  );
  await assert.rejects(
    resolveResponsiveForegroundLocation({
      timeoutMs: 5,
      dependencies: { ...base, servicesEnabled: async () => true },
    }),
    /当前定位.*没有返回.*GPS 不可用.*网络定位 可用/u,
  );
});
