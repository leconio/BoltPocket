import { assertByteLimit } from "./limits.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8Bytes(
  value: string,
  maximum: number,
  label: string,
): Uint8Array {
  const bytes = encoder.encode(value);
  assertByteLimit(label, bytes.byteLength, maximum);
  return bytes;
}

export function utf8Text(
  bytes: Uint8Array,
  maximum: number,
  label: string,
): string {
  assertByteLimit(label, bytes.byteLength, maximum);
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`${label}: input is not valid UTF-8`);
  }
}

export function stdinBytes(stdin: unknown, maximum: number): Uint8Array {
  const source = typeof stdin === "string" ? stdin : String(stdin ?? "");
  assertByteLimit("stdin", source.length, maximum);
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code > 0xff) return utf8Bytes(source, maximum, "stdin");
    bytes[index] = code;
  }
  return bytes;
}

export function stdinText(stdin: unknown, maximum: number): string {
  return utf8Text(stdinBytes(stdin, maximum), maximum, "stdin");
}

export function bytesToLatin1(bytes: Uint8Array, maximum: number): string {
  assertByteLimit("binary output", bytes.byteLength, maximum);
  const parts: string[] = [];
  const chunkSize = 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length),
    );
    parts.push(String.fromCharCode(...chunk));
  }
  return parts.join("");
}

export function byteLength(value: string | Uint8Array): number {
  return typeof value === "string"
    ? encoder.encode(value).byteLength
    : value.byteLength;
}
