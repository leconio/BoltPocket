import type {
  AgentVideoGenerationPort,
  VideoAspectRatio,
  VideoGenerationCapability,
  VideoGenerationInput,
  VideoReferenceUrl,
} from "@/application/ports/video-generation";
import type { GeneratedVideoAttachment } from "@/domain/models";
import type { ResolvedModelRuntimeConfig } from "@/infrastructure/model-config/model-config-store";

export const MAX_GENERATED_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_CHARACTERS = 256 * 1024;
const MAX_PROVIDER_ERROR_CHARACTERS = 600;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60_000;

export type GeneratedVideoStorageInput = Readonly<{
  conversationId: string;
  projectId: string | null;
  downloadUrl: string;
  durationSeconds?: number;
  providerName: string;
  modelId: string;
  signal?: AbortSignal;
}>;

export interface GeneratedVideoStoragePort {
  saveFromUrl(
    input: GeneratedVideoStorageInput,
  ): Promise<GeneratedVideoAttachment>;
}

type VideoModelRuntimeConfig = ResolvedModelRuntimeConfig & {
  providerName: string;
};

type VideoGenerationServiceOptions = Readonly<{
  modelConfigProvider?: () => Promise<VideoModelRuntimeConfig>;
  authorizeModelAccess?: (
    config: ResolvedModelRuntimeConfig,
    dataClasses: readonly ("message" | "attachments")[],
    signal?: AbortSignal,
  ) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  storage: GeneratedVideoStoragePort;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

type SeedanceTaskResult = Readonly<{
  taskId: string;
  videoUrl: string;
}>;

function providerError(value: string) {
  return value
    .replace(/\b(?:ak|ark|sk)-[A-Za-z0-9._-]+\b/giu, "[redacted]")
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

function safeDownloadUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("视频模型没有返回可读取的视频地址。");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("视频模型返回了无效的下载地址。");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("视频模型返回的下载地址不安全。");
  }
  return url.href;
}

function safeReferenceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("视频参考素材包含无效地址。");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("视频参考素材只支持不含凭据的 HTTPS 地址。");
  }
  return url.href;
}

function referenceUrlContent(reference: VideoReferenceUrl) {
  const url = safeReferenceUrl(reference.url);
  if (reference.type === "image_url") {
    return {
      type: reference.type,
      image_url: { url },
      role: "reference_image",
    } as const;
  }
  if (reference.type === "video_url") {
    return {
      type: reference.type,
      video_url: { url },
      role: "reference_video",
    } as const;
  }
  return {
    type: reference.type,
    audio_url: { url },
    role: "reference_audio",
  } as const;
}

function usesSeedanceOneRequest(modelId: string) {
  return /^doubao-seedance-1(?:[-._]|$)/iu.test(modelId);
}

function seedanceOneContent(
  prompt: string,
  ratio: VideoAspectRatio,
  durationSeconds: number,
  imageContent: readonly Readonly<{
    type: "image_url";
    image_url: Readonly<{ url: string }>;
    role: "reference_image";
  }>[],
  remoteContent: readonly ReturnType<typeof referenceUrlContent>[],
) {
  if (durationSeconds < 5 || durationSeconds > 10) {
    throw new Error("Seedance 1.x 视频时长需要为 5 到 10 秒。");
  }
  const unsupportedReference = remoteContent.find(
    (content) => content.type !== "image_url",
  );
  if (unsupportedReference) {
    throw new Error("Seedance 1.x 只支持文本和图片参考素材。");
  }
  return [
    {
      type: "text" as const,
      text: `${prompt} --ratio ${ratio} --duration ${durationSeconds} --camerafixed false --watermark false`,
    },
    ...imageContent.map(({ role: _role, ...content }) => content),
    ...remoteContent.map(({ role: _role, ...content }) => content),
  ];
}

