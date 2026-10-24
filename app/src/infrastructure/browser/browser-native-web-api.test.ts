import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserNativeWebApi,
  type BrowserNativeWebApiAdapter,
} from "./browser-native-web-api-core.ts";

const position = {
  coords: {
    latitude: 31.2304,
    longitude: 121.4737,
    altitude: null,
    accuracy: 12,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: 1_000,
} as const;

function adapter(
  overrides: Partial<BrowserNativeWebApiAdapter> = {},
): BrowserNativeWebApiAdapter {
  return {
    platform: "android",
    getLocationPermission: async () => ({ status: "granted" }),
    getLocationProviderStatus: async () => ({ networkAvailable: true }),
    enableNetworkProvider: async () => undefined,
    getLastKnownPosition: async () => null,
    watchPosition: async (_options, update) => {
      update(position);
      return { remove() {} };
    },
    readClipboardText: async () => "clipboard text",
    writeClipboardText: async () => true,
    queryPermission: async () => "prompt",
    share: async () => undefined,
    lockOrientation: async () => undefined,
    restoreOrientation: async () => undefined,
    printHtml: async () => undefined,
    scanBarcodes: async () => [],
    ...overrides,
  };
}

test("browser location reuses a permitted recent native position", async () => {
  let watches = 0;
  const api = createBrowserNativeWebApi(
    adapter({
      getLastKnownPosition: async () => position,
      watchPosition: async () => {
        watches += 1;
        return { remove() {} };
      },
    }),
  );

  const result = await api.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 1_000,
    maximumAge: 60_000,
  });

  assert.equal(result.coords.latitude, position.coords.latitude);
  assert.equal(result.coords.longitude, position.coords.longitude);
  assert.equal(watches, 0);
});

test("Android location requests the network provider before a fresh fix", async () => {
  let providerRequests = 0;
  let removals = 0;
  let mayShowUserSettingsDialog: boolean | undefined;
  const api = createBrowserNativeWebApi(
    adapter({
      getLocationProviderStatus: async () => ({ networkAvailable: false }),
      enableNetworkProvider: async () => {
        providerRequests += 1;
      },
      watchPosition: async (options, update) => {
        mayShowUserSettingsDialog = options.mayShowUserSettingsDialog;
        update(position);
        return {
          remove() {
            removals += 1;
          },
        };
      },
    }),
  );

  const result = await api.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 1_000,
    maximumAge: 0,
  });

  assert.equal(result.coords.accuracy, 12);
  assert.equal(providerRequests, 1);
  assert.equal(mayShowUserSettingsDialog, true);
  assert.equal(removals, 1);
});

test("Android continues with GPS only when network-provider resolution is unavailable", async () => {
  let mayShowUserSettingsDialog: boolean | undefined;
  const api = createBrowserNativeWebApi(
    adapter({
      getLocationProviderStatus: async () => ({ networkAvailable: false }),
      enableNetworkProvider: async () => {
        throw new Error("settings resolution unavailable");
      },
      watchPosition: async (options, update) => {
        mayShowUserSettingsDialog = options.mayShowUserSettingsDialog;
        update(position);
        return { remove() {} };
      },
    }),
  );

  const result = await api.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 1_000,
    maximumAge: 0,
  });

  assert.equal(result.coords.accuracy, 12);
  assert.equal(mayShowUserSettingsDialog, false);
});

test("a timed-out native location request always releases its listener", async () => {
  let removals = 0;
  const api = createBrowserNativeWebApi(
    adapter({
      watchPosition: async () => ({
        remove() {
          removals += 1;
        },
      }),
    }),
  );

  await assert.rejects(
    api.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 1,
      maximumAge: 0,
    }),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );
  assert.equal(removals, 1);
});

test("native browser APIs fail closed on permission and clipboard bounds", async () => {
  const api = createBrowserNativeWebApi(
    adapter({
      getLocationPermission: async () => ({ status: "denied" }),
      readClipboardText: async () => "x".repeat(16_001),
    }),
  );

  await assert.rejects(
    api.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 1_000,
      maximumAge: 0,
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "NotAllowedError",
  );
  await assert.rejects(
    api.readClipboardText(),
    (error: unknown) => error instanceof Error && error.name === "DataError",
  );
  await assert.rejects(
    api.writeClipboardText("x".repeat(16_001)),
    (error: unknown) => error instanceof Error && error.name === "DataError",
  );
});

test("native browser API validates permission, share, print, orientation and barcode boundaries", async () => {
  const calls: string[] = [];
  const api = createBrowserNativeWebApi(
    adapter({
      queryPermission: async () => "granted",
      share: async () => calls.push("share") as never,
      lockOrientation: async () => calls.push("orientation") as never,
      printHtml: async () => calls.push("print") as never,
      scanBarcodes: async () => [
        {
          boundingBox: { x: 1, y: 2, width: 30, height: 40 },
          cornerPoints: [{ x: 1, y: 2 }],
          format: "qr_code",
          rawValue: "https://example.com",
        },
      ],
    }),
  );

  assert.equal(await api.queryPermission("camera"), "granted");
  await api.share({ text: "hello" });
  await api.lockOrientation("landscape");
  await api.printHtml("<!doctype html><p>hello</p>");
  const detected = await api.scanBarcodes("data:image/png;base64,aGVsbG8=", [
    "qr_code",
  ]);
  assert.equal(detected[0]?.rawValue, "https://example.com");
  assert.deepEqual(calls, ["share", "orientation", "print"]);
  await assert.rejects(
    api.share({ title: "title only" }),
    (error: unknown) => error instanceof Error && error.name === "TypeError",
  );
  await assert.rejects(
    api.printHtml("x".repeat(512_001)),
    (error: unknown) => error instanceof Error && error.name === "DataError",
  );
});
