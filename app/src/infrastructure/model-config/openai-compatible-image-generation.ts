import type {
  AgentImageGenerationPort,
  ImageGenerationCapability,
  ImageGenerationInput,
} from "@/application/ports/image-generation";
import type { GeneratedImageAttachment } from "@/domain/models";
import type { ResolvedModelRuntimeConfig } from "@/infrastructure/model-config/model-config-store";

export const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_CHARACTERS =
  Math.ceil((MAX_GENERATED_IMAGE_BYTES * 4) / 3) + 256 * 1024;

type GeneratedImageMimeType = GeneratedImageAttachment["mimeType"];

export type GeneratedImageStorageInput = Readonly<{
  conversationId: string;
  projectId: string | null;
  base64: string;
  byteLength: number;
  mimeType: GeneratedImageMimeType;
  providerName: string;
  modelId: string;
}>;

export interface GeneratedImageStoragePort {
  save(input: GeneratedImageStorageInput): Promise<GeneratedImageAttachment>;
}

type ImageModelRuntimeConfig = ResolvedModelRuntimeConfig & {
  providerName: string;
};

type ImageGenerationServiceOptions = Readonly<{
  modelConfigProvider?: () => Promise<ImageModelRuntimeConfig>;
  authorizeModelAccess?: (
    config: ResolvedModelRuntimeConfig,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  storage: GeneratedImageStoragePort;
}>;

type ImagePayload = Readonly<{
  base64: string;
  byteLength: number;
  mimeType: GeneratedImageMimeType;
}>;

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MAX_PROVIDER_ERROR_CHARACTERS = 600;

function providerError(value: string) {
  return value
    .replace(/\b(?:ak|sk)-[A-Za-z0-9._-]+\b/giu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_PROVIDER_ERROR_CHARACTERS);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalBase64(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/gu, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      normalized,
    )
  ) {
    return null;
  }
  return normalized;
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodeBase64Prefix(value: string, byteLimit = 16) {
  const bytes: number[] = [];
  for (
    let offset = 0;
    offset < value.length && bytes.length < byteLimit;
    offset += 4
  ) {
    const chunk = value.slice(offset, offset + 4);
    const first = BASE64_ALPHABET.indexOf(chunk[0]!);
    const second = BASE64_ALPHABET.indexOf(chunk[1]!);
    const third = chunk[2] === "=" ? 0 : BASE64_ALPHABET.indexOf(chunk[2]!);
    const fourth = chunk[3] === "=" ? 0 : BASE64_ALPHABET.indexOf(chunk[3]!);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) break;
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((combined >> 16) & 0xff);
    if (chunk[2] !== "=") bytes.push((combined >> 8) & 0xff);
    if (chunk[3] !== "=") bytes.push(combined & 0xff);
  }
  return new Uint8Array(bytes.slice(0, byteLimit));
}

function mimeTypeForBytes(bytes: Uint8Array): GeneratedImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(combined >> 18) & 63];
    output += BASE64_ALPHABET[(combined >> 12) & 63];
    output +=
      second === undefined ? "=" : BASE64_ALPHABET[(combined >> 6) & 63];
    output += third === undefined ? "=" : BASE64_ALPHABET[combined & 63];
  }
  return output;
}

function validatedPayload(base64Value: unknown): ImagePayload {
  const base64 = canonicalBase64(base64Value);
  if (!base64) throw new Error("图片模型返回了无效的 Base64 数据。");
  const byteLength = base64ByteLength(base64);
  if (byteLength <= 0 || byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("图片模型返回的文件大小不受支持。");
  }
  const mimeType = mimeTypeForBytes(decodeBase64Prefix(base64));
  if (!mimeType) {
    throw new Error("图片模型返回了不受支持的图片格式。");
  }
  return { base64, byteLength, mimeType };
}

async function payloadFromUrl(
  rawUrl: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ImagePayload> {
  if (typeof rawUrl !== "string") {
    throw new Error("图片模型没有返回可读取的图片数据。");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("图片模型返回了无效的下载地址。");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("图片模型返回的下载地址不安全。");
  }
  const response = await fetchImpl(url.href, {
    method: "GET",
    headers: { Accept: "image/png,image/jpeg,image/webp" },
    signal,
  });
  if (!response.ok) throw new Error("图片下载失败，请重试。");
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_GENERATED_IMAGE_BYTES
  ) {
    throw new Error("图片模型返回的文件超过 10 MiB 限制。");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("图片模型返回的文件大小不受支持。");
  }
  const mimeType = mimeTypeForBytes(bytes);
  if (!mimeType) throw new Error("下载结果不是受支持的图片文件。");
  return {
    base64: bytesToBase64(bytes),
    byteLength: bytes.byteLength,
    mimeType,
  };
}

