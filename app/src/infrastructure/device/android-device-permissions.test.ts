import assert from "node:assert/strict";
import test from "node:test";

import { androidBluetoothPermissionNames } from "./android-device-permissions.ts";

test("Android 12 and newer request both nearby-device Bluetooth permissions", () => {
  assert.deepEqual(androidBluetoothPermissionNames(31), [
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.BLUETOOTH_CONNECT",
  ]);
  assert.deepEqual(androidBluetoothPermissionNames(35), [
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.BLUETOOTH_CONNECT",
  ]);
});

test("older Android BLE scans use foreground location permission", () => {
  assert.deepEqual(androidBluetoothPermissionNames(30), [
    "android.permission.ACCESS_FINE_LOCATION",
  ]);
});
