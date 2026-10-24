import { Gunzip, gzipSync as fflateGzipSync, type GzipOptions } from "fflate";

const DEFAULT_MAX_CODEC_BYTES = 64 * 1024 * 1024;
// Small input slices bound the largest temporary inflate burst before the
// cumulative output callback can reject it.
const STREAM_INPUT_CHUNK_BYTES = 64;

export const constants = Object.freeze({
  Z_BEST_COMPRESSION: 9,
  Z_BEST_SPEED: 1,
  Z_DEFAULT_COMPRESSION: -1,
});

type NodeZlibOptions = {
  level?: number;
  maxOutputLength?: number;
};

/** React Native replacement for the subset of node:zlib used by just-bash. */
export function gzipSync(
  input: Uint8Array,
  options: NodeZlibOptions = {},
): Uint8Array {
  const bytes = normalizeInput(input);
  assertInputBudget(bytes);
  const maxOutputLength = resolveOutputLimit(options.maxOutputLength);
  // A gzip member cannot fit below the fixed header/trailer overhead.
  if (maxOutputLength < 18) throw outputLimitError(maxOutputLength);

  const level = normalizeLevel(options.level);
  const compressed = fflateGzipSync(bytes, {
    ...(level === undefined ? {} : { level }),
    mtime: 0,
  } satisfies GzipOptions);
  if (compressed.byteLength > maxOutputLength) {
    throw outputLimitError(maxOutputLength);
  }
  return compressed;
}

/**
 * Stream decompression so an expansion bomb is rejected as soon as cumulative
 * output crosses the caller's limit. Do not replace this with gunzipSync plus
 * a post-hoc size check: that would allocate the bomb first.
 */
export function gunzipSync(
  input: Uint8Array,
  options: NodeZlibOptions = {},
): Uint8Array {
  const bytes = normalizeInput(input);
  assertInputBudget(bytes);
  const maxOutputLength = resolveOutputLimit(options.maxOutputLength);
  const advertisedLength = gzipAdvertisedLength(bytes);
  if (advertisedLength > maxOutputLength) {
    throw outputLimitError(maxOutputLength);
  }
  const chunks: Uint8Array[] = [];
  let outputLength = 0;
  const gunzip = new Gunzip((chunk) => {
    if (chunk.byteLength > maxOutputLength - outputLength) {
      throw outputLimitError(maxOutputLength);
    }
    outputLength += chunk.byteLength;
    chunks.push(chunk);
  });

  if (bytes.byteLength === 0) {
    gunzip.push(bytes, true);
  } else {
    for (
      let offset = 0;
      offset < bytes.byteLength;
      offset += STREAM_INPUT_CHUNK_BYTES
    ) {
      const end = Math.min(offset + STREAM_INPUT_CHUNK_BYTES, bytes.byteLength);
      gunzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
    }
  }

  const output = new Uint8Array(outputLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizeInput(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError("zlib input must be a Uint8Array");
  }
  return input;
}

function assertInputBudget(input: Uint8Array): void {
  if (input.byteLength > DEFAULT_MAX_CODEC_BYTES) {
    throw new RangeError(
      `zlib input exceeds mobile limit (${DEFAULT_MAX_CODEC_BYTES} bytes)`,
    );
  }
}

function resolveOutputLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_CODEC_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("maxOutputLength must be a non-negative safe integer");
  }
  return Math.min(limit, DEFAULT_MAX_CODEC_BYTES);
}

function normalizeLevel(value: number | undefined): GzipOptions["level"] {
  if (value === undefined || value === constants.Z_DEFAULT_COMPRESSION) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw new RangeError("compression level must be between 0 and 9");
  }
  return value as GzipOptions["level"];
}

function outputLimitError(limit: number): RangeError {
  return new RangeError(`decompressed data exceeds limit (${limit} bytes)`);
}

function gzipAdvertisedLength(bytes: Uint8Array): number {
  if (bytes.byteLength < 4) return 0;
  const offset = bytes.byteLength - 4;
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
