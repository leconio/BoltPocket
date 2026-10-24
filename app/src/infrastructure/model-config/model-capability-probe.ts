import type { ModelCapabilities } from "./model-profile-registry.ts";
import type { ModelRuntimeConfig } from "./model-config-validation.ts";
import { validateModelConfig } from "./model-config-validation.ts";

const PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export type ModelCapabilityProbeStatus =
  "supported" | "unsupported" | "unverified";

export type ModelCapabilityProbeResult = Readonly<{
  model: string;
  latencyMs: number;
  capabilities: ModelCapabilities;
  outcomes: Readonly<{
    chat: ModelCapabilityProbeStatus;
    tools: ModelCapabilityProbeStatus;
    vision: ModelCapabilityProbeStatus;
    reasoning: ModelCapabilityProbeStatus;
  }>;
}>;

export type ModelCapabilityProbeOptions = Readonly<{
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class ModelCapabilityProbeError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ModelCapabilityProbeError";
    this.status = status;
  }
}

function fatalHttpError(status: number) {
  if (status === 401 || status === 403) {
    return new ModelCapabilityProbeError(
      "API Key 无效，或没有访问该模型的权限。",
      status,
    );
  }
  if (status === 429) {
    return new ModelCapabilityProbeError(
      "模型服务当前限流，请稍后重试。",
      status,
    );
  }
  if (status >= 500) {
    return new ModelCapabilityProbeError(
      `模型服务暂时不可用（HTTP ${status}）。`,
      status,
    );
  }
  return null;
}

function isFeatureUnsupported(status: number) {
  return status === 400 || status === 404 || status === 405 || status === 422;
}

async function jsonRecord(response: Response) {
  try {
    const value = (await response.json()) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function firstMessage(value: Record<string, unknown> | null) {
  const choices = value?.choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const message = (first as Record<string, unknown>).message;
  return message && typeof message === "object" && !Array.isArray(message)
    ? (message as Record<string, unknown>)
    : null;
}

export async function probeModelCapabilities(
  input: ModelRuntimeConfig,
  options: ModelCapabilityProbeOptions = {},
): Promise<ModelCapabilityProbeResult> {
  const config = validateModelConfig(input);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 3_000 ||
    timeoutMs > 90_000
  ) {
    throw new ModelCapabilityProbeError("能力探测超时时间无效。");
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const endpoint = `${config.baseUrl}/chat/completions`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  const post = (body: Record<string, unknown>) =>
    fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.model, stream: false, ...body }),
      signal: controller.signal,
    });

  try {
    const chatResponse = await post({
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: config.thinkingLevel === "off" ? 2 : 32,
      ...(config.thinkingLevel === "off"
        ? {}
        : { reasoning_effort: config.thinkingLevel }),
    });
    if (!chatResponse.ok) {
      throw (
        fatalHttpError(chatResponse.status) ??
        new ModelCapabilityProbeError(
          `对话能力探测失败（HTTP ${chatResponse.status}）。`,
          chatResponse.status,
        )
      );
    }

    const toolsResponse = await post({
      messages: [
        {
          role: "system",
          content:
            "This is a provider compatibility test. Call capability_probe exactly once with value ready before answering.",
        },
        {
          role: "user",
          content: "Run the required capability probe now.",
        },
      ],
      max_tokens: 128,
      tools: [
        {
          type: "function",
          function: {
            name: "capability_probe",
            description: "Return the requested probe value.",
            parameters: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
        },
      ],
    });
    const toolFatal = toolsResponse.ok
      ? null
      : fatalHttpError(toolsResponse.status);
    if (toolFatal) throw toolFatal;
    const toolMessage = toolsResponse.ok
      ? firstMessage(await jsonRecord(toolsResponse))
      : null;
    const toolCalls = toolMessage?.tool_calls;
    const toolsSupported =
      Array.isArray(toolCalls) &&
      toolCalls.some((call) => {
        if (!call || typeof call !== "object" || Array.isArray(call)) {
          return false;
        }
        const fn = (call as Record<string, unknown>).function;
        return (
          fn &&
          typeof fn === "object" &&
          !Array.isArray(fn) &&
          (fn as Record<string, unknown>).name === "capability_probe"
        );
      });

    const visionResponse = await post({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this one-pixel image briefly." },
            { type: "image_url", image_url: { url: PROBE_IMAGE } },
          ],
        },
      ],
      max_tokens: 16,
    });
    const visionFatal = visionResponse.ok
      ? null
      : fatalHttpError(visionResponse.status);
    if (visionFatal) throw visionFatal;
    const visionUnsupported =
      !visionResponse.ok && isFeatureUnsupported(visionResponse.status);
    const visionStatus: ModelCapabilityProbeStatus = visionResponse.ok
      ? "supported"
      : visionUnsupported
        ? "unsupported"
        : "unverified";

    const reasoningStatus: ModelCapabilityProbeStatus =
      config.thinkingLevel === "off" ? "unverified" : "supported";
    return {
      model: config.model,
      latencyMs: Math.max(0, Date.now() - startedAt),
      capabilities: {
        chat: true,
        tools: toolsSupported,
        vision: visionStatus === "supported",
        reasoning: reasoningStatus === "supported",
        imageGeneration: false,
        videoGeneration: false,
      },
      outcomes: {
        chat: "supported",
        tools: toolsSupported ? "supported" : "unsupported",
        vision: visionStatus,
        reasoning: reasoningStatus,
      },
    };
  } catch (error) {
    if (error instanceof ModelCapabilityProbeError) throw error;
    if (controller.signal.aborted) {
      throw new ModelCapabilityProbeError(
        options.signal?.aborted ? "能力探测已取消。" : "能力探测超时。",
      );
    }
    throw new ModelCapabilityProbeError("无法连接模型服务，请检查网络和地址。");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
