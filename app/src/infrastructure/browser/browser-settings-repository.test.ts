import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDurableDocumentStore } from "../persistence/document-store.ts";
import {
  BrowserSettingsRepository,
  DEFAULT_BROWSER_SETTINGS,
  ISOLATED_PREVIEW_BROWSER_SETTINGS,
  READ_ONLY_AGENT_BROWSER_SETTINGS,
  projectPreviewBrowserSettings,
  validateBrowserSettings,
} from "./browser-settings-repository.ts";

test("browser settings default sensitive capabilities off and round-trip exactly", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new BrowserSettingsRepository(store);

  assert.deepEqual(await repository.load(), DEFAULT_BROWSER_SETTINGS);
  assert.equal(DEFAULT_BROWSER_SETTINGS.location, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.camera, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.microphone, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.motionSensors, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.clipboardRead, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.clipboardWrite, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.screenWakeLock, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.vibration, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.autoplayMedia, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.protectedMedia, false);
  assert.equal(DEFAULT_BROWSER_SETTINGS.downloads, true);
  assert.equal(DEFAULT_BROWSER_SETTINGS.screenOrientation, true);
  assert.equal(DEFAULT_BROWSER_SETTINGS.printing, true);
  assert.equal(DEFAULT_BROWSER_SETTINGS.barcodeDetection, true);

  const updated = { ...DEFAULT_BROWSER_SETTINGS, camera: true };
  await repository.save(updated);
  assert.deepEqual(await repository.load(), updated);
});

test("isolated previews intersect declarations and global settings", () => {
  const enabled = {
    ...DEFAULT_BROWSER_SETTINGS,
    camera: true,
    location: true,
    motionSensors: true,
    downloads: true,
    popups: true,
  };
  const preview = projectPreviewBrowserSettings(enabled, [
    "camera",
    "location",
    "motionSensors",
  ]);

  assert.equal(preview.camera, true);
  assert.equal(preview.location, true);
  assert.equal(preview.motionSensors, true);
  assert.equal(preview.downloads, false);
  assert.equal(preview.popups, false);
  assert.equal(preview.externalApps, false);
  assert.equal(
    Object.values(ISOLATED_PREVIEW_BROWSER_SETTINGS).every(
      (enabled) => !enabled,
    ),
    true,
  );
  assert.equal(
    Object.values(READ_ONLY_AGENT_BROWSER_SETTINGS).every(
      (enabled) => !enabled,
    ),
    true,
  );
  assert.deepEqual(
    projectPreviewBrowserSettings(enabled),
    ISOLATED_PREVIEW_BROWSER_SETTINGS,
  );
  assert.equal(
    projectPreviewBrowserSettings(enabled, ["camera"]).location,
    false,
  );
});

test("legacy browser settings are rejected instead of migrated", async () => {
  const store = new InMemoryDurableDocumentStore();
  const {
    motionSensors: _motionSensors,
    clipboardRead: _clipboardRead,
    clipboardWrite: _clipboardWrite,
    screenWakeLock: _screenWakeLock,
    vibration: _vibration,
    ...legacy
  } = DEFAULT_BROWSER_SETTINGS;
  await store.write("browser:settings:v1", JSON.stringify(legacy));
  const repository = new BrowserSettingsRepository(store);

  await assert.rejects(repository.load(), /浏览器设置无效/u);
  assert.equal(await store.read("browser:settings:v1"), JSON.stringify(legacy));
});

test("the immediately previous browser settings gain safe standard API defaults", () => {
  const {
    screenOrientation: _screenOrientation,
    printing: _printing,
    barcodeDetection: _barcodeDetection,
    ...previous
  } = { ...DEFAULT_BROWSER_SETTINGS, camera: true, sharing: false };

  assert.deepEqual(validateBrowserSettings(previous), {
    ...previous,
    screenOrientation: true,
    printing: true,
    barcodeDetection: true,
  });
});

test("browser settings reject missing, unknown and non-boolean fields", () => {
  assert.throws(
    () => validateBrowserSettings({ ...DEFAULT_BROWSER_SETTINGS, camera: 1 }),
    /浏览器设置无效/u,
  );
  const { camera: _camera, ...missing } = DEFAULT_BROWSER_SETTINGS;
  assert.throws(() => validateBrowserSettings(missing), /浏览器设置无效/u);
  assert.throws(
    () => validateBrowserSettings({ ...DEFAULT_BROWSER_SETTINGS, extra: true }),
    /浏览器设置无效/u,
  );
});
