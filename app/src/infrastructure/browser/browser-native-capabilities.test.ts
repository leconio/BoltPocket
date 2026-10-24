import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import {
  DEFAULT_BROWSER_SETTINGS,
  ISOLATED_PREVIEW_BROWSER_SETTINGS,
  projectPreviewBrowserSettings,
} from "./browser-settings-repository.ts";
import {
  createBrowserCapabilityGuardScript,
  createBrowserCapabilityUpdateScript,
  createBrowserPageLifecycleScript,
  shouldEnableBrowserNativeBridge,
} from "./browser-native-capabilities.ts";

test("native platforms expose the brokered bridge to project previews", () => {
  assert.equal(shouldEnableBrowserNativeBridge("ios", true), true);
  assert.equal(shouldEnableBrowserNativeBridge("ios", false), true);
  assert.equal(shouldEnableBrowserNativeBridge("android", true), true);
  assert.equal(shouldEnableBrowserNativeBridge("android", false), true);
  assert.equal(shouldEnableBrowserNativeBridge("web", true), false);
});

test("browser capability guard independently gates native website capabilities", () => {
  const script = createBrowserCapabilityGuardScript({
    ...DEFAULT_BROWSER_SETTINGS,
    camera: true,
    microphone: false,
    fileSelection: false,
    motionSensors: true,
    clipboardRead: false,
    clipboardWrite: true,
    screenWakeLock: false,
    vibration: false,
    popups: false,
  });
  assert.match(script, /"camera":true/u);
  assert.match(script, /"microphone":false/u);
  assert.match(script, /constraints\.video/u);
  assert.match(script, /constraints\.audio/u);
  assert.match(script, /geolocation\.getCurrentPosition/u);
  assert.match(script, /capabilities\.location/u);
  assert.match(script, /capabilities\.motionSensors/u);
  assert.match(script, /DeviceMotionEvent/u);
  assert.match(script, /deviceorientationabsolute/u);
  assert.match(script, /navigator\.clipboard/u);
  assert.match(script, /capabilities\.clipboardRead/u);
  assert.match(script, /capabilities\.clipboardWrite/u);
  assert.match(script, /document\.execCommand/u);
  assert.match(script, /navigator\.vibrate/u);
  assert.match(script, /capabilities\.vibration/u);
  assert.match(script, /navigator\.wakeLock/u);
  assert.match(script, /capabilities\.screenWakeLock/u);
  assert.match(script, /input\[type="file"\]/u);
  assert.match(script, /showPicker/u);
  assert.match(script, /capabilities\.popups/u);
  assert.match(script, /navigator\.share/u);
  assert.match(script, /capabilities\.sharing/u);
  assert.match(script, /capabilities\.fullscreenMedia/u);
  assert.match(script, /capabilities\.pictureInPicture/u);
  assert.match(script, /capabilities\.airPlay/u);
  assert.match(script, /replaceMethod/u);
  assert.match(script, /protect/u);
  assert.doesNotMatch(script, /document\.cookie|localStorage/u);
  assert.doesNotThrow(() => new Script(script));
});

test("browser startup guard has an all-denied fail-closed capability set", () => {
  const script = createBrowserCapabilityGuardScript(
    ISOLATED_PREVIEW_BROWSER_SETTINGS,
  );
  for (const value of Object.values(ISOLATED_PREVIEW_BROWSER_SETTINGS)) {
    assert.equal(value, false);
  }
  assert.doesNotMatch(script, /:true/u);
});

