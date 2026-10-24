export const MAX_BROWSER_CLIPBOARD_TEXT_LENGTH = 16_000;
export const MAX_BROWSER_LOCATION_TIMEOUT_MS = 60_000;
export const MAX_BROWSER_LOCATION_CACHE_AGE_MS = 24 * 60 * 60 * 1_000;
export const MAX_BROWSER_PRINT_HTML_LENGTH = 512_000;
export const MAX_BROWSER_SHARE_TEXT_LENGTH = 16_000;
export const MAX_BROWSER_SHARE_URL_LENGTH = 2_048;
export const MAX_BROWSER_SHARE_FILE_BYTES = 2 * 1_024 * 1_024;
export const MAX_BROWSER_BARCODE_IMAGE_DATA_URL_LENGTH = 2_100_000;

export const BROWSER_PERMISSION_NAMES = [
  "geolocation",
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
] as const;

export type BrowserPermissionName = (typeof BROWSER_PERMISSION_NAMES)[number];
export type BrowserPermissionState = "denied" | "granted" | "prompt";

export const BROWSER_ORIENTATION_LOCKS = [
  "any",
  "natural",
  "landscape",
  "portrait",
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
] as const;

export type BrowserOrientationLock = (typeof BROWSER_ORIENTATION_LOCKS)[number];

export const BROWSER_BARCODE_FORMATS = [
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
] as const;

export type BrowserBarcodeFormat = (typeof BROWSER_BARCODE_FORMATS)[number];

export type BrowserShareFile = Readonly<{
  name: string;
  type: string;
  dataBase64: string;
}>;

export type BrowserShareData = Readonly<{
  title?: string;
  text?: string;
  url?: string;
  file?: BrowserShareFile;
}>;

export type BrowserDetectedBarcode = Readonly<{
  boundingBox: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  cornerPoints: readonly Readonly<{ x: number; y: number }>[];
  format: BrowserBarcodeFormat;
  rawValue: string;
}>;

export type BrowserLocationOptions = Readonly<{
  enableHighAccuracy: boolean;
  timeout: number;
  /** `-1` represents the Web Geolocation API's `Infinity`. */
  maximumAge: number;
}>;

export type BrowserGeolocationPosition = Readonly<{
  coords: Readonly<{
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  }>;
  timestamp: number;
}>;
