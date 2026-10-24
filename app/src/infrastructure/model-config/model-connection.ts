import type { ModelRuntimeConfig } from "./model-config-validation.ts";
import { validateModelConfig } from "./model-config-validation.ts";

export type ModelConnectionResult = {
  model: string;
  latencyMs: number;
};

export type ModelConnectionTestOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class ModelConnectionError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ModelConnectionError";
    this.status = status;
  }
}

function connectionFailureMessage(status: number) {
  if (status === 401 || status === 403) {
    return "API Key 无效，或没有访问该模型的权限。";
  }
  if (status === 404) {
    return "没有找到兼容接口或指定模型，请检查 Base URL 和模型名称。";
  }
  if (status === 429) {
    return "模型服务当前限流，请稍后重试。";
  }
  return `连接测试失败（HTTP ${status}）。`;
}

export async function testModelConnection(
  input: ModelRuntimeConfig,
  options: ModelConnectionTestOptions = {},
): Promise<ModelConnectionResult> {
  const config = validateModelConfig(input);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 60_000
  ) {
    throw new ModelConnectionError("连接测试超时时间无效。");
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: config.thinkingLevel === "off" ? 1 : 32,
        ...(config.thinkingLevel === "off"
          ? {}
          : { reasoning_effort: config.thinkingLevel }),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ModelConnectionError(
        connectionFailureMessage(response.status),
        response.status,
      );
    }
    return {
      model: config.model,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof ModelConnectionError) throw error;
    if (controller.signal.aborted) {
      throw new ModelConnectionError(
        options.signal?.aborted ? "连接测试已取消。" : "连接模型服务超时。",
      );
    }
    throw new ModelConnectionError("无法连接模型服务，请检查网络和 Base URL。");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