test("project previews block synchronous clipboard commands that cannot be brokered", () => {
  let legacyCalls = 0;
  const document = {
    addEventListener() {},
    documentElement: {
      style: { removeProperty() {}, setProperty() {} },
    },
    execCommand(_command?: string) {
      legacyCalls += 1;
      return true;
    },
    querySelectorAll() {
      return [];
    },
  };
  const navigator = {};
  const window = {
    addEventListener() {},
    clearTimeout,
    dispatchEvent() {},
    document,
    navigator,
    setTimeout,
  } as Record<string, unknown>;
  window.window = window;

  const script = createBrowserCapabilityGuardScript(
    {
      ...DEFAULT_BROWSER_SETTINGS,
      clipboardRead: true,
      clipboardWrite: true,
    },
    {
      capabilityConsent: true,
      location: false,
      clipboardText: false,
      permissions: false,
      sharing: false,
      screenOrientation: false,
      printing: false,
      barcodeFormats: [],
    },
    "0123456789abcdef0123456789abcdef",
  );
  new Script(script).runInNewContext({
    DOMException,
    Element: undefined,
    HTMLInputElement: undefined,
    HTMLVideoElement: undefined,
    document,
    navigator,
    window,
  });

  assert.equal(document.execCommand("copy"), false);
  assert.equal(document.execCommand("cut"), false);
  assert.equal(document.execCommand("paste"), false);
  assert.equal(legacyCalls, 0);
  assert.equal(document.execCommand("bold"), true);
  assert.equal(legacyCalls, 1);
});

test("project preview guard receives user-enabled native capabilities", () => {
  const settings = projectPreviewBrowserSettings(
    {
      ...DEFAULT_BROWSER_SETTINGS,
      camera: true,
      microphone: true,
      location: true,
      motionSensors: true,
    },
    ["camera", "microphone", "location", "motionSensors"],
  );
  const script = createBrowserCapabilityGuardScript(settings);

  assert.match(script, /"camera":true/u);
  assert.match(script, /"microphone":true/u);
  assert.match(script, /"location":true/u);
  assert.match(script, /"motionSensors":true/u);
  assert.match(script, /"downloads":false/u);
  assert.match(script, /"popups":false/u);
  assert.match(script, /"externalApps":false/u);
});

test("project preview capabilities require declaration and browser authorization", () => {
  const global = {
    ...DEFAULT_BROWSER_SETTINGS,
    camera: true,
    location: true,
    sharing: true,
  };
  assert.equal(
    projectPreviewBrowserSettings(global, ["location"]).camera,
    false,
  );
  const granted = projectPreviewBrowserSettings(global, ["camera", "location"]);
  assert.equal(granted.camera, true);
  assert.equal(granted.location, true);
  assert.equal(granted.sharing, false);
  assert.equal(granted.downloads, false);
  assert.equal(granted.externalApps, false);
});

test("Android browser bridge routes standard location and text clipboard APIs", async () => {
  const token = "0123456789abcdef0123456789abcdef";
  const posts: string[] = [];
  const window = {
    ReactNativeWebView: {
      postMessage(value: string) {
        posts.push(value);
      },
    },
    addEventListener() {},
    clearTimeout,
    open() {},
    setTimeout,
  } as Record<string, unknown>;
  const navigator = {
    clipboard: {
      async read() {},
      async readText() {
        return "web value";
      },
      async write() {},
      async writeText() {},
    },
    geolocation: {
      clearWatch() {},
      getCurrentPosition() {},
      watchPosition() {
        return 99;
      },
    },
    userActivation: { isActive: true },
  };
  const document = {
    addEventListener() {},
  };
  window.window = window;
  window.navigator = navigator;
  window.document = document;

  const script = createBrowserCapabilityGuardScript(
    {
      ...DEFAULT_BROWSER_SETTINGS,
      location: true,
      clipboardRead: true,
      clipboardWrite: true,
    },
    {
      location: true,
      clipboardText: true,
      permissions: true,
      sharing: true,
      screenOrientation: true,
      printing: true,
      barcodeFormats: ["qr_code"],
    },
    token,
  );
  new Script(script).runInNewContext({
    DOMException,
    Element: undefined,
    HTMLInputElement: undefined,
    HTMLVideoElement: undefined,
    document,
    navigator,
    window,
  });

  const location = new Promise<unknown>((resolve, reject) => {
    const getCurrentPosition = navigator.geolocation
      .getCurrentPosition as unknown as (
      success: (value: unknown) => void,
      failure: (error: unknown) => void,
      options: object,
    ) => void;
    getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: Infinity,
      timeout: 2_500,
    });
  });
  const locationRequest = JSON.parse(posts.shift()!);
  assert.equal(locationRequest.operation, "location-current");
  assert.equal(locationRequest.bridgeToken, token);
  assert.deepEqual(locationRequest.options, {
    enableHighAccuracy: true,
    maximumAge: -1,
    timeout: 2_500,
  });
  const resolveNativeRequest = window.__boltpocketResolveNativeRequest as (
    requestId: string,
    response: unknown,
  ) => void;
  resolveNativeRequest(locationRequest.requestId, {
    ok: true,
    result: { coords: { latitude: 1, longitude: 2 } },
  });
  assert.deepEqual(await location, {
    coords: { latitude: 1, longitude: 2 },
  });

  const writeText = navigator.clipboard.writeText as unknown as (
    text: string,
  ) => Promise<void>;
  const clipboard = writeText("safe text");
  const clipboardRequest = JSON.parse(posts.shift()!);
  assert.equal(clipboardRequest.operation, "clipboard-write-text");
  assert.equal(clipboardRequest.text, "safe text");
  resolveNativeRequest(clipboardRequest.requestId, { ok: true, result: null });
  await clipboard;
});

