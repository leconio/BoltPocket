import { LOCAL_INFERENCE, LOCAL_PROVIDER_ID } from "@/config/local-inference";
const PROVIDER_PATTERN = /^[a-z0-9._-]{1,64}$/u;
const MODEL_PATTERN = /^[a-z0-9._:/-]{1,160}$/u;
const CACHE_SECONDS = 5 * 60;
const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

type ModelIdentity = Readonly<{ providerId?: string; model: string }>;
type ModelSafetyEndpointConfig = Readonly<{
  baseUrl: string;
  returnUrl?: string;
}>;

export class ModelSafetyPolicy {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #cache = new Map<string, number>();

  constructor(
    config: ModelSafetyEndpointConfig,
    options: {
      fetch?: typeof fetch;
      now?: () => number;
      requestTimeoutMs?: number;
    } = {},
  ) {
    this.#baseUrl = config.baseUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new Error("模型安全检查超时配置无效。");
    }
  }

  async assertAllowed(identity: ModelIdentity, signal?: AbortSignal) {
    if (LOCAL_INFERENCE && identity.providerId === LOCAL_PROVIDER_ID) {
      if (signal?.aborted) throw new Error("cancelled");
      return;
    }
    const provider = (identity.providerId ?? "openai-compatible").toLowerCase();
    const model = identity.model.toLowerCase();
    if (!PROVIDER_PATTERN.test(provider) || !MODEL_PATTERN.test(model)) {
      throw new Error("模型标识不符合内容安全检查要求。");
    }
    const key = `${provider}:${model}`;
    const cachedUntil = this.#cache.get(key) ?? 0;
    if (cachedUntil > this.#now()) return;

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, this.#requestTimeoutMs);
    let body: string;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/safety/model-check`, {
        method: "POST",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, provider }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("oversized model safety response");
      }
      body = await response.text();
    } catch (error) {
      throw new Error("暂时无法完成模型内容安全检查，请稍后重试。", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("模型内容安全服务返回了无效结果。");
    }
    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      value = null;
    }
    if (
      !response.ok ||
      !isRecord(value) ||
      typeof value.allowed !== "boolean" ||
      !Number.isSafeInteger(value.checkedAt) ||
      (value.checkedAt as number) <= 0
    ) {
      throw new Error("模型内容安全服务返回了无效结果。");
    }
    if (!value.allowed) {
      this.#cache.delete(key);
      throw new Error("该模型已被当前发行版本暂停使用，请选择其他模型。");
    }
    this.#cache.set(key, this.#now() + CACHE_SECONDS);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