export async function requestOpenAICompatibleImage(
  input: Readonly<{
    baseUrl: string;
    modelId: string;
    apiKey: string;
    prompt: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  }>,
): Promise<ImagePayload> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: input.modelId, prompt: input.prompt, n: 1 }),
    signal: input.signal,
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_CHARACTERS
  ) {
    throw new Error("图片模型返回的响应超过大小限制。");
  }
  const responseText = await response.text();
  if (responseText.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
    throw new Error("图片模型返回的响应超过大小限制。");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(responseText) as unknown;
  } catch {
    if (!response.ok) {
      throw new Error(`图片模型请求失败（HTTP ${response.status}）。`);
    }
    throw new Error("图片模型返回了无法解析的响应。");
  }
  if (!response.ok) {
    const root = record(decoded);
    const error = record(root?.error);
    const message = providerError(
      typeof error?.message === "string"
        ? error.message
        : typeof root?.message === "string"
          ? root.message
          : "",
    );
    throw new Error(
      message
        ? `图片模型请求失败：${message}`
        : `图片模型请求失败（HTTP ${response.status}）。`,
    );
  }
  const root = record(decoded);
  const first = Array.isArray(root?.data) ? record(root.data[0]) : null;
  if (!first) throw new Error("图片模型没有返回图片结果。");
  if (first.b64_json !== undefined) return validatedPayload(first.b64_json);
  return payloadFromUrl(first.url, fetchImpl, input.signal);
}

async function defaultImageModelConfigProvider(): Promise<ImageModelRuntimeConfig> {
  const { loadModelRuntimeConfig, loadModelRegistry } =
    await import("@/infrastructure/model-config");
  const [config, registry] = await Promise.all([
    loadModelRuntimeConfig("imageGeneration"),
    loadModelRegistry(),
  ]);
  const providerName =
    registry?.providers.find((provider) => provider.id === config.providerId)
      ?.name ?? config.providerId;
  return { ...config, providerName };
}

function capabilityForConfig(
  config: ImageModelRuntimeConfig,
): ImageGenerationCapability {
  return {
    providerId: config.providerId,
    providerName: config.providerName,
    modelProfileId: config.modelProfileId,
    modelId: config.model,
  };
}

export class OpenAICompatibleImageGenerationService implements AgentImageGenerationPort {
  readonly #modelConfigProvider: () => Promise<ImageModelRuntimeConfig>;
  readonly #authorizeModelAccess?: ImageGenerationServiceOptions["authorizeModelAccess"];
  readonly #fetchImpl: typeof fetch;
  readonly #storage: GeneratedImageStoragePort;

  constructor(options: ImageGenerationServiceOptions) {
    this.#modelConfigProvider =
      options.modelConfigProvider ?? defaultImageModelConfigProvider;
    this.#authorizeModelAccess = options.authorizeModelAccess;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#storage = options.storage;
  }

  async capability() {
    try {
      const config = await this.#modelConfigProvider();
      return config.capabilities.imageGeneration
        ? capabilityForConfig(config)
        : null;
    } catch {
      return null;
    }
  }

  async generate(input: ImageGenerationInput) {
    if (input.signal?.aborted) throw new Error("图片生成已取消。");
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 4_000) {
      throw new Error("图片描述需要为 1 到 4,000 个字符。");
    }
    const config = await this.#modelConfigProvider();
    if (!config.capabilities.imageGeneration) {
      throw new Error("配置的模型没有启用图片生成用途。");
    }
    if (
      this.#authorizeModelAccess &&
      !(await this.#authorizeModelAccess(config, input.signal))
    ) {
      throw new Error("你没有同意向图片生成模型发送本次描述。");
    }
    const payload = await requestOpenAICompatibleImage({
      baseUrl: config.baseUrl,
      modelId: config.model,
      apiKey: config.apiKey,
      prompt,
      signal: input.signal,
      fetchImpl: this.#fetchImpl,
    });
    if (input.signal?.aborted) throw new Error("图片生成已取消。");
    const capability = capabilityForConfig(config);
    const attachment = await this.#storage.save({
      conversationId: input.conversationId,
      projectId: input.projectId,
      ...payload,
      providerName: capability.providerName,
      modelId: capability.modelId,
    });
    return { attachment, capability };
  }
}
