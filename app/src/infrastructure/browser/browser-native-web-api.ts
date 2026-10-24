import Geolocation from "@react-native-community/geolocation";
import { Camera, type BarcodeType } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Location from "expo-location";
import * as Print from "expo-print";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import {
  createBrowserNativeWebApi,
  type BrowserNativeWebApiAdapter,
} from "./browser-native-web-api-core.ts";
import { normalizeExpoBarcodeResult } from "./browser-native-barcode-result.ts";
import type {
  BrowserBarcodeFormat,
  BrowserOrientationLock,
  BrowserPermissionName,
  BrowserShareData,
} from "./browser-native-web-api-model.ts";
import { getBrowserSystemPermission } from "./browser-system-permissions.ts";

export type {
  BrowserLocationSubscription,
  BrowserNativeWebApiAdapter,
} from "./browser-native-web-api-core.ts";
export type {
  BrowserGeolocationPosition,
  BrowserLocationOptions,
} from "./browser-native-web-api-model.ts";

if (Platform.OS === "android") {
  Geolocation.setRNConfiguration({
    locationProvider: "android",
    skipPermissionRequests: true,
  });
}

const ANDROID_BARCODE_FORMATS = Object.freeze([
  "aztec",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "data_matrix",
  "ean_13",
  "ean_8",
  "itf",
  "pdf417",
  "qr_code",
  "upc_a",
  "upc_e",
] as const satisfies readonly BrowserBarcodeFormat[]);

const IOS_BARCODE_FORMATS = Object.freeze([
  "qr_code",
] as const satisfies readonly BrowserBarcodeFormat[]);

export const browserNativeBarcodeFormats: readonly BrowserBarcodeFormat[] =
  Platform.OS === "ios" ? IOS_BARCODE_FORMATS : ANDROID_BARCODE_FORMATS;

const BARCODE_FORMAT_TO_EXPO: Readonly<
  Record<BrowserBarcodeFormat, BarcodeType>
> = Object.freeze({
  aztec: "aztec",
  code_128: "code128",
  code_39: "code39",
  code_93: "code93",
  codabar: "codabar",
  data_matrix: "datamatrix",
  ean_13: "ean13",
  ean_8: "ean8",
  itf: "itf14",
  pdf417: "pdf417",
  qr_code: "qr",
  upc_a: "upc_a",
  upc_e: "upc_e",
});

function nativeError(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function permissionKey(name: BrowserPermissionName) {
  if (name === "geolocation") return "location" as const;
  if (name === "camera" || name === "microphone") return name;
  return null;
}

function orientationLock(lock: BrowserOrientationLock) {
  switch (lock) {
    case "any":
      return ScreenOrientation.OrientationLock.DEFAULT;
    case "natural":
    case "portrait-primary":
      return ScreenOrientation.OrientationLock.PORTRAIT_UP;
    case "portrait-secondary":
      return ScreenOrientation.OrientationLock.PORTRAIT_DOWN;
    case "portrait":
      return ScreenOrientation.OrientationLock.PORTRAIT;
    case "landscape-primary":
      return ScreenOrientation.OrientationLock.LANDSCAPE_LEFT;
    case "landscape-secondary":
      return ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT;
    case "landscape":
      return ScreenOrientation.OrientationLock.LANDSCAPE;
  }
}

function safeTemporaryName(name: string) {
  const safe = name.replaceAll(/[^\p{L}\p{N}._ -]/gu, "_").slice(-120);
  return `boltpocket-browser-${randomUUID()}-${safe || "shared-file"}`;
}

function temporaryFile(name: string, base64: string) {
  const file = new File(Paths.cache, safeTemporaryName(name));
  file.create({ intermediates: true });
  file.write(base64, { encoding: "base64" });
  return file;
}

async function shareNative(data: BrowserShareData) {
  if (data.file) {
    if (!(await Sharing.isAvailableAsync())) {
      throw nativeError("NotSupportedError", "File sharing is unavailable.");
    }
    const file = temporaryFile(data.file.name, data.file.dataBase64);
    try {
      await Sharing.shareAsync(file.uri, {
        dialogTitle: data.title,
        mimeType: data.file.type || undefined,
      });
    } finally {
      if (file.exists) file.delete();
    }
    return;
  }
  const message = [data.text, data.url].filter(Boolean).join("\n");
  await Share.share({
    message,
    title: data.title,
    ...(Platform.OS === "ios" && data.url ? { url: data.url } : {}),
  });
}

async function scanNativeBarcodes(
  dataUrl: string,
  formats: readonly BrowserBarcodeFormat[],
) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/u.exec(
    dataUrl,
  );
  if (!match) throw nativeError("DataError", "Barcode image is invalid.");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const file = temporaryFile(`barcode.${extension}`, match[2]);
  try {
    const supported = formats.filter((format) =>
      browserNativeBarcodeFormats.includes(format),
    );
    if (supported.length === 0) {
      throw nativeError(
        "NotSupportedError",
        "Requested barcode formats are unavailable.",
      );
    }
    const results = await Camera.scanFromURLAsync(
      file.uri,
      supported.map((format) => BARCODE_FORMAT_TO_EXPO[format]),
    );
    return results.flatMap((result) => {
      const normalized = normalizeExpoBarcodeResult(result);
      return normalized ? [normalized] : [];
    });
  } finally {
    if (file.exists) file.delete();
  }
}

