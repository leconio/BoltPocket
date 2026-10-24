import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDeviceCapabilityInput } from "../../application/ports/device-capabilities.ts";
import {
  assertDirectDeviceOperationAllowed,
  normalizeBluetoothUuid,
  parseDirectDeviceOperation,
} from "./device-direct-operations.ts";
import { parseDeviceProfilesDocument } from "./device-profiles.ts";

const purpose = "Use the exact device selected by the user";
const deviceId = "ble-0123456789abcdef01234567";

function direct(input: Omit<AgentDeviceCapabilityInput, "purpose">) {
  return parseDirectDeviceOperation({ ...input, purpose });
}

test("dynamic BLE operations accept discovered UUIDs and UTF-8 payloads without a profile", () => {
  assert.equal(
    normalizeBluetoothUuid("0xFEE7"),
    "0000fee7-0000-1000-8000-00805f9b34fb",
  );
  const operation = direct({
    action: "bluetooth_write",
    deviceId,
    serviceUuid: "fee7",
    characteristicUuid: "0000FEC7",
    valueText: "PRINT\r\n",
  });
  assert.deepEqual(operation, {
    action: "bluetooth_write",
    deviceId,
    serviceUuid: "0000fee7-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "0000fec7-0000-1000-8000-00805f9b34fb",
    valueBase64: "UFJJTlQNCg==",
    timeoutMs: 10_000,
  });
  assert.doesNotThrow(() =>
    assertDirectDeviceOperationAllowed(
      parseDeviceProfilesDocument(undefined),
      operation,
    ),
  );
});

test("dynamic local HTTP/TCP/UDP targets are accepted by default and remain bounded", () => {
  const http = direct({
    action: "http_request",
    url: "http://192.168.51.20:8080/state",
  });
  assert.deepEqual(http, {
    action: "http_request",
    url: "http://192.168.51.20:8080/state",
    method: "GET",
    maxResponseBytes: 65_536,
    timeoutMs: 8_000,
  });

  const tcp = direct({
    action: "tcp_exchange",
    host: "printer.local",
    port: 9_100,
    requestText: "~HS\r\n",
  });
  assert.equal(tcp.action, "tcp_exchange");
  assert.equal(tcp.requestBase64, "fkhTDQo=");
  assert.doesNotThrow(() =>
    assertDirectDeviceOperationAllowed(
      parseDeviceProfilesDocument(undefined),
      tcp,
    ),
  );
});

test("only an explicit user-created allowlist restricts dynamic communication", () => {
  const document = parseDeviceProfilesDocument(
    JSON.stringify({
      schema: 1,
      policy: "allowlist",
      profiles: [
        {
          id: "printer",
          name: "Printer",
          transport: "ble",
          actions: [
            {
              id: "print-test",
              name: "Print test",
              risk: "write",
              operation: "ble-write",
              serviceUuid: "0000fee7-0000-1000-8000-00805f9b34fb",
              characteristicUuid: "0000fec7-0000-1000-8000-00805f9b34fb",
              valueBase64: "AQ==",
            },
          ],
        },
      ],
    }),
  );
  const allowed = direct({
    action: "bluetooth_write",
    deviceId,
    serviceUuid: "fee7",
    characteristicUuid: "fec7",
    valueBase64: "AQ==",
  });
  const denied = direct({
    action: "bluetooth_write",
    deviceId,
    serviceUuid: "fee7",
    characteristicUuid: "fec7",
    valueBase64: "Ag==",
  });
  assert.doesNotThrow(() =>
    assertDirectDeviceOperationAllowed(document, allowed),
  );
  assert.throws(
    () => assertDirectDeviceOperationAllowed(document, denied),
    /用户创建.*allowlist/u,
  );
});

test("dynamic operation validation rejects ambiguous, oversized, and malformed inputs", () => {
  assert.throws(
    () =>
      direct({
        action: "bluetooth_write",
        deviceId,
        serviceUuid: "fee7",
        characteristicUuid: "fec7",
        valueBase64: "AQ==",
        valueText: "also supplied",
      }),
    /只能提供/u,
  );
  assert.throws(
    () =>
      direct({
        action: "udp_exchange",
        host: "public.example/path",
        port: 53,
        requestBase64: "AQ==",
      }),
    /主机无效/u,
  );
  assert.throws(
    () =>
      direct({
        action: "bluetooth_read",
        deviceId: "hardware-address",
        serviceUuid: "fee7",
        characteristicUuid: "fec7",
      }),
    /临时设备 ID/u,
  );
});
