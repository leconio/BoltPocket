import assert from "node:assert/strict";
import test from "node:test";

import { P0_DEVICE_CAPABILITY_POLICIES } from "../../domain/device-capability-catalog.ts";
import { InMemoryDurableDocumentStore } from "../persistence/document-store.ts";
import {
  DeviceCapabilityPolicyController,
  DeviceCapabilitySettingsRepository,
  validateDeviceCapabilitySettings,
} from "./device-capability-settings-repository.ts";

const SETTINGS_KEY = "device-capabilities:settings:v1";

test("device capability settings default safely and round-trip durably", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new DeviceCapabilitySettingsRepository(store);

  assert.equal(await repository.load(), P0_DEVICE_CAPABILITY_POLICIES);
  const changed = Object.freeze({
    ...P0_DEVICE_CAPABILITY_POLICIES,
    location: "deny" as const,
    wifi: "allow" as const,
  });
  await repository.save(changed);

  assert.deepEqual(await repository.load(), changed);
  assert.deepEqual(JSON.parse((await store.read(SETTINGS_KEY))!), changed);
});

test("device capability settings migrate missing keys and reject unknown or invalid policies", async () => {
  assert.throws(() => validateDeviceCapabilitySettings(null), /无效/u);
  assert.deepEqual(
    validateDeviceCapabilitySettings({
      "device-status": "deny",
    }),
    { ...P0_DEVICE_CAPABILITY_POLICIES, "device-status": "deny" },
  );
  assert.throws(
    () =>
      validateDeviceCapabilitySettings({
        ...P0_DEVICE_CAPABILITY_POLICIES,
        wifi: "sometimes",
      }),
    /无效/u,
  );
  assert.throws(
    () =>
      validateDeviceCapabilitySettings({
        ...P0_DEVICE_CAPABILITY_POLICIES,
        hiddenGate: "allow",
      }),
    /无效/u,
  );

  const store = new InMemoryDurableDocumentStore();
  await store.write(SETTINGS_KEY, "not-json");
  await assert.rejects(
    new DeviceCapabilitySettingsRepository(store).load(),
    /无法读取/u,
  );
});

test("concurrent policy changes serialize without dropping another capability", async () => {
  const controller = new DeviceCapabilityPolicyController(
    new DeviceCapabilitySettingsRepository(new InMemoryDurableDocumentStore()),
  );
  const observed: string[] = [];
  const unsubscribe = controller.subscribe((settings) => {
    observed.push(`${settings.location}:${settings.bluetooth}`);
  });

  const [location, bluetooth] = await Promise.all([
    controller.set("location", "deny"),
    controller.set("bluetooth", "allow"),
  ]);
  unsubscribe();

  assert.equal(location.location, "deny");
  assert.deepEqual(bluetooth, {
    ...P0_DEVICE_CAPABILITY_POLICIES,
    location: "deny",
    bluetooth: "allow",
  });
  assert.deepEqual(await controller.load(), bluetooth);
  assert.deepEqual(observed, ["deny:ask", "deny:allow"]);
});
