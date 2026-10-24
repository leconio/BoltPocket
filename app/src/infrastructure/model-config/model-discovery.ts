import { validateModelConfig } from "./model-config-validation";

const MAX_MODEL_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_COUNT = 2_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type ModelDiscoveryOptions = Readonly<{
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class ModelDiscoveryError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ModelDiscoveryError";
    this.status = status;
  }
}

function failureMessage(status: number) {
  if (status === 401 || status === 403) {
    return "API Key 无效，或没有读取模型列表的权限。";
  }
  if (status === 404) {
    return "服务没有提供兼容的模型列表接口。";
  }
  if (status === 429) return "模型服务当前限流，请稍后重试。";
  return `获取模型失败（HTTP ${status}）。`;
}

function parseModelNames(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelDiscoveryError("模型列表响应格式无效。");
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length > MAX_MODEL_COUNT) {
    throw new ModelDiscoveryError("模型列表响应格式无效或数量过多。");
  }
  const names: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as Record<string, unknown>).id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 256 ||
      CONTROL_CHARACTERS.test(id)
    ) {
      continue;
    }
    names.push(id.trim());
  }
  const unique = [...new Set(names)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (unique.length === 0) {
    throw new ModelDiscoveryError("服务没有返回可用模型。");
  }
  return unique;
}

export async function discoverModelNames(
  input: { baseUrl: unknown; apiKey: unknown },
  options: ModelDiscoveryOptions = {},
) {
  const config = validateModelConfig({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: "model-discovery",
    thinkingLevel: "off",
  });
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 60_000
  ) {
    throw new ModelDiscoveryError("获取模型超时时间无效。");
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetch ?? fetch)(
      `${config.baseUrl}/models`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new ModelDiscoveryError(
        failureMessage(response.status),
        response.status,
      );
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_MODEL_RESPONSE_BYTES
    ) {
      throw new ModelDiscoveryError("模型列表响应过大。");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MODEL_RESPONSE_BYTES) {
      throw new ModelDiscoveryError("模型列表响应过大。");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ModelDiscoveryError("模型列表不是有效 JSON。");
    }
    return parseModelNames(parsed);
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw error;
    if (controller.signal.aborted) {
      throw new ModelDiscoveryError(
        options.signal?.aborted ? "获取模型已取消。" : "获取模型超时。",
      );
    }
    throw new ModelDiscoveryError("无法获取模型，请检查网络和 Base URL。");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
