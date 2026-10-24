import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExpoBarcodeResult } from "./browser-native-barcode-result.ts";

test("normalizes Expo's documented barcode string format", () => {
  assert.equal(
    normalizeExpoBarcodeResult({
      type: "qr",
      data: "documented",
      cornerPoints: [],
    })?.format,
    "qr_code",
  );
});

test("normalizes the ML Kit integer returned by Android static scanning", () => {
  assert.deepEqual(
    normalizeExpoBarcodeResult({
      type: 256,
      data: "display value",
      raw: "BOLTPOCKET_BROWSER_BARCODE_OK",
      bounds: {
        origin: { x: 1, y: 2 },
        size: { width: 30, height: 40 },
      },
      cornerPoints: [{ x: 1, y: 2 }],
    }),
    {
      boundingBox: { x: 1, y: 2, width: 30, height: 40 },
      cornerPoints: [{ x: 1, y: 2 }],
      format: "qr_code",
      rawValue: "BOLTPOCKET_BROWSER_BARCODE_OK",
    },
  );
});

test("drops unknown native barcode formats", () => {
  assert.equal(normalizeExpoBarcodeResult({ type: 0, data: "unknown" }), null);
});
