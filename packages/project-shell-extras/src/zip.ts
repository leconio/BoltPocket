import { Unzip, UnzipInflate } from "fflate";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export type BoundedZipArchiveLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxExtractedBytes: number;
  maxPathBytes: number;
};

export type BoundedZipArchiveEntry = {
  name: string;
  data: Uint8Array;
};

function positiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function validatedLimits(
  limits: BoundedZipArchiveLimits,
): BoundedZipArchiveLimits {
  return {
    maxArchiveBytes: positiveSafeInteger(
      limits.maxArchiveBytes,
      "maxArchiveBytes",
    ),
    maxEntries: positiveSafeInteger(limits.maxEntries, "maxEntries"),
    maxEntryBytes: positiveSafeInteger(limits.maxEntryBytes, "maxEntryBytes"),
    maxExtractedBytes: positiveSafeInteger(
      limits.maxExtractedBytes,
      "maxExtractedBytes",
    ),
    maxPathBytes: positiveSafeInteger(limits.maxPathBytes, "maxPathBytes"),
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("ZIP extraction was cancelled.");
  error.name = "AbortError";
  throw error;
}

function safeEntryName(input: string, maxPathBytes: number) {
  if (
    !input ||
    input.includes("\0") ||
    input.includes("\\") ||
    input.startsWith("/") ||
    /^[a-z]:/iu.test(input)
  ) {
    throw new Error("ZIP archive contains an unsafe path");
  }
  const directory = input.endsWith("/");
  const withoutTrailingSlash = directory ? input.slice(0, -1) : input;
  const segments = withoutTrailingSlash.split("/");
  if (
    !withoutTrailingSlash ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\u0000-\u001f\u007f]/u.test(segment),
    ) ||
    encoder.encode(withoutTrailingSlash).byteLength > maxPathBytes
  ) {
    throw new Error("ZIP archive contains an unsafe path");
  }
  const normalized = segments.join("/").normalize("NFC");
  return { directory, name: normalized };
}

function concatenate(chunks: readonly Uint8Array[], length: number) {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Extract a ZIP archive without creating host files. The streaming decoder is
 * the upstream fflate implementation already used by the mobile tar adapter;
 * this wrapper only adds application-specific path, entry-count and expansion boundaries.
 */
export function extractBoundedZipArchive(
  archive: Uint8Array,
  inputLimits: BoundedZipArchiveLimits,
  signal?: AbortSignal,
): BoundedZipArchiveEntry[] {
  const limits = validatedLimits(inputLimits);
  throwIfAborted(signal);
  if (archive.byteLength > limits.maxArchiveBytes) {
    throw new Error(
      `ZIP archive exceeds ${limits.maxArchiveBytes} byte download limit`,
    );
  }

  const entries: BoundedZipArchiveEntry[] = [];
  const seen = new Set<string>();
  let discoveredEntries = 0;
  let extractedBytes = 0;
  let advertisedBytes = 0;
  let openFiles = 0;
  let failure: Error | undefined;

  const fail = (error: unknown) => {
    failure ??=
      error instanceof Error ? error : new Error("ZIP extraction failed");
  };

  const unzip = new Unzip((file) => {
    if (failure) {
      file.ondata = () => undefined;
      file.terminate();
      return;
    }
    try {
      throwIfAborted(signal);
      discoveredEntries += 1;
      if (discoveredEntries > limits.maxEntries) {
        throw new Error(`ZIP archive exceeds ${limits.maxEntries} entries`);
      }
      const path = safeEntryName(file.name, limits.maxPathBytes);
      const key = `${path.directory ? "directory" : "file"}:${path.name}`;
      if (seen.has(key)) {
        throw new Error(`ZIP archive contains duplicate entry: ${path.name}`);
      }
      seen.add(key);

      if (
        file.originalSize !== undefined &&
        (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0)
      ) {
        throw new Error(`ZIP entry has an invalid size: ${path.name}`);
      }
      if (
        !path.directory &&
        file.originalSize !== undefined &&
        file.originalSize > limits.maxEntryBytes
      ) {
        throw new Error(
          `ZIP entry exceeds ${limits.maxEntryBytes} bytes: ${path.name}`,
        );
      }
      advertisedBytes += file.originalSize ?? 0;
      if (advertisedBytes > limits.maxExtractedBytes) {
        throw new Error(
          `ZIP archive exceeds ${limits.maxExtractedBytes} extracted bytes`,
        );
      }

      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      openFiles += 1;
      file.ondata = (error, data, final) => {
        if (failure) return;
        try {
          throwIfAborted(signal);
          if (error) throw error;
          if (data) {
            entryBytes += data.byteLength;
            extractedBytes += data.byteLength;
            if (path.directory && entryBytes > 0) {
              throw new Error(`ZIP directory contains data: ${path.name}`);
            }
            if (entryBytes > limits.maxEntryBytes) {
              throw new Error(
                `ZIP entry exceeds ${limits.maxEntryBytes} bytes: ${path.name}`,
              );
            }
            if (extractedBytes > limits.maxExtractedBytes) {
              throw new Error(
                `ZIP archive exceeds ${limits.maxExtractedBytes} extracted bytes`,
              );
            }
            if (!path.directory && data.byteLength > 0) {
              chunks.push(data.slice());
            }
          }
          if (final) {
            openFiles -= 1;
            if (!path.directory) {
              entries.push({
                name: path.name,
                data: concatenate(chunks, entryBytes),
              });
            }
          }
        } catch (callbackError) {
          file.terminate();
          fail(callbackError);
        }
      };
      file.start();
    } catch (entryError) {
      file.ondata = () => undefined;
      file.terminate();
      fail(entryError);
    }
  });
  unzip.register(UnzipInflate);

  const chunkBytes = 64 * 1024;
  try {
    if (archive.byteLength === 0) {
      unzip.push(archive, true);
    } else {
      for (let offset = 0; offset < archive.byteLength; offset += chunkBytes) {
        throwIfAborted(signal);
        if (failure) throw failure;
        const end = Math.min(offset + chunkBytes, archive.byteLength);
        unzip.push(archive.subarray(offset, end), end === archive.byteLength);
      }
    }
  } catch (error) {
    if (failure) throw failure;
    throw error instanceof Error ? error : new Error("ZIP extraction failed");
  }
  if (failure) throw failure;
  if (openFiles !== 0) throw new Error("ZIP archive ended before an entry did");
  if (discoveredEntries === 0) throw new Error("ZIP archive is empty");
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export function decodeZipTextEntry(entry: BoundedZipArchiveEntry) {
  return decoder.decode(entry.data);
}