const watchNativePosition: BrowserNativeWebApiAdapter["watchPosition"] = async (
  options,
  update,
  failure,
) => {
  if (Platform.OS === "android") {
    const interval = Math.max(1_000, options.timeInterval);
    const watchId = Geolocation.watchPosition(
      update,
      (error) => failure(error.message),
      {
        distanceFilter: options.distanceInterval,
        enableHighAccuracy: options.enableHighAccuracy,
        fastestInterval: interval,
        interval,
        maximumAge: 0,
      },
    );
    return {
      remove() {
        Geolocation.clearWatch(watchId);
      },
    };
  }

  return Location.watchPositionAsync(
    {
      accuracy: options.enableHighAccuracy
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced,
      distanceInterval: options.distanceInterval,
      mayShowUserSettingsDialog: options.mayShowUserSettingsDialog,
      timeInterval: options.timeInterval,
    },
    update,
    failure,
  );
};

const getLastKnownNativePosition: BrowserNativeWebApiAdapter["getLastKnownPosition"] =
  async (options) => {
    if (Platform.OS !== "android") {
      return Location.getLastKnownPositionAsync(options);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (location: Parameters<typeof resolve>[0]): undefined => {
        if (settled) return;
        settled = true;
        resolve(location);
      };
      try {
        Geolocation.getCurrentPosition(
          (location) => finish(location),
          () => finish(null),
          {
            enableHighAccuracy: true,
            maximumAge: options.maxAge ?? Number.MAX_SAFE_INTEGER,
            timeout: 0,
          },
        );
      } catch {
        finish(null);
      }
    });
  };

const nativeAdapter: BrowserNativeWebApiAdapter = {
  platform: Platform.OS,
  getLocationPermission: Location.getForegroundPermissionsAsync,
  getLocationProviderStatus: Location.getProviderStatusAsync,
  enableNetworkProvider: Location.enableNetworkProviderAsync,
  getLastKnownPosition: getLastKnownNativePosition,
  watchPosition: watchNativePosition,
  readClipboardText: Clipboard.getStringAsync,
  writeClipboardText: Clipboard.setStringAsync,
  async queryPermission(name) {
    const key = permissionKey(name);
    if (!key) return "prompt";
    const permission = await getBrowserSystemPermission(key);
    return permission.status === "undetermined" ||
      permission.status === "unavailable"
      ? "prompt"
      : permission.status;
  },
  share: shareNative,
  async lockOrientation(lock) {
    await ScreenOrientation.lockAsync(orientationLock(lock));
  },
  async restoreOrientation() {
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
  },
  async printHtml(html) {
    await Print.printAsync({ html });
  },
  scanBarcodes: scanNativeBarcodes,
};

export const browserNativeWebApi = createBrowserNativeWebApi(nativeAdapter);
