import assert from "node:assert/strict";
import test from "node:test";

import type { PendingDeviceCapabilityAccess } from "../../application/ports/device-capabilities.ts";
import { DeviceCapabilityAccessBroker } from "./device-capability-access-broker.ts";

function input(
  capability: PendingDeviceCapabilityAccess["capability"],
): Omit<PendingDeviceCapabilityAccess, "requestId" | "requestedAt"> {
  return {
    capability,
    action: capability === "wifi" ? "wifi_scan" : "bluetooth_scan",
    projectId: "project-one",
    projectName: "Home lab",
    conversationId: "conversation-one",
    purpose: `Use ${capability} for the current request`,
    dataDescription: `${capability} bounded result`,
  };
}

test("ask approvals are one-shot and expose the exact purpose and data", async () => {
  let sequence = 0;
  const broker = new DeviceCapabilityAccessBroker(
    () => `request-${++sequence}`,
    () => new Date("2026-08-16T01:02:03.000Z"),
  );
  const observed: (string | null)[] = [];
  const unsubscribe = broker.subscribe((request) => {
    observed.push(request?.requestId ?? null);
  });

  const first = broker.request(input("wifi"));
  assert.deepEqual(broker.pending(), {
    ...input("wifi"),
    requestId: "request-1",
    requestedAt: "2026-08-16T01:02:03.000Z",
  });
  broker.approve("request-1");
  assert.equal(await first, true);

  const second = broker.request(input("wifi"));
  assert.equal(broker.pending()?.requestId, "request-2");
  broker.deny("request-2");
  assert.equal(await second, false);
  unsubscribe();

  assert.deepEqual(observed, [null, "request-1", null, "request-2", null]);
});

test("queued requests advance after cancellation and background denial", async () => {
  let sequence = 0;
  const broker = new DeviceCapabilityAccessBroker(
    () => `request-${++sequence}`,
  );
  const controller = new AbortController();
  const first = broker.request(input("wifi"), controller.signal);
  const second = broker.request(input("bluetooth"));

  controller.abort();
  assert.equal(await first, false);
  assert.equal(broker.pending()?.requestId, "request-2");
  broker.denyAll();
  assert.equal(await second, false);
  assert.equal(broker.pending(), null);
});

test("approval requests require a bounded single-line reason", () => {
  const broker = new DeviceCapabilityAccessBroker(() => "request-1");
  assert.throws(
    () => broker.request({ ...input("wifi"), purpose: "  " }),
    /具体用途/u,
  );
  assert.throws(
    () => broker.request({ ...input("wifi"), purpose: "line one\nline two" }),
    /具体用途/u,
  );
});
