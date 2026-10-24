import type {
  BrowserBarcodeFormat,
  BrowserDetectedBarcode,
} from "./browser-native-web-api-model.ts";

type ExpoBarcodeResultLike = Readonly<{
  type: unknown;
  data: string;
  raw?: string;
  bounds?: Readonly<{
    origin?: Readonly<{ x: number; y: number }>;
    size?: Readonly<{ width: number; height: number }>;
  }>;
  cornerPoints?: readonly Readonly<{ x: number; y: number }>[];
}>;

const EXPO_FORMAT_TO_BARCODE: Readonly<Record<string, BrowserBarcodeFormat>> =
  Object.freeze({
    aztec: "aztec",
    code128: "code_128",
    code39: "code_39",
    code93: "code_93",
    codabar: "codabar",
    datamatrix: "data_matrix",
    ean13: "ean_13",
    ean8: "ean_8",
    itf14: "itf",
    pdf417: "pdf417",
    qr: "qr_code",
    upc_a: "upc_a",
    upc_e: "upc_e",
  });

// Expo Camera's Android static-image scanner serializes the underlying ML Kit
// format integer even though its public TypeScript type declares a string.
const ML_KIT_FORMAT_TO_BARCODE: Readonly<Record<number, BrowserBarcodeFormat>> =
  Object.freeze({
    1: "code_128",
    2: "code_39",
    4: "code_93",
    8: "codabar",
    16: "data_matrix",
    32: "ean_13",
    64: "ean_8",
    128: "itf",
    256: "qr_code",
    512: "upc_a",
    1_024: "upc_e",
    2_048: "pdf417",
    4_096: "aztec",
  });

function barcodeFormat(value: unknown) {
  if (typeof value === "string") return EXPO_FORMAT_TO_BARCODE[value] ?? null;
  if (typeof value === "number") return ML_KIT_FORMAT_TO_BARCODE[value] ?? null;
  return null;
}

export function normalizeExpoBarcodeResult(
  result: ExpoBarcodeResultLike,
): BrowserDetectedBarcode | null {
  const format = barcodeFormat(result.type);
  if (!format) return null;
  const origin = result.bounds?.origin ?? { x: 0, y: 0 };
  const size = result.bounds?.size ?? { width: 0, height: 0 };
  return {
    boundingBox: {
      x: origin.x,
      y: origin.y,
      width: size.width,
      height: size.height,
    },
    cornerPoints: result.cornerPoints ?? [],
    format,
    rawValue: result.raw ?? result.data,
  };
}
