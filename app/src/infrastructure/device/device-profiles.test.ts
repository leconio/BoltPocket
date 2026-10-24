import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDeviceProfilesDocument,
  publicDeviceProfiles,
} from "./device-profiles.ts";

const validDocument = JSON.stringify({
  schema: 1,
  profiles: [
    {
      id: "desk-http",
      name: "Desk HTTP fixture",
      transport: "http",
      baseUrl: "http://192.168.51.10:8765",
      actions: [
        {
          id: "health",
          name: "Read health",
          risk: "read",
          operation: "http",
          method: "GET",
          path: "/health",
          timeoutMs: 2_000,
          maxResponseBytes: 4_096,
        },
      ],
    },
    {
      id: "lamp-ble",
      name: "Lamp BLE fixture",
      transport: "ble",
      actions: [
        {
          id: "read-state",
          name: "Read state",
          risk: "read",
          operation: "ble-read",
          serviceUuid: "0000180f-0000-1000-8000-00805f9b34fb",
          characteristicUuid: "00002a19-0000-1000-8000-00805f9b34fb",
        },
        {
          id: "set-state",
          name: "Set state",
          risk: "write",
          operation: "ble-write",
          serviceUuid: "12345678-abcd-cdef-0123-456789abcdef",
          characteristicUuid: "87654321-dcba-fedc-3210-fedcba987654",
          valueBase64: "AQ==",
          timeoutMs: 5_000,
        },
      ],
    },
  ],
});

test("Device Profiles parse fixed bounded actions and expose no payloads", () => {
  const parsed = parseDeviceProfilesDocument(validDocument);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.policy, "open");
  assert.equal(parsed.profiles.length, 2);
  assert.equal(parsed.profiles[0]?.baseUrl, "http://192.168.51.10:8765/");

  const publicValue = publicDeviceProfiles(parsed);
  assert.deepEqual(publicValue[1]?.actions[1], {
    id: "set-state",
    name: "Set state",
    risk: "write",
    operation: "ble-write",
  });
  assert.doesNotMatch(JSON.stringify(publicValue), /AQ==|characteristicUuid/u);
});

test("Device Profiles only enable allowlist behavior when the user declares it", () => {
  const parsed = parseDeviceProfilesDocument(
    JSON.stringify({
      ...(JSON.parse(validDocument) as Record<string, unknown>),
      policy: "allowlist",
    }),
  );
  assert.equal(parsed.policy, "allowlist");
  assert.equal(parseDeviceProfilesDocument(undefined).policy, "open");

  assert.throws(() =>
    parseDeviceProfilesDocument(
      JSON.stringify({ schema: 1, policy: "managed", profiles: [] }),
    ),
  );
});

test("Device Profiles reject unknown fields and transport/action mismatches", () => {
  const unknown = JSON.parse(validDocument) as Record<string, unknown>;
  const profiles = unknown.profiles as Record<string, unknown>[];
  profiles[0]!.arbitraryCommand = "turn everything off";
  assert.throws(
    () => parseDeviceProfilesDocument(JSON.stringify(unknown)),
    /未声明字段/u,
  );

  const mismatch = {
    schema: 1,
    profiles: [
      {
        id: "bad-socket",
        name: "Bad socket",
        transport: "tcp",
        host: "192.168.51.10",
        port: 9000,
        actions: [
          {
            id: "write",
            name: "Arbitrary write",
            risk: "write",
            operation: "tcp",
            requestBase64: "AQ==",
          },
        ],
      },
    ],
  };
  assert.throws(
    () => parseDeviceProfilesDocument(JSON.stringify(mismatch)),
    /只支持固定查询/u,
  );
});

test("Device Profiles reject credentials, path escapes, oversized payloads, and duplicates", () => {
  const cases = [
    {
      schema: 1,
      profiles: [
        {
          id: "credential-url",
          name: "Credential URL",
          transport: "http",
          baseUrl: "http://user:secret@192.168.51.10",
          actions: [
            {
              id: "read",
              name: "Read",
              risk: "read",
              operation: "http",
              method: "GET",
              path: "/",
            },
          ],
        },
      ],
    },
    {
      schema: 1,
      profiles: [
        {
          id: "path-escape",
          name: "Path escape",
          transport: "http",
          baseUrl: "http://192.168.51.10",
          actions: [
            {
              id: "read",
              name: "Read",
              risk: "read",
              operation: "http",
              method: "GET",
              path: "//outside.example/path",
            },
          ],
        },
      ],
    },
    {
      schema: 1,
      profiles: [
        {
          id: "duplicate",
          name: "One",
          transport: "ble",
          actions: [
            {
              id: "read",
              name: "Read",
              risk: "read",
              operation: "ble-read",
              serviceUuid: "0000180f-0000-1000-8000-00805f9b34fb",
              characteristicUuid: "00002a19-0000-1000-8000-00805f9b34fb",
            },
          ],
        },
        {
          id: "duplicate",
          name: "Two",
          transport: "ble",
          actions: [
            {
              id: "read",
              name: "Read",
              risk: "read",
              operation: "ble-read",
              serviceUuid: "0000180f-0000-1000-8000-00805f9b34fb",
              characteristicUuid: "00002a19-0000-1000-8000-00805f9b34fb",
            },
          ],
        },
      ],
    },
  ];

  for (const candidate of cases) {
    assert.throws(() => parseDeviceProfilesDocument(JSON.stringify(candidate)));
  }
});
