import type { BrowserCapabilityKey } from "./browser-settings-repository.ts";

export type BrowserSystemPermissionKey = "camera" | "location" | "microphone";

export type BrowserSystemPermissionStatus =
  "granted" | "denied" | "undetermined" | "unavailable";

export type BrowserSystemPermissionState = Readonly<{
  status: BrowserSystemPermissionStatus;
  canAskAgain: boolean;
}>;

export class BrowserSystemPermissionDeniedError extends Error {
  readonly key: BrowserSystemPermissionKey;
  readonly canAskAgain: boolean;

  constructor(
    key: BrowserSystemPermissionKey,
    permission: BrowserSystemPermissionState,
  ) {
    const label =
      key === "camera" ? "相机" : key === "microphone" ? "麦克风" : "位置";
    super(
      permission.canAskAgain
        ? `没有获得${label}系统权限。`
        : `${label}系统权限已关闭，请前往系统设置开启。`,
    );
    this.name = "BrowserSystemPermissionDeniedError";
    this.key = key;
    this.canAskAgain = permission.canAskAgain;
  }
}

export const BROWSER_SYSTEM_PERMISSION_KEYS = [
  "location",
  "camera",
  "microphone",
] as const satisfies readonly BrowserSystemPermissionKey[];

export function normalizeBrowserSystemPermission(
  permission: Readonly<{
    granted: boolean;
    canAskAgain: boolean;
    status: string;
  }>,
): BrowserSystemPermissionState {
  return Object.freeze({
    status: permission.granted
      ? "granted"
      : permission.status === "denied"
        ? "denied"
        : "undetermined",
    canAskAgain: permission.canAskAgain,
  });
}

export function isBrowserSystemPermissionKey(
  key: BrowserCapabilityKey,
): key is BrowserSystemPermissionKey {
  return BROWSER_SYSTEM_PERMISSION_KEYS.some((candidate) => candidate === key);
}
