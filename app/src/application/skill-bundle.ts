import type {
  SkillBundleFile,
  SkillCapability,
} from "@/application/ports/capability-catalog";

export const SKILL_BUNDLE_LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxFiles: 256,
  maxPathBytes: 512,
  maxTotalBytes: 2 * 1024 * 1024,
});

const SHA256 = /^[a-f0-9]{64}$/u;
const MIME_TYPE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function normalizeSkillBundlePath(value: string) {
  if (
    !value ||
    new TextEncoder().encode(value).byteLength >
      SKILL_BUNDLE_LIMITS.maxPathBytes ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  const segments = value.split("/");
  return segments.some(
    (segment) => !segment || segment === "." || segment === "..",
  )
    ? null
    : segments.join("/");
}

function canonicalBase64ByteLength(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function decodeSkillBundleBase64(value: string) {
  const byteLength = canonicalBase64ByteLength(value);
  if (byteLength === null) throw new Error("Skill bundle Base64 is invalid.");
  const output = new Uint8Array(byteLength);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index] ?? "");
    const second = BASE64_ALPHABET.indexOf(value[index + 1] ?? "");
    const thirdCharacter = value[index + 2] ?? "=";
    const fourthCharacter = value[index + 3] ?? "=";
    const third =
      thirdCharacter === "=" ? 0 : BASE64_ALPHABET.indexOf(thirdCharacter);
    const fourth =
      fourthCharacter === "=" ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error("Skill bundle Base64 is invalid.");
    }
    const bits = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < byteLength) output[outputIndex++] = (bits >>> 16) & 0xff;
    if (outputIndex < byteLength) output[outputIndex++] = (bits >>> 8) & 0xff;
    if (outputIndex < byteLength) output[outputIndex++] = bits & 0xff;
  }
  return output;
}

export function skillBundleFingerprintInput(files: readonly SkillBundleFile[]) {
  return JSON.stringify(
    files.map((file) => ({
      byteLength: file.byteLength,
      encoding: file.encoding,
      executable: file.executable,
      mimeType: file.mimeType,
      path: file.path,
      sha256: file.sha256,
    })),
  );
}

export function validateSkillBundleMetadata(capability: SkillCapability) {
  const { bundle } = capability;
  if (
    bundle.complete !== true ||
    !SHA256.test(bundle.sha256) ||
    !Number.isSafeInteger(bundle.totalBytes) ||
    bundle.totalBytes < 0 ||
    bundle.totalBytes > SKILL_BUNDLE_LIMITS.maxTotalBytes ||
    bundle.files.length === 0 ||
    bundle.files.length > SKILL_BUNDLE_LIMITS.maxFiles
  ) {
    return false;
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  let previousPath = "";
  for (const file of bundle.files) {
    const path = normalizeSkillBundlePath(file.path);
    const measuredBytes =
      file.encoding === "utf8"
        ? new TextEncoder().encode(file.content).byteLength
        : canonicalBase64ByteLength(file.content);
    if (
      !path ||
      path !== file.path ||
      seen.has(path) ||
      (previousPath && previousPath >= path) ||
      (file.encoding !== "utf8" && file.encoding !== "base64") ||
      typeof file.executable !== "boolean" ||
      !MIME_TYPE.test(file.mimeType) ||
      file.mimeType.length > 120 ||
      !SHA256.test(file.sha256) ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 0 ||
      file.byteLength > SKILL_BUNDLE_LIMITS.maxFileBytes ||
      measuredBytes !== file.byteLength ||
      (file.encoding === "utf8" && file.content.includes("\0"))
    ) {
      return false;
    }
    previousPath = path;
    seen.add(path);
    totalBytes += file.byteLength;
  }
  const skillDocument = bundle.files.find((file) => file.path === "SKILL.md");
  return Boolean(
    totalBytes === bundle.totalBytes &&
    skillDocument &&
    skillDocument.encoding === "utf8" &&
    skillDocument.content === capability.skillDocument &&
    skillDocument.sha256 === capability.sha256,
  );
}

export async function verifySkillBundleIntegrity(
  capability: SkillCapability,
  digest: Readonly<{
    bytes(value: Uint8Array): Promise<string>;
    text(value: string): Promise<string>;
  }>,
) {
  if (!validateSkillBundleMetadata(capability)) return false;
  for (const file of capability.bundle.files) {
    const actual =
      file.encoding === "utf8"
        ? await digest.text(file.content)
        : await digest.bytes(decodeSkillBundleBase64(file.content));
    if (actual !== file.sha256) return false;
  }
  return (
    (await digest.text(
      skillBundleFingerprintInput(capability.bundle.files),
    )) === capability.bundle.sha256
  );
}
