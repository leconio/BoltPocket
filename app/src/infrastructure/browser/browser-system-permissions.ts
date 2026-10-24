import { Camera } from "expo-camera";
import {
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
import { Linking, Platform } from "react-native";

import {
  normalizeBrowserSystemPermission,
  type BrowserSystemPermissionKey,
  type BrowserSystemPermissionState,
} from "./browser-system-permission-model.ts";

export {
  BROWSER_SYSTEM_PERMISSION_KEYS,
  BrowserSystemPermissionDeniedError,
  isBrowserSystemPermissionKey,
} from "./browser-system-permission-model.ts";
export type {
  BrowserSystemPermissionKey,
  BrowserSystemPermissionState,
  BrowserSystemPermissionStatus,
} from "./browser-system-permission-model.ts";

export async function getBrowserSystemPermission(
  key: BrowserSystemPermissionKey,
): Promise<BrowserSystemPermissionState> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return Object.freeze({ status: "unavailable", canAskAgain: false });
  }
  if (key === "camera") {
    return normalizeBrowserSystemPermission(
      await Camera.getCameraPermissionsAsync(),
    );
  }
  if (key === "microphone") {
    return normalizeBrowserSystemPermission(
      await Camera.getMicrophonePermissionsAsync(),
    );
  }
  return normalizeBrowserSystemPermission(
    await getForegroundPermissionsAsync(),
  );
}

export async function requestBrowserSystemPermission(
  key: BrowserSystemPermissionKey,
): Promise<BrowserSystemPermissionState> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return Object.freeze({ status: "unavailable", canAskAgain: false });
  }
  if (key === "camera") {
    return normalizeBrowserSystemPermission(
      await Camera.requestCameraPermissionsAsync(),
    );
  }
  if (key === "microphone") {
    return normalizeBrowserSystemPermission(
      await Camera.requestMicrophonePermissionsAsync(),
    );
  }
  return normalizeBrowserSystemPermission(
    await requestForegroundPermissionsAsync(),
  );
}

export async function openBrowserSystemSettings() {
  await Linking.openSettings();
}
