import type { ImageAttachment } from "../../domain/models";

export const DEFAULT_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export type SupportedImageMimeType =
  (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type AgentImageAttachment = {
  id: string;
  uri: string;
  mimeType: SupportedImageMimeType;
  base64?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  name?: string;
};

export type ImageAttachmentValidationErrorCode =
  | "invalid-uri"
  | "missing-base64"
  | "invalid-base64"
  | "unsupported-mime-type"
  | "mime-type-mismatch"
  | "invalid-file-size"
  | "attachment-too-large";

export class ImageAttachmentValidationError extends Error {
  readonly code: ImageAttachmentValidationErrorCode;

  constructor(code: ImageAttachmentValidationErrorCode, message: string) {
    super(message);
    this.name = "ImageAttachmentValidationError";
    this.code = code;
  }
}

export type NormalizeImageAttachmentOptions = {
  maxBytes?: number;
  fallbackMimeType?: SupportedImageMimeType;
};

export type NormalizedImageAttachment = Omit<
  AgentImageAttachment,
  "id" | "base64" | "sizeBytes"
> & {
  base64: string;
};

export type NormalizedSelectedImageAttachment = Omit<
  AgentImageAttachment,
  "id" | "base64" | "sizeBytes"
> & {
  sizeBytes: number;
};

const MIME_ALIASES: Readonly<Record<string, SupportedImageMimeType>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

const MIME_BY_EXTENSION: Readonly<Record<string, SupportedImageMimeType>> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

const EXTENSION_BY_MIME: Readonly<Record<SupportedImageMimeType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

type ParsedBase64 = {
  payload: string;
  embeddedMimeType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBase64(value: unknown): ParsedBase64 {
  if (typeof value !== "string" || !value.trim()) {
    throw new ImageAttachmentValidationError(
      "missing-base64",
      "The selected image did not include Base64 data.",
    );
  }

  const input = value.trim();
  let payload = input;
  let embeddedMimeType: string | undefined;

  if (input.toLowerCase().startsWith("data:")) {
    const commaIndex = input.indexOf(",");
    const header = commaIndex >= 0 ? input.slice(5, commaIndex) : "";
    if (commaIndex < 0 || !header.toLowerCase().endsWith(";base64")) {
      throw new ImageAttachmentValidationError(
        "invalid-base64",
        "The image data URI is not Base64 encoded.",
      );
    }
    embeddedMimeType = header.slice(0, -";base64".length);
    payload = input.slice(commaIndex + 1);
  }

  const normalizedPayload = payload.replace(/\s/g, "");
  const hasPadding = normalizedPayload.includes("=");
  if (
    !normalizedPayload ||
    normalizedPayload.length % 4 === 1 ||
    (hasPadding && normalizedPayload.length % 4 !== 0) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedPayload)
  ) {
    throw new ImageAttachmentValidationError(
      "invalid-base64",
      "The selected image contains malformed Base64 data.",
    );
  }

  return { payload: normalizedPayload, embeddedMimeType };
}

function normalizeMimeType(value: unknown): SupportedImageMimeType | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const rawMimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (!rawMimeType) return undefined;

  const aliasedMimeType = MIME_ALIASES[rawMimeType] ?? rawMimeType;
  return SUPPORTED_IMAGE_MIME_TYPES.find(
    (candidate) => candidate === aliasedMimeType,
  );
}

function inferMimeTypeFromPath(
  value: unknown,
): SupportedImageMimeType | undefined {
  if (typeof value !== "string") return undefined;
  const cleanPath = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const extension = cleanPath.match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? MIME_BY_EXTENSION[extension] : undefined;
}

function normalizeOptionalDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeOptionalName(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const fileName = value.trim().split(/[\\/]/).pop()?.trim();
  return fileName ? fileName.slice(0, 255) : undefined;
}

function resolveMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_IMAGE_ATTACHMENT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer.");
  }
  return maxBytes;
}

export function getBase64ByteLength(base64: string): number {
  const { payload } = parseBase64(base64);
  const paddingLength = payload.endsWith("==")
    ? 2
    : payload.endsWith("=")
      ? 1
      : 0;
  return Math.floor((payload.length * 3) / 4) - paddingLength;
}

/**
 * Validates native picker output before it crosses into the Agent runtime.
 * The returned Base64 value never contains a data-URI prefix or whitespace.
 */
