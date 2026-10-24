import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_SYSTEM_PERMISSION_KEYS,
  BrowserSystemPermissionDeniedError,
  isBrowserSystemPermissionKey,
  normalizeBrowserSystemPermission,
} from "./browser-system-permission-model.ts";

test("only capabilities backed by real platform permission APIs are classified as system permissions", () => {
  assert.deepEqual(BROWSER_SYSTEM_PERMISSION_KEYS, [
    "location",
    "camera",
    "microphone",
  ]);
  assert.equal(isBrowserSystemPermissionKey("camera"), true);
  assert.equal(isBrowserSystemPermissionKey("microphone"), true);
  assert.equal(isBrowserSystemPermissionKey("location"), true);
  assert.equal(isBrowserSystemPermissionKey("fileSelection"), false);
  assert.equal(isBrowserSystemPermissionKey("clipboardRead"), false);
});

test("native permission responses are normalized without treating an unasked permission as denied", () => {
  assert.deepEqual(
    normalizeBrowserSystemPermission({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    }),
    { status: "undetermined", canAskAgain: true },
  );
  assert.deepEqual(
    normalizeBrowserSystemPermission({
      granted: true,
      canAskAgain: false,
      status: "granted",
    }),
    { status: "granted", canAskAgain: false },
  );
});

test("a permanently denied permission directs the user to system settings", () => {
  const error = new BrowserSystemPermissionDeniedError("camera", {
    status: "denied",
    canAskAgain: false,
  });
  assert.equal(error.canAskAgain, false);
  assert.match(error.message, /系统设置/u);
});
