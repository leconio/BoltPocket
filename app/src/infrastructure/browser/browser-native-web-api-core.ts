import {
  BROWSER_BARCODE_FORMATS,
  BROWSER_ORIENTATION_LOCKS,
  BROWSER_PERMISSION_NAMES,
  MAX_BROWSER_BARCODE_IMAGE_DATA_URL_LENGTH,
  MAX_BROWSER_CLIPBOARD_TEXT_LENGTH,
  MAX_BROWSER_PRINT_HTML_LENGTH,
  MAX_BROWSER_SHARE_FILE_BYTES,
  MAX_BROWSER_SHARE_TEXT_LENGTH,
  MAX_BROWSER_SHARE_URL_LENGTH,
  type BrowserBarcodeFormat,
  type BrowserDetectedBarcode,
  type BrowserGeolocationPosition,
  type BrowserLocationOptions,
  type BrowserOrientationLock,
  type BrowserPermissionName,
  type BrowserPermissionState,
  type BrowserShareData,
} from "./browser-native-web-api-model.ts";

export type BrowserLocationSubscription = Readonly<{
  remove(): void;
}>;

export type BrowserNativeLocationObject = Readonly<{
  coords: Readonly<{
    latitude: number;
    longitude: number;
    altitude?: number | null;
    accuracy?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }>;
  timestamp: number;
}>;

export type BrowserNativeLocationWatchOptions = Readonly<{
  enableHighAccuracy: boolean;
  distanceInterval: number;
  mayShowUserSettingsDialog: boolean;
  timeInterval: number;
}>;

export type BrowserNativeWebApiAdapter = Readonly<{
  platform: string;
  getLocationPermission(): Promise<{ status: string }>;
  getLocationProviderStatus(): Promise<{ networkAvailable?: boolean }>;
  enableNetworkProvider(): Promise<void>;
  getLastKnownPosition(options: {
    maxAge?: number;
  }): Promise<BrowserNativeLocationObject | null>;
  watchPosition(
    options: BrowserNativeLocationWatchOptions,
    update: (location: BrowserNativeLocationObject) => void,
    failure: (reason: string) => void,
  ): Promise<BrowserLocationSubscription>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<boolean>;
  queryPermission(name: BrowserPermissionName): Promise<BrowserPermissionState>;
  share(data: BrowserShareData): Promise<void>;
  lockOrientation(lock: BrowserOrientationLock): Promise<void>;
  restoreOrientation(): Promise<void>;
  printHtml(html: string): Promise<void>;
  scanBarcodes(
    dataUrl: string,
    formats: readonly BrowserBarcodeFormat[],
  ): Promise<readonly BrowserDetectedBarcode[]>;
}>;

class BrowserNativeWebApiError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.some((item) => item === value);
}

