import { createOpenAICompatiblePiRuntime } from "@boltpocket/agent-runtime";

import type {
  AgentMediaAnalysisPort,
  MediaAnalysisInput,
} from "@/application/ports/media-analysis";
import { boundText, AGENT_TEXT_LIMITS } from "@/application/bounded-text";
import type { ResolvedModelRuntimeConfig } from "@/infrastructure/model-config";
import { expoModelFetch } from "@/infrastructure/model-config/expo-model-fetch";
import { translateMessage } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

type VisionSpecialistOptions = Readonly<{
  modelConfigProvider?: () => Promise<ResolvedModelRuntimeConfig>;
  authorizeModelAccess?: (
    config: ResolvedModelRuntimeConfig,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  locale?: () => AppLocale;
}>;

function visionSystemPrompt(locale: AppLocale) {
  return [
    "You are a read-only visual analysis specialist controlled by a parent Agent.",
    "Inspect only the supplied images and answer the supplied question.",
    "Do not invent access to project files, credentials, browsers, tools, or prior conversation history.",
    "Clearly distinguish visible facts from uncertain inference. Preserve text exactly when doing OCR.",
    translateMessage("runtime.agent.system.replyLanguage", locale),
  ].join("\n");
}

function specialistSessionId(input: MediaAnalysisInput) {
  const safeTaskId = input.taskId
    .replace(/[^A-Za-z0-9._:-]/gu, "-")
    .slice(0, 160);
  return `vision-specialist:${safeTaskId}`;
}

export class PiVisionSpecialist implements AgentMediaAnalysisPort {
  readonly #modelConfigProvider: () => Promise<ResolvedModelRuntimeConfig>;
  readonly #authorizeModelAccess?: VisionSpecialistOptions["authorizeModelAccess"];
  readonly #locale: () => AppLocale;

  constructor(options: VisionSpecialistOptions = {}) {
    this.#modelConfigProvider =
      options.modelConfigProvider ??
      (async () => {
        const { loadModelRuntimeConfig } =
          await import("@/infrastructure/model-config");
        return loadModelRuntimeConfig("vision");
      });
    this.#authorizeModelAccess = options.authorizeModelAccess;
    this.#locale = options.locale ?? (() => "zh-CN");
  }

  async analyze(input: MediaAnalysisInput) {
    if (input.signal?.aborted) throw new Error("图片识别已取消。");
    if (input.attachments.length === 0 || input.attachments.length > 8) {
      throw new Error("图片识别需要 1 到 8 张本轮附件。");
    }
    const config = await this.#modelConfigProvider();
    if (
      this.#authorizeModelAccess &&
      !(await this.#authorizeModelAccess(config, input.signal))
    ) {
      throw new Error("你没有同意向图片识别模型发送本次附件。");
    }
    if (!config.capabilities.chat || !config.capabilities.vision) {
      throw new Error("配置的图片识别模型不支持视觉输入。");
    }
    const runtime = createOpenAICompatiblePiRuntime({
      baseUrl: config.baseUrl,
      modelId: config.model,
      apiKey: config.apiKey,
      providerKind: config.providerKind,
      protocol: config.protocol,
      supportsImages: true,
      reasoning: config.capabilities.reasoning,
      supportsReasoningEffort: config.capabilities.reasoning,
      providerTimeoutMs: 600_000,
      fetch: config.fetch ?? expoModelFetch,
      contextMaintenance: false,
    });
    const sessionId = specialistSessionId(input);
    try {
      await runtime.createSession({
        id: sessionId,
        systemPrompt: visionSystemPrompt(this.#locale()),
        tools: [],
        activeToolNames: [],
        thinkingLevel: config.capabilities.reasoning ? "medium" : "off",
      });
      const result = await runtime.send(sessionId, input.question, {
        signal: input.signal,
        images: input.attachments.map((attachment) => ({
          data: attachment.base64,
          mimeType: attachment.mimeType,
        })),
      });
      if (result.status === "cancelled") throw new Error("图片识别已取消。");
      if (result.status === "failed") {
        throw new Error(result.error || "图片识别模型运行失败。");
      }
      const content = result.text.trim();
      if (!content) throw new Error("图片识别模型没有返回结果。");
      return {
        content: boundText(content, AGENT_TEXT_LIMITS.storedResponseCharacters),
        modelRef: `${config.providerId}:${config.modelProfileId}`,
      };
    } finally {
      await runtime.destroySession(sessionId).catch(() => undefined);
    }
  }
}