async function responseJson(
  response: Response,
  operation: string,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_CHARACTERS
  ) {
    throw new Error(`${operation}返回的响应超过大小限制。`);
  }
  const text = await response.text();
  if (text.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
    throw new Error(`${operation}返回的响应超过大小限制。`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      throw new Error(`${operation}失败（HTTP ${response.status}）。`);
    }
    throw new Error(`${operation}返回了无法解析的响应。`);
  }
  const root = record(decoded);
  if (!root) throw new Error(`${operation}返回了无效的响应。`);
  if (!response.ok) {
    const nested = record(root.error);
    const message = providerError(
      typeof nested?.message === "string"
        ? nested.message
        : typeof root.message === "string"
          ? root.message
          : "",
    );
    throw new Error(
      message
        ? `${operation}失败：${message}`
        : `${operation}失败（HTTP ${response.status}）。`,
    );
  }
  return root;
}

function boundedMilliseconds(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error(`${label}配置无效。`);
  }
  return candidate;
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("视频生成已取消。");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("视频生成已取消。"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (!signal) return;
    void Promise.resolve().then(() => {
      if (signal.aborted) onAbort();
    });
  });
}

export async function requestOpenAICompatibleVideo(
  input: Readonly<{
    baseUrl: string;
    modelId: string;
    apiKey: string;
    prompt: string;
    ratio: VideoAspectRatio;
    durationSeconds: number;
    generateAudio: boolean;
    referenceImages?: readonly Readonly<{
      base64: string;
      mimeType: string;
    }>[];
    referenceUrls?: readonly VideoReferenceUrl[];
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  }>,
): Promise<SeedanceTaskResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = boundedMilliseconds(
    input.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
    250,
    60_000,
    "视频轮询间隔",
  );
  const pollTimeoutMs = boundedMilliseconds(
    input.pollTimeoutMs,
    DEFAULT_POLL_TIMEOUT_MS,
    1_000,
    30 * 60_000,
    "视频生成超时",
  );
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const endpoint = `${input.baseUrl}/contents/generations/tasks`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  const referenceImages = input.referenceImages ?? [];
  const referenceUrls = input.referenceUrls ?? [];
  if (referenceImages.length + referenceUrls.length > 9) {
    throw new Error("一次最多使用 9 个参考素材。");
  }
  const imageContent = referenceImages.map((image) => {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        image.base64,
      )
    ) {
      throw new Error("参考图片格式无效。");
    }
    return {
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
      },
      role: "reference_image",
    } as const;
  });
  const remoteContent = referenceUrls.map(referenceUrlContent);
  const seedanceOne = usesSeedanceOneRequest(input.modelId);
  const created = await responseJson(
    await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        seedanceOne
          ? {
              model: input.modelId,
              content: seedanceOneContent(
                input.prompt,
                input.ratio,
                input.durationSeconds,
                imageContent,
                remoteContent,
              ),
            }
          : {
              model: input.modelId,
              content: [
                { type: "text", text: input.prompt },
                ...imageContent,
                ...remoteContent,
              ],
              generate_audio: input.generateAudio,
              ratio: input.ratio,
              duration: input.durationSeconds,
              watermark: false,
            },
      ),
      signal: input.signal,
    }),
    "创建视频任务",
  );
  if (typeof created.id !== "string" || !created.id.trim()) {
    throw new Error("视频模型没有返回任务编号。");
  }
  const taskId = created.id.trim();
  const startedAt = now();
  while (now() - startedAt <= pollTimeoutMs) {
    if (input.signal?.aborted) throw new Error("视频生成已取消。");
    await sleep(pollIntervalMs, input.signal);
    const task = await responseJson(
      await fetchImpl(`${endpoint}/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        signal: input.signal,
      }),
      "查询视频任务",
    );
    const status =
      typeof task.status === "string" ? task.status.toLowerCase() : "";
    if (status === "succeeded" || status === "completed") {
      const content = record(task.content);
      return {
        taskId,
        videoUrl: safeDownloadUrl(content?.video_url),
      };
    }
    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "canceled" ||
      status === "expired"
    ) {
      const error = record(task.error);
      const message = providerError(
        typeof error?.message === "string"
          ? error.message
          : typeof task.message === "string"
            ? task.message
            : "",
      );
      throw new Error(
        message ? `视频生成失败：${message}` : `视频生成失败（${status}）。`,
      );
    }
    if (
      status !== "queued" &&
      status !== "pending" &&
      status !== "running" &&
      status !== "processing" &&
      status !== "in_progress"
    ) {
      throw new Error("视频模型返回了无法识别的任务状态。");
    }
  }
  throw new Error("视频生成等待超时，请稍后重试。");
}

async function defaultVideoModelConfigProvider(): Promise<VideoModelRuntimeConfig> {
  const { loadModelRuntimeConfig, loadModelRegistry } =
    await import("@/infrastructure/model-config");
  const [config, registry] = await Promise.all([
    loadModelRuntimeConfig("videoGeneration"),
    loadModelRegistry(),
  ]);
  const providerName =
    registry?.providers.find((provider) => provider.id === config.providerId)
      ?.name ?? config.providerId;
  return { ...config, providerName };
}

function capabilityForConfig(
  config: VideoModelRuntimeConfig,
): VideoGenerationCapability {
  return {
    providerId: config.providerId,
    providerName: config.providerName,
    modelProfileId: config.modelProfileId,
    modelId: config.model,
  };
}

export class OpenAICompatibleVideoGenerationService implements AgentVideoGenerationPort {
  readonly #modelConfigProvider: () => Promise<VideoModelRuntimeConfig>;
  readonly #authorizeModelAccess?: VideoGenerationServiceOptions["authorizeModelAccess"];
  readonly #fetchImpl: typeof fetch;
  readonly #storage: GeneratedVideoStoragePort;
  readonly #pollIntervalMs?: number;
  readonly #pollTimeoutMs?: number;
  readonly #now?: () => number;
  readonly #sleep?: VideoGenerationServiceOptions["sleep"];

  constructor(options: VideoGenerationServiceOptions) {
    this.#modelConfigProvider =
      options.modelConfigProvider ?? defaultVideoModelConfigProvider;
    this.#authorizeModelAccess = options.authorizeModelAccess;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#storage = options.storage;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.#pollTimeoutMs = options.pollTimeoutMs;
    this.#now = options.now;
    this.#sleep = options.sleep;
  }

  async capability() {
    try {
      const config = await this.#modelConfigProvider();
      return config.capabilities.videoGeneration
        ? capabilityForConfig(config)
        : null;
    } catch {
      return null;
    }
  }

  async generate(input: VideoGenerationInput) {
    if (input.signal?.aborted) throw new Error("视频生成已取消。");
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 8_000) {
      throw new Error("视频描述需要为 1 到 8,000 个字符。");
    }
    const durationSeconds = input.durationSeconds ?? 5;
    if (
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds < 2 ||
      durationSeconds > 15
    ) {
      throw new Error("视频时长需要为 2 到 15 秒。");
    }
    const config = await this.#modelConfigProvider();
    if (!config.capabilities.videoGeneration) {
      throw new Error("配置的模型没有启用视频生成用途。");
    }
    if (
      this.#authorizeModelAccess &&
      !(await this.#authorizeModelAccess(
        config,
        input.referenceImages?.length || input.referenceUrls?.length
          ? ["message", "attachments"]
          : ["message"],
        input.signal,
      ))
    ) {
      throw new Error("你没有同意向视频生成模型发送本次描述。");
    }
    const capability = capabilityForConfig(config);
    const result = await requestOpenAICompatibleVideo({
      baseUrl: config.baseUrl,
      modelId: config.model,
      apiKey: config.apiKey,
      prompt,
      ratio: input.ratio ?? "16:9",
      durationSeconds,
      generateAudio: input.generateAudio ?? true,
      referenceImages: input.referenceImages,
      referenceUrls: input.referenceUrls,
      signal: input.signal,
      fetchImpl: this.#fetchImpl,
      pollIntervalMs: this.#pollIntervalMs,
      pollTimeoutMs: this.#pollTimeoutMs,
      now: this.#now,
      sleep: this.#sleep,
    });
    if (input.signal?.aborted) throw new Error("视频生成已取消。");
    const attachment = await this.#storage.saveFromUrl({
      conversationId: input.conversationId,
      projectId: input.projectId,
      downloadUrl: result.videoUrl,
      durationSeconds,
      providerName: capability.providerName,
      modelId: capability.modelId,
      signal: input.signal,
    });
    return {
      attachment,
      capability,
      providerTaskId: result.taskId,
    };
  }
}