test("live capability updates carry only fixed boolean settings", () => {
  const script = createBrowserCapabilityUpdateScript(DEFAULT_BROWSER_SETTINGS);
  assert.match(script, /window\.__boltpocketNativeCapabilities/u);
  assert.match(script, /__boltpocketRefreshPermissionStates/u);
  assert.doesNotMatch(script, /undefined/u);
});

test("inactive user pages stop media capabilities without destroying page execution", () => {
  const guard = createBrowserCapabilityGuardScript(DEFAULT_BROWSER_SETTINGS);
  const pause = createBrowserPageLifecycleScript(false);
  const resume = createBrowserPageLifecycleScript(true);

  assert.match(guard, /__boltpocketSetPageActive/u);
  assert.match(guard, /querySelectorAll\("audio, video"\)/u);
  assert.match(guard, /activeMediaStreams/u);
  assert.match(guard, /activeWakeLocks/u);
  assert.match(guard, /location-watch-stop/u);
  assert.match(guard, /sentinel\.release\(\)/u);
  assert.match(guard, /navigator\.vibrate\?\.\(0\)/u);
  assert.match(guard, /document\.exitFullscreen/u);
  assert.match(guard, /document\.exitPictureInPicture/u);
  assert.match(
    guard,
    /__boltpocketSessionCapabilityGrants = Object\.create\(null\)/u,
  );
  assert.match(guard, /animation-play-state:paused/u);
  assert.doesNotMatch(guard, /pauseTimers|onPause\(\)|window\.fetch\s*=/u);
  assert.match(pause, /update\(false\)/u);
  assert.match(resume, /update\(true\)/u);
  assert.doesNotThrow(() => new Script(pause));
  assert.doesNotThrow(() => new Script(resume));
});

test("a page can start inactive before its first load event", () => {
  const script = createBrowserCapabilityGuardScript(
    DEFAULT_BROWSER_SETTINGS,
    undefined,
    null,
    false,
  );

  assert.match(script, /const initiallyPageActive = false/u);
  assert.match(script, /__boltpocketSetPageActive\(initiallyPageActive\)/u);
});

