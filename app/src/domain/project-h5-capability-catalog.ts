/**
 * The single source of truth for every native capability exposed to a project
 * H5 app. Manifest validation, Browser Settings and the consent UI must all
 * consume this catalog rather than maintaining independent capability lists.
 */
export const PROJECT_H5_PERMISSION_KEYS = [
  "location",
  "camera",
  "microphone",
  "fileSelection",
  "motionSensors",
  "clipboardRead",
  "clipboardWrite",
  "sharing",
  "fullscreenMedia",
  "autoplayMedia",
  "screenWakeLock",
  "vibration",
  "pictureInPicture",
  "airPlay",
  "protectedMedia",
  "screenOrientation",
  "printing",
  "barcodeDetection",
] as const;

export type ProjectH5Permission = (typeof PROJECT_H5_PERMISSION_KEYS)[number];

export const PROJECT_H5_PERMISSION_MODES = ["once", "session"] as const;

export type ProjectH5PermissionMode =
  (typeof PROJECT_H5_PERMISSION_MODES)[number];

export type ProjectH5CapabilityDefinition = Readonly<{
  id: ProjectH5Permission;
  mode: ProjectH5PermissionMode;
  labelKey:
    | "settings.browser.permission.location"
    | "settings.browser.permission.camera"
    | "settings.browser.permission.microphone"
    | "settings.browser.permission.fileSelection"
    | "settings.browser.permission.motion"
    | "settings.browser.permission.clipboardRead"
    | "settings.browser.permission.clipboardWrite"
    | "settings.browser.feature.sharing"
    | "settings.browser.feature.fullscreenMedia"
    | "settings.browser.feature.autoplay"
    | "settings.browser.feature.keepAwake"
    | "settings.browser.feature.vibration"
    | "settings.browser.feature.pictureInPicture"
    | "settings.browser.feature.airPlay"
    | "settings.browser.feature.protectedMedia"
    | "settings.browser.feature.screenOrientation"
    | "settings.browser.feature.printing"
    | "settings.browser.permission.qrCode";
}>;

export const PROJECT_H5_CAPABILITY_CATALOG = Object.freeze({
  location: {
    id: "location",
    mode: "once",
    labelKey: "settings.browser.permission.location",
  },
  camera: {
    id: "camera",
    mode: "once",
    labelKey: "settings.browser.permission.camera",
  },
  microphone: {
    id: "microphone",
    mode: "once",
    labelKey: "settings.browser.permission.microphone",
  },
  fileSelection: {
    id: "fileSelection",
    mode: "once",
    labelKey: "settings.browser.permission.fileSelection",
  },
  motionSensors: {
    id: "motionSensors",
    mode: "session",
    labelKey: "settings.browser.permission.motion",
  },
  clipboardRead: {
    id: "clipboardRead",
    mode: "once",
    labelKey: "settings.browser.permission.clipboardRead",
  },
  clipboardWrite: {
    id: "clipboardWrite",
    mode: "once",
    labelKey: "settings.browser.permission.clipboardWrite",
  },
  sharing: {
    id: "sharing",
    mode: "once",
    labelKey: "settings.browser.feature.sharing",
  },
  fullscreenMedia: {
    id: "fullscreenMedia",
    mode: "session",
    labelKey: "settings.browser.feature.fullscreenMedia",
  },
  autoplayMedia: {
    id: "autoplayMedia",
    mode: "session",
    labelKey: "settings.browser.feature.autoplay",
  },
  screenWakeLock: {
    id: "screenWakeLock",
    mode: "session",
    labelKey: "settings.browser.feature.keepAwake",
  },
  vibration: {
    id: "vibration",
    mode: "session",
    labelKey: "settings.browser.feature.vibration",
  },
  pictureInPicture: {
    id: "pictureInPicture",
    mode: "session",
    labelKey: "settings.browser.feature.pictureInPicture",
  },
  airPlay: {
    id: "airPlay",
    mode: "session",
    labelKey: "settings.browser.feature.airPlay",
  },
  protectedMedia: {
    id: "protectedMedia",
    mode: "session",
    labelKey: "settings.browser.feature.protectedMedia",
  },
  screenOrientation: {
    id: "screenOrientation",
    mode: "session",
    labelKey: "settings.browser.feature.screenOrientation",
  },
  printing: {
    id: "printing",
    mode: "once",
    labelKey: "settings.browser.feature.printing",
  },
  barcodeDetection: {
    id: "barcodeDetection",
    mode: "once",
    labelKey: "settings.browser.permission.qrCode",
  },
} satisfies Record<ProjectH5Permission, ProjectH5CapabilityDefinition>);

export const PROJECT_H5_PERMISSION_MODE = Object.freeze(
  Object.fromEntries(
    PROJECT_H5_PERMISSION_KEYS.map((id) => [
      id,
      PROJECT_H5_CAPABILITY_CATALOG[id].mode,
    ]),
  ) as Record<ProjectH5Permission, ProjectH5PermissionMode>,
);

export function projectH5CapabilityDefinition(id: ProjectH5Permission) {
  return PROJECT_H5_CAPABILITY_CATALOG[id];
}