function assertBase64Size(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 === 1) {
    throw new BrowserNativeWebApiError("DataError", "Invalid file data.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((value.length * 3) / 4) - padding;
  if (bytes > MAX_BROWSER_SHARE_FILE_BYTES) {
    throw new BrowserNativeWebApiError(
      "DataError",
      "Shared file is too large.",
    );
  }
}

function validateShareData(data: BrowserShareData) {
  if (!data.text && !data.url && !data.file) {
    throw new BrowserNativeWebApiError("TypeError", "Nothing to share.");
  }
  if ((data.title?.length ?? 0) > 240) {
    throw new BrowserNativeWebApiError(
      "DataError",
      "Share title is too large.",
    );
  }
  if ((data.text?.length ?? 0) > MAX_BROWSER_SHARE_TEXT_LENGTH) {
    throw new BrowserNativeWebApiError("DataError", "Share text is too large.");
  }
  if ((data.url?.length ?? 0) > MAX_BROWSER_SHARE_URL_LENGTH) {
    throw new BrowserNativeWebApiError("DataError", "Share URL is too large.");
  }
  if (data.file) assertBase64Size(data.file.dataBase64);
  if (data.file && (data.text || data.url)) {
    throw new BrowserNativeWebApiError(
      "NotSupportedError",
      "File and text sharing cannot be combined.",
    );
  }
}

function validateDetectedBarcode(
  value: BrowserDetectedBarcode,
): BrowserDetectedBarcode {
  if (
    !isOneOf(BROWSER_BARCODE_FORMATS, value.format) ||
    typeof value.rawValue !== "string" ||
    value.rawValue.length > 16_000 ||
    !value.boundingBox ||
    ![
      value.boundingBox.x,
      value.boundingBox.y,
      value.boundingBox.width,
      value.boundingBox.height,
    ].every(Number.isFinite) ||
    !Array.isArray(value.cornerPoints) ||
    value.cornerPoints.length > 16 ||
    !value.cornerPoints.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  ) {
    throw new BrowserNativeWebApiError(
      "UnknownError",
      "Barcode result is invalid.",
    );
  }
  return Object.freeze({
    boundingBox: Object.freeze({ ...value.boundingBox }),
    cornerPoints: Object.freeze(
      value.cornerPoints.map((point) => Object.freeze({ ...point })),
    ),
    format: value.format,
    rawValue: value.rawValue,
  });
}

function normalizePosition(
  location: BrowserNativeLocationObject,
): BrowserGeolocationPosition {
  const latitude = location.coords.latitude;
  const longitude = location.coords.longitude;
  const timestamp = location.timestamp;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(timestamp)
  ) {
    throw new BrowserNativeWebApiError(
      "PositionUnavailableError",
      "Location data is unavailable.",
    );
  }
  return Object.freeze({
    coords: Object.freeze({
      latitude,
      longitude,
      altitude: finiteOrNull(location.coords.altitude),
      accuracy: finiteOrNull(location.coords.accuracy),
      altitudeAccuracy: finiteOrNull(location.coords.altitudeAccuracy),
      heading: finiteOrNull(location.coords.heading),
      speed: finiteOrNull(location.coords.speed),
    }),
    timestamp,
  });
}

async function assertLocationPermission(adapter: BrowserNativeWebApiAdapter) {
  const permission = await adapter.getLocationPermission();
  if (permission.status !== "granted") {
    throw new BrowserNativeWebApiError(
      "NotAllowedError",
      "Location permission is not granted.",
    );
  }
}

async function requestNetworkLocationIfNeeded(
  adapter: BrowserNativeWebApiAdapter,
) {
  if (adapter.platform !== "android") return true;
  const provider = await adapter.getLocationProviderStatus();
  if (provider.networkAvailable !== false) return true;
  try {
    await adapter.enableNetworkProvider();
    return true;
  } catch {
    // Some Android builds cannot offer a resolution dialog. Continue with the
    // GPS provider instead of asking Expo to repeat the same rejected check.
    return false;
  }
}

function firstPosition(
  adapter: BrowserNativeWebApiAdapter,
  options: BrowserLocationOptions,
  mayShowUserSettingsDialog: boolean,
) {
  return new Promise<BrowserGeolocationPosition>((resolve, reject) => {
    let settled = false;
    let subscription: BrowserLocationSubscription | undefined;
    const finish = (
      result?: BrowserGeolocationPosition,
      error?: BrowserNativeWebApiError,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new BrowserNativeWebApiError(
            "TimeoutError",
            "Location request timed out.",
          ),
        ),
      options.timeout,
    );
    void adapter
      .watchPosition(
        {
          enableHighAccuracy: options.enableHighAccuracy,
          distanceInterval: 0,
          mayShowUserSettingsDialog,
          timeInterval: 0,
        },
        (location) => {
          try {
            finish(normalizePosition(location));
          } catch {
            finish(
              undefined,
              new BrowserNativeWebApiError(
                "PositionUnavailableError",
                "Location data is unavailable.",
              ),
            );
          }
        },
        () =>
          finish(
            undefined,
            new BrowserNativeWebApiError(
              "PositionUnavailableError",
              "Location data is unavailable.",
            ),
          ),
      )
      .then(
        (value) => {
          subscription = value;
          if (settled) value.remove();
        },
        () =>
          finish(
            undefined,
            new BrowserNativeWebApiError(
              "PositionUnavailableError",
              "Location data is unavailable.",
            ),
          ),
      );
  });
}

