import {
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
import {
  getCalendarPermissions,
  getRemindersPermissions,
  requestCalendarPermissions,
  requestRemindersPermissions,
} from "expo-calendar";
import { requestNotificationPermissionsAsync } from "expo-audio";
import { DeviceMotion } from "expo-sensors";
import {
  Linking,
  PermissionsAndroid,
  Platform,
  type Permission,
} from "react-native";

import type { DeviceCapabilityId } from "@/application/ports/device-capabilities";
import { androidBluetoothPermissionNames } from "@/infrastructure/device/android-device-permissions";

export type DeviceSystemPermissionState = Readonly<{
  status:
    "granted" | "denied" | "undetermined" | "unavailable" | "not-required";
  canAskAgain: boolean;
}>;

export class DeviceSystemPermissionDeniedError extends Error {
  readonly capability: DeviceCapabilityId;
  readonly canAskAgain: boolean;

  constructor(
    capability: DeviceCapabilityId,
    state: DeviceSystemPermissionState,
  ) {
    super(
      state.canAskAgain
        ? "没有获得所需的系统权限。"
        : "系统权限已关闭，请前往系统设置开启。",
    );
    this.name = "DeviceSystemPermissionDeniedError";
    this.capability = capability;
    this.canAskAgain = state.canAskAgain;
  }
}

export async function getDeviceSystemPermission(
  capability: DeviceCapabilityId,
): Promise<DeviceSystemPermissionState> {
  if (capability === "location" || capability === "wifi") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    const permission = await getForegroundPermissionsAsync();
    const locationState: DeviceSystemPermissionState = {
      status: permission.granted
        ? "granted"
        : permission.status === "denied"
          ? "denied"
          : "undetermined",
      canAskAgain: permission.canAskAgain,
    };
    if (
      capability !== "wifi" ||
      Platform.OS !== "android" ||
      Number(Platform.Version) < 33 ||
      locationState.status !== "granted"
    ) {
      return locationState;
    }
    const nearbyGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
    );
    return nearbyGranted
      ? locationState
      : { status: "undetermined", canAskAgain: true };
  }
  if (capability === "bluetooth") {
    if (Platform.OS !== "android") return unavailable();
    const permissions = bluetoothPermissions();
    if (permissions.length === 0) return notRequired();
    const grants = await Promise.all(
      permissions.map((permission) => PermissionsAndroid.check(permission)),
    );
    return grants.every(Boolean)
      ? { status: "granted", canAskAgain: true }
      : { status: "undetermined", canAskAgain: true };
  }
  if (capability === "calendar") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    return permissionState(await getCalendarPermissions(false));
  }
  if (capability === "reminders") {
    if (Platform.OS !== "ios") return unavailable();
    return permissionState(await getRemindersPermissions());
  }
  if (capability === "sensors") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    return permissionState(await DeviceMotion.getPermissionsAsync());
  }
  if (capability === "audio") {
    if (Platform.OS === "ios") return notRequired();
    if (Platform.OS !== "android") return unavailable();
    if (Number(Platform.Version) < 33) return notRequired();
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted
      ? { status: "granted", canAskAgain: true }
      : { status: "undetermined", canAskAgain: true };
  }
  return notRequired();
}

export async function requestDeviceSystemPermission(
  capability: DeviceCapabilityId,
): Promise<DeviceSystemPermissionState> {
  if (capability === "location" || capability === "wifi") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    const permission = await requestForegroundPermissionsAsync();
    const locationState: DeviceSystemPermissionState = {
      status: permission.granted ? "granted" : "denied",
      canAskAgain: permission.canAskAgain,
    };
    if (
      capability !== "wifi" ||
      Platform.OS !== "android" ||
      Number(Platform.Version) < 33 ||
      locationState.status !== "granted"
    ) {
      return locationState;
    }
    const nearby = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
    );
    return nearby === PermissionsAndroid.RESULTS.GRANTED
      ? locationState
      : {
          status: "denied",
          canAskAgain: nearby !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
        };
  }
  if (capability === "bluetooth") {
    if (Platform.OS !== "android") return unavailable();
    const permissions = bluetoothPermissions();
    if (permissions.length === 0) return notRequired();
    const grants = await PermissionsAndroid.requestMultiple(permissions);
    const values = permissions.map((permission) => grants[permission]);
    const granted = values.every(
      (value) => value === PermissionsAndroid.RESULTS.GRANTED,
    );
    const canAskAgain = values.every(
      (value) => value !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );
    return { status: granted ? "granted" : "denied", canAskAgain };
  }
  if (capability === "calendar") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    return permissionState(await requestCalendarPermissions(false));
  }
  if (capability === "reminders") {
    if (Platform.OS !== "ios") return unavailable();
    return permissionState(await requestRemindersPermissions());
  }
  if (capability === "sensors") {
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      return unavailable();
    return permissionState(await DeviceMotion.requestPermissionsAsync());
  }
  if (capability === "audio") {
    if (Platform.OS === "ios") return notRequired();
    if (Platform.OS !== "android") return unavailable();
    if (Number(Platform.Version) < 33) return notRequired();
    return permissionState(await requestNotificationPermissionsAsync());
  }
  return notRequired();
}

export async function requireDeviceSystemPermission(
  capability: DeviceCapabilityId,
) {
  const state = await requestDeviceSystemPermission(capability);
  if (state.status !== "granted" && state.status !== "not-required") {
    throw new DeviceSystemPermissionDeniedError(capability, state);
  }
  return state;
}

export async function openDeviceSystemSettings() {
  await Linking.openSettings();
}

function bluetoothPermissions(): Permission[] {
  if (Platform.OS !== "android") return [];
  return androidBluetoothPermissionNames(Number(Platform.Version)).map(
    (name) => name as Permission,
  );
}

function unavailable(): DeviceSystemPermissionState {
  return Object.freeze({ status: "unavailable", canAskAgain: false });
}

function notRequired(): DeviceSystemPermissionState {
  return Object.freeze({ status: "not-required", canAskAgain: false });
}

function permissionState(permission: {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}): DeviceSystemPermissionState {
  return {
    status: permission.granted
      ? "granted"
      : permission.status === "denied"
        ? "denied"
        : "undetermined",
    canAskAgain: permission.canAskAgain,
  };
}
