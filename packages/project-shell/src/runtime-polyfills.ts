import { Buffer as PortableBuffer } from "buffer";

type RuntimeWithBuffer = typeof globalThis & {
  Buffer?: typeof PortableBuffer;
};

/**
 * just-bash's browser build still has a few lazy command paths that reference
 * the browser-compatible Buffer API directly. Hermes does not provide it, so
 * install the explicit `buffer` package before any command can be invoked.
 */
export function installProjectShellRuntimePolyfills(): void {
  const runtime = globalThis as RuntimeWithBuffer;
  if (typeof runtime.Buffer === "function") return;
  Object.defineProperty(runtime, "Buffer", {
    configurable: true,
    enumerable: false,
    value: PortableBuffer,
    writable: true,
  });
}

export function decodeByteString(value: string): string {
  return PortableBuffer.from(value, "latin1").toString("utf8");
}

export function encodeUtf8(value: string): Uint8Array {
  return new Uint8Array(PortableBuffer.from(value, "utf8"));
}

export function decodeUtf8Strict(bytes: Uint8Array): string {
  const buffer = PortableBuffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const decoded = buffer.toString("utf8");
  const encoded = PortableBuffer.from(decoded, "utf8");
  if (encoded.byteLength !== bytes.byteLength) {
    throw new Error("binary content cannot be represented by a text patch");
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (encoded[index] !== bytes[index]) {
      throw new Error("binary content cannot be represented by a text patch");
    }
  }
  return decoded;
}

// This module is deliberately evaluated before `just-bash/browser`; some lazy
// browser command modules contain unguarded Buffer references.
installProjectShellRuntimePolyfills();