export function createBrowserNativeWebApi(adapter: BrowserNativeWebApiAdapter) {
  return Object.freeze({
    async getCurrentPosition(
      options: BrowserLocationOptions,
    ): Promise<BrowserGeolocationPosition> {
      await assertLocationPermission(adapter);
      if (options.maximumAge !== 0) {
        const lastKnown = await adapter.getLastKnownPosition(
          options.maximumAge < 0 ? {} : { maxAge: options.maximumAge },
        );
        if (lastKnown) return normalizePosition(lastKnown);
      }
      const mayShowUserSettingsDialog =
        await requestNetworkLocationIfNeeded(adapter);
      return firstPosition(adapter, options, mayShowUserSettingsDialog);
    },

    async watchPosition(
      options: BrowserLocationOptions,
      update: (position: BrowserGeolocationPosition) => void,
      failure: (error: Error) => void,
    ): Promise<BrowserLocationSubscription> {
      await assertLocationPermission(adapter);
      const mayShowUserSettingsDialog =
        await requestNetworkLocationIfNeeded(adapter);
      return adapter.watchPosition(
        {
          enableHighAccuracy: options.enableHighAccuracy,
          distanceInterval: 0,
          mayShowUserSettingsDialog,
          timeInterval: 1_000,
        },
        (location) => {
          try {
            update(normalizePosition(location));
          } catch {
            failure(
              new BrowserNativeWebApiError(
                "PositionUnavailableError",
                "Location data is unavailable.",
              ),
            );
          }
        },
        () =>
          failure(
            new BrowserNativeWebApiError(
              "PositionUnavailableError",
              "Location data is unavailable.",
            ),
          ),
      );
    },

    async readClipboardText() {
      const text = await adapter.readClipboardText();
      if (text.length > MAX_BROWSER_CLIPBOARD_TEXT_LENGTH) {
        throw new BrowserNativeWebApiError(
          "DataError",
          "Clipboard text is too large for this page.",
        );
      }
      return text;
    },

    async writeClipboardText(text: string) {
      if (text.length > MAX_BROWSER_CLIPBOARD_TEXT_LENGTH) {
        throw new BrowserNativeWebApiError(
          "DataError",
          "Clipboard text is too large for this page.",
        );
      }
      const written = await adapter.writeClipboardText(text);
      if (!written) {
        throw new BrowserNativeWebApiError(
          "NotAllowedError",
          "Clipboard write was rejected.",
        );
      }
    },

    async queryPermission(name: BrowserPermissionName) {
      if (!isOneOf(BROWSER_PERMISSION_NAMES, name)) {
        throw new BrowserNativeWebApiError(
          "NotSupportedError",
          "Permission name is not supported.",
        );
      }
      const state = await adapter.queryPermission(name);
      if (state !== "denied" && state !== "granted" && state !== "prompt") {
        throw new BrowserNativeWebApiError(
          "UnknownError",
          "Permission state is invalid.",
        );
      }
      return state;
    },

    async share(data: BrowserShareData) {
      validateShareData(data);
      await adapter.share(data);
    },

    async lockOrientation(lock: BrowserOrientationLock) {
      if (!isOneOf(BROWSER_ORIENTATION_LOCKS, lock)) {
        throw new BrowserNativeWebApiError(
          "NotSupportedError",
          "Screen orientation lock is not supported.",
        );
      }
      await adapter.lockOrientation(lock);
    },

    async restoreOrientation() {
      await adapter.restoreOrientation();
    },

    async printHtml(html: string) {
      if (!html || html.length > MAX_BROWSER_PRINT_HTML_LENGTH) {
        throw new BrowserNativeWebApiError(
          "DataError",
          "Printable document is too large.",
        );
      }
      await adapter.printHtml(html);
    },

    async scanBarcodes(
      dataUrl: string,
      formats: readonly BrowserBarcodeFormat[],
    ) {
      if (
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/u.test(
          dataUrl,
        ) ||
        dataUrl.length > MAX_BROWSER_BARCODE_IMAGE_DATA_URL_LENGTH ||
        formats.length < 1 ||
        formats.length > BROWSER_BARCODE_FORMATS.length ||
        formats.some((format) => !isOneOf(BROWSER_BARCODE_FORMATS, format))
      ) {
        throw new BrowserNativeWebApiError(
          "DataError",
          "Barcode image or formats are invalid.",
        );
      }
      const results = await adapter.scanBarcodes(dataUrl, formats);
      if (!Array.isArray(results) || results.length > 128) {
        throw new BrowserNativeWebApiError(
          "UnknownError",
          "Barcode result is invalid.",
        );
      }
      return Object.freeze(results.map(validateDetectedBarcode));
    },
  });
}
