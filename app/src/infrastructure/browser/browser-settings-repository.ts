import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";
import {
  PROJECT_H5_PERMISSION_KEYS,
  type ProjectH5Permission,
} from "@/domain/project-h5-manifest";

const BROWSER_SETTINGS_KEY = "browser:settings:v1";

export const BROWSER_CAPABILITY_KEYS = [
  ...PROJECT_H5_PERMISSION_KEYS,
  "downloads",
  "externalApps",
  "popups",
] as const;

const ADDED_STANDARD_WEB_API_KEYS = [
  "screenOrientation",
  "printing",
  "barcodeDetection",
] as const;

export type BrowserCapabilityKey = (typeof BROWSER_CAPABILITY_KEYS)[number];

export type BrowserSettings = Readonly<Record<BrowserCapabilityKey, boolean>>;

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = Object.freeze({
  location: false,
  camera: false,
  microphone: false,
  fileSelection: true,
  motionSensors: false,
  clipboardRead: false,
  clipboardWrite: false,
  downloads: true,
  externalApps: true,
  sharing: true,
  popups: true,
  fullscreenMedia: true,
  autoplayMedia: false,
  screenWakeLock: false,
  vibration: false,
  pictureInPicture: true,
  airPlay: true,
  protectedMedia: false,
  screenOrientation: true,
  printing: true,
  barcodeDetection: true,
});

export const ISOLATED_PREVIEW_BROWSER_SETTINGS: BrowserSettings = Object.freeze(
  Object.fromEntries(
    BROWSER_CAPABILITY_KEYS.map((key) => [key, false]),
  ) as Record<BrowserCapabilityKey, boolean>,
);

export const READ_ONLY_AGENT_BROWSER_SETTINGS =
  ISOLATED_PREVIEW_BROWSER_SETTINGS;

const PROJECT_PREVIEW_ALWAYS_DISABLED = new Set<BrowserCapabilityKey>([
  "downloads",
  "externalApps",
  "popups",
]);

/**
 * A project preview remains cookie- and navigation-isolated, but may use the
 * globally enabled native Web APIs only after the current H5 declares them.
 * Browser Settings is the durable upper bound; the per-mini-app broker still
 * obtains content-bound consent before dispatch. Navigation escape, downloads
 * and popups remain outside the immutable preview boundary.
 */
export function projectPreviewBrowserSettings(
  settings: BrowserSettings,
  permissions: readonly ProjectH5Permission[] = [],
): BrowserSettings {
  const declared = new Set<string>(permissions);
  return Object.freeze(
    Object.fromEntries(
      BROWSER_CAPABILITY_KEYS.map((key) => [
        key,
        !PROJECT_PREVIEW_ALWAYS_DISABLED.has(key) &&
          declared.has(key) &&
          settings[key],
      ]),
    ) as Record<BrowserCapabilityKey, boolean>,
  );
}

export function validateBrowserSettings(value: unknown): BrowserSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("浏览器设置无效。");
  }
  const candidate = value as Record<string, unknown>;
  const candidateKeys = Object.keys(candidate);
  const knownKeys = new Set<string>(BROWSER_CAPABILITY_KEYS);
  const missingKeys = BROWSER_CAPABILITY_KEYS.filter(
    (key) => !(key in candidate),
  );
  const isPreviousVersion =
    missingKeys.length === ADDED_STANDARD_WEB_API_KEYS.length &&
    missingKeys.every((key) =>
      ADDED_STANDARD_WEB_API_KEYS.some((candidate) => candidate === key),
    );
  if (
    candidateKeys.some((key) => !knownKeys.has(key)) ||
    (!isPreviousVersion && missingKeys.length > 0) ||
    BROWSER_CAPABILITY_KEYS.some(
      (key) => key in candidate && typeof candidate[key] !== "boolean",
    )
  ) {
    throw new Error("浏览器设置无效。");
  }
  return Object.freeze(
    Object.fromEntries(
      BROWSER_CAPABILITY_KEYS.map((key) => [
        key,
        key in candidate ? candidate[key] : DEFAULT_BROWSER_SETTINGS[key],
      ]),
    ) as Record<BrowserCapabilityKey, boolean>,
  );
}

export class BrowserSettingsRepository {
  readonly #store: DurableDocumentStore;

  constructor(store: DurableDocumentStore) {
    this.#store = store;
  }

  async load(): Promise<BrowserSettings> {
    const stored = await this.#store.read(BROWSER_SETTINGS_KEY);
    if (stored === undefined) return DEFAULT_BROWSER_SETTINGS;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error("本机浏览器设置无法读取。");
    }
    return validateBrowserSettings(parsed);
  }

  async save(settings: BrowserSettings): Promise<void> {
    await this.#store.write(
      BROWSER_SETTINGS_KEY,
      JSON.stringify(validateBrowserSettings(settings)),
    );
    await this.#store.flush();
  }
}