export function normalizeImageAttachment(
  input: unknown,
  options: NormalizeImageAttachmentOptions = {},
): NormalizedImageAttachment {
  if (!isRecord(input) || typeof input.uri !== "string" || !input.uri.trim()) {
    throw new ImageAttachmentValidationError(
      "invalid-uri",
      "The selected image does not have a readable URI.",
    );
  }

  const uri = input.uri.trim();
  if (uri.length > 8192) {
    throw new ImageAttachmentValidationError(
      "invalid-uri",
      "The selected image URI is too long.",
    );
  }

  const { payload, embeddedMimeType } = parseBase64(input.base64);
  const declaredMimeType = normalizeMimeType(input.mimeType);
  const dataUriMimeType = normalizeMimeType(embeddedMimeType);

  if (typeof input.mimeType === "string" && !declaredMimeType) {
    throw new ImageAttachmentValidationError(
      "unsupported-mime-type",
      `Unsupported image type: ${input.mimeType}.`,
    );
  }
  if (embeddedMimeType && !dataUriMimeType) {
    throw new ImageAttachmentValidationError(
      "unsupported-mime-type",
      `Unsupported image type: ${embeddedMimeType}.`,
    );
  }
  if (
    declaredMimeType &&
    dataUriMimeType &&
    declaredMimeType !== dataUriMimeType
  ) {
    throw new ImageAttachmentValidationError(
      "mime-type-mismatch",
      "The image MIME type does not match its data URI.",
    );
  }

  const name = normalizeOptionalName(input.name);
  const mimeType =
    declaredMimeType ??
    dataUriMimeType ??
    inferMimeTypeFromPath(name) ??
    inferMimeTypeFromPath(uri) ??
    options.fallbackMimeType;
  if (!mimeType) {
    throw new ImageAttachmentValidationError(
      "unsupported-mime-type",
      "The selected image type could not be determined.",
    );
  }

  const maxBytes = resolveMaxBytes(options.maxBytes);
  const fileSize = input.fileSize;
  if (
    fileSize !== undefined &&
    (typeof fileSize !== "number" ||
      !Number.isSafeInteger(fileSize) ||
      fileSize < 0)
  ) {
    throw new ImageAttachmentValidationError(
      "invalid-file-size",
      "The selected image reported an invalid file size.",
    );
  }

  const base64Bytes = getBase64ByteLength(payload);
  if (
    base64Bytes > maxBytes ||
    (typeof fileSize === "number" && fileSize > maxBytes)
  ) {
    throw new ImageAttachmentValidationError(
      "attachment-too-large",
      `The selected image exceeds the ${maxBytes}-byte limit.`,
    );
  }

  const width = normalizeOptionalDimension(input.width);
  const height = normalizeOptionalDimension(input.height);

  return {
    uri,
    mimeType,
    base64: payload,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(name === undefined ? {} : { name }),
  };
}

/** Validates picker metadata without copying the selected file into JS memory. */
export function normalizeSelectedImageAttachment(
  input: unknown,
  options: NormalizeImageAttachmentOptions = {},
): NormalizedSelectedImageAttachment {
  if (!isRecord(input) || typeof input.uri !== "string" || !input.uri.trim()) {
    throw new ImageAttachmentValidationError(
      "invalid-uri",
      "The selected image does not have a readable URI.",
    );
  }
  const uri = input.uri.trim();
  if (uri.length > 8192) {
    throw new ImageAttachmentValidationError(
      "invalid-uri",
      "The selected image URI is too long.",
    );
  }
  const declaredMimeType = normalizeMimeType(input.mimeType);
  if (typeof input.mimeType === "string" && !declaredMimeType) {
    throw new ImageAttachmentValidationError(
      "unsupported-mime-type",
      `Unsupported image type: ${input.mimeType}.`,
    );
  }
  const name = normalizeOptionalName(input.name);
  const mimeType =
    declaredMimeType ??
    inferMimeTypeFromPath(name) ??
    inferMimeTypeFromPath(uri) ??
    options.fallbackMimeType;
  if (!mimeType) {
    throw new ImageAttachmentValidationError(
      "unsupported-mime-type",
      "The selected image type could not be determined.",
    );
  }
  const fileSize = input.fileSize;
  if (
    typeof fileSize !== "number" ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0
  ) {
    throw new ImageAttachmentValidationError(
      "invalid-file-size",
      "The selected image reported an invalid file size.",
    );
  }
  if (fileSize > resolveMaxBytes(options.maxBytes)) {
    throw new ImageAttachmentValidationError(
      "attachment-too-large",
      `The selected image exceeds the configured byte limit.`,
    );
  }
  const width = normalizeOptionalDimension(input.width);
  const height = normalizeOptionalDimension(input.height);
  return {
    uri,
    mimeType,
    sizeBytes: fileSize,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(name === undefined ? {} : { name }),
  };
}

/** Converts picker output into the chat domain without retaining native metadata. */
export function toChatImageAttachment(
  attachment: AgentImageAttachment,
): ImageAttachment {
  const generatedName = `image-${attachment.id.slice(0, 8)}.${EXTENSION_BY_MIME[attachment.mimeType]}`;
  const sizeBytes =
    attachment.sizeBytes ??
    (attachment.base64 ? getBase64ByteLength(attachment.base64) : 0);
  return {
    id: attachment.id,
    kind: "image",
    uri: attachment.uri,
    name: attachment.name ?? generatedName,
    mimeType: attachment.mimeType,
    ...(attachment.base64 ? { base64: attachment.base64 } : {}),
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
    sizeBytes,
  };
}