test("standard API fallbacks route permissions, share, orientation, print and barcode detection", async () => {
  const token = "0123456789abcdef0123456789abcdef";
  const posts: Record<string, unknown>[] = [];
  const window = {
    addEventListener() {},
    clearTimeout,
    dispatchEvent() {},
    innerHeight: 800,
    innerWidth: 400,
    location: { href: "https://example.com/page" },
    open() {},
    setTimeout,
  } as Record<string, unknown>;
  class EmptyNativeBarcodeDetector {
    static getSupportedFormats() {
      return Promise.resolve([]);
    }

    detect() {
      return Promise.resolve([]);
    }
  }
  window.BarcodeDetector = EmptyNativeBarcodeDetector;
  window.window = window;
  window.top = window;
  window.ReactNativeWebView = {
    postMessage(value: string) {
      posts.push(JSON.parse(value) as Record<string, unknown>);
    },
  };
  const navigator = { userActivation: { isActive: true } } as Record<
    string,
    unknown
  >;
  const screen = { orientation: {} } as Record<string, unknown>;
  const canvas = {
    getContext() {
      return { drawImage() {}, putImageData() {} };
    },
    height: 0,
    toDataURL() {
      return "data:image/jpeg;base64,aGVsbG8=";
    },
    width: 0,
  };
  const document = {
    addEventListener() {},
    createElement(name: string) {
      assert.equal(name, "canvas");
      return { ...canvas };
    },
    doctype: { name: "html" },
    documentElement: { outerHTML: "<html><head></head><body>ok</body></html>" },
  };
  window.navigator = navigator;
  window.screen = screen;
  window.document = document;

  const script = createBrowserCapabilityGuardScript(
    {
      ...DEFAULT_BROWSER_SETTINGS,
      camera: true,
      sharing: true,
      screenOrientation: true,
      printing: true,
      barcodeDetection: true,
    },
    {
      location: false,
      clipboardText: false,
      permissions: true,
      sharing: true,
      screenOrientation: true,
      printing: true,
      barcodeFormats: ["qr_code"],
    },
    token,
  );
  new Script(script).runInNewContext({
    DOMException,
    Element: undefined,
    Event,
    File: undefined,
    HTMLInputElement: undefined,
    HTMLVideoElement: undefined,
    ImageData: undefined,
    URL,
    document,
    location: window.location,
    navigator,
    screen,
    window,
  });
  const resolveNativeRequest = window.__boltpocketResolveNativeRequest as (
    requestId: string,
    response: unknown,
  ) => void;

  const permissions = navigator.permissions as {
    query(value: { name: string }): Promise<{ state: string }>;
  };
  const permission = permissions.query({ name: "camera" });
  const permissionRequest = posts.shift()!;
  assert.equal(permissionRequest.operation, "permission-query");
  resolveNativeRequest(permissionRequest.requestId as string, {
    ok: true,
    result: "granted",
  });
  assert.equal((await permission).state, "granted");

  const share = (navigator.share as (data: object) => Promise<void>)({
    text: "hello",
  });
  const shareRequest = posts.shift()!;
  assert.equal(shareRequest.operation, "share");
  resolveNativeRequest(shareRequest.requestId as string, {
    ok: true,
    result: null,
  });
  await share;

  const orientation = screen.orientation as {
    lock(value: string): Promise<void>;
  };
  const lock = orientation.lock("landscape");
  const orientationRequest = posts.shift()!;
  assert.equal(orientationRequest.operation, "orientation-lock");
  resolveNativeRequest(orientationRequest.requestId as string, {
    ok: true,
    result: null,
  });
  await lock;

  (window.print as () => void)();
  const printRequest = posts.shift()!;
  assert.equal(printRequest.operation, "print-html");
  assert.match(
    printRequest.html as string,
    /<base href="https:\/\/example\.com\/page">/u,
  );
  resolveNativeRequest(printRequest.requestId as string, {
    ok: true,
    result: null,
  });

  const BarcodeDetector = window.BarcodeDetector as {
    new (value: { formats: string[] }): {
      detect(source: object): Promise<unknown[]>;
    };
    getSupportedFormats(): Promise<string[]>;
  };
  assert.notEqual(BarcodeDetector, EmptyNativeBarcodeDetector);
  assert.deepEqual(
    [...(await BarcodeDetector.getSupportedFormats())],
    ["qr_code"],
  );
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const detected = detector.detect({ height: 100, width: 100 });
  await Promise.resolve();
  await Promise.resolve();
  const barcodeRequest = posts.shift()!;
  assert.equal(barcodeRequest.operation, "barcode-detect");
  resolveNativeRequest(barcodeRequest.requestId as string, {
    ok: true,
    result: [{ format: "qr_code", rawValue: "hello" }],
  });
  assert.deepEqual(await detected, [{ format: "qr_code", rawValue: "hello" }]);

  const videoDetected = detector.detect({ videoHeight: 360, videoWidth: 640 });
  await Promise.resolve();
  await Promise.resolve();
  const videoBarcodeRequest = posts.shift()!;
  assert.equal(videoBarcodeRequest.operation, "barcode-detect");
  resolveNativeRequest(videoBarcodeRequest.requestId as string, {
    ok: true,
    result: [{ format: "qr_code", rawValue: "video frame" }],
  });
  assert.deepEqual(await videoDetected, [
    { format: "qr_code", rawValue: "video frame" },
  ]);
});
