import type { ComplianceConfig } from "@/config/compliance";

export const COMPLIANCE_DOCUMENT_IDS = [
  "privacy",
  "terms",
  "ai-rules",
  "third-parties",
  "personal-information",
  "permissions",
] as const;
export type ComplianceDocumentId = (typeof COMPLIANCE_DOCUMENT_IDS)[number];
export type ComplianceDocument = {
  id: ComplianceDocumentId;
  title: string;
  markdown: string;
};
type Localized = { en: string; "zh-CN": string };
const titles: Record<ComplianceDocumentId, Localized> = {
  privacy: { en: "Privacy policy", "zh-CN": "隐私说明" },
  terms: { en: "Terms of service", "zh-CN": "使用条款" },
  "ai-rules": { en: "AI usage rules", "zh-CN": "AI 使用规则" },
  "third-parties": { en: "Third-party services", "zh-CN": "第三方服务" },
  "personal-information": {
    en: "Personal information",
    "zh-CN": "个人信息处理说明",
  },
  permissions: { en: "Permissions", "zh-CN": "设备权限说明" },
};
const content: Record<ComplianceDocumentId, Localized> = {
  privacy: {
    en: "BoltPocket runs without an account or an operator-run backend. Native model inference runs on this device. When you choose a configured API model, approved messages and context are sent directly to that provider. Provider retention and processing policies depend on the service you choose. Model API keys and connection credentials use platform secure storage. Project and conversation state is stored locally; model files and runtime caches also use app storage.",
    "zh-CN":
      "BoltPocket 无需账号，也不依赖运营者自建后端。本地模型推理在当前设备执行；选择自行配置的 API 模型时，经授权的消息和上下文直接发送给该服务商。服务商的数据处理和保留规则以你选择的服务为准。模型密钥和连接凭据使用系统安全存储，项目与对话状态保存在本机，模型文件和运行缓存也使用 App 存储。",
  },
  terms: {
    en: "BoltPocket is an experimental mobile agent. Verify generated content and code before relying on it. Model downloads have their own upstream licenses. User-configured model APIs, SSH hosts, MCP services and public source repositories may have separate terms and costs. Project writes retain the host's text Diff, version check and recovery workflow.",
    "zh-CN":
      "BoltPocket 是实验性的移动端 Agent。请核对生成的内容和代码。下载模型适用各自的上游许可；自行配置的模型 API、SSH、MCP 以及公开代码源可能有独立条款和费用。项目写入保留宿主提供的文本 Diff、版本核对和恢复流程。",
  },
  "ai-rules": {
    en: "Local model inference and external API inference are separate choices. Check the active model before sending a message. External-model consent identifies the recipient, model and data categories. A model's generated text is not proof that a tool ran: inspect the execution result, Diff and receipt. Changing a model does not grant it additional device or project permissions.",
    "zh-CN":
      "本地模型和外部 API 是独立的推理选项，发送前请核对当前模型。外部模型的数据授权会说明接收方、模型和数据类别。模型声称已执行工具不构成执行证据，应以工具结果、Diff 和回执为准。切换模型不会增加它的设备权限或项目访问范围。",
  },
  "third-parties": {
    en: "External requests go directly to services selected by the user: model APIs, SSH hosts, MCP servers and explicitly opened public URLs or repositories. API tokens for direct connections stay in the device credential vault and are scoped to their intended endpoint. Mini-app networking requires the host's origin and capability grants. There is no BoltPocket account, document-authorization broker, Skill Market server or reporting service.",
    "zh-CN":
      "外部请求直接发送到用户选择的模型 API、SSH 主机、MCP 服务，以及明确打开的公开网址或代码仓库。直连凭据保存在设备密码本中，并限制在相应服务地址使用。小程序联网受宿主的地址与能力授权控制。本 App 不提供账号、云文档授权代理、Skill 市场或上报服务。",
  },
  "personal-information": {
    en: "Device storage can contain conversations, project files, memories, Skills, model downloads, runtime caches and diagnostic records. You control the project and conversation data through the app. Removing the app or its data can remove local files; preserve required copies before doing so. The app does not synchronize these records through an operator-run account service.",
    "zh-CN":
      "设备存储可能包含对话、项目文件、记忆、Skill、模型下载、运行缓存和诊断记录。你可以在 App 中管理项目及对话数据。删除 App 或其数据可能移除本地文件，操作前请保留需要的副本。本 App 不通过运营者账号服务同步这些记录。",
  },
  permissions: {
    en: "Camera, microphone, photo, file and other device features request the relevant OS permission when used. Location access is disabled by default and requires explicit approval when enabled. Mini-app access is limited by the host's purpose and permission grants; closing the preview ends its active access. SSH and MCP use the endpoints and credentials configured by the user.",
    "zh-CN":
      "相机、麦克风、照片、文件等设备功能在使用时请求相应系统权限。位置访问默认关闭，启用后仍需明确授权。小程序的设备访问受宿主提供的用途和授权范围限制，关闭预览会结束活动访问。SSH 和 MCP 使用用户配置的地址与凭据。",
  },
};

export function complianceDocument(
  id: ComplianceDocumentId,
  config: ComplianceConfig,
  locale: "en" | "zh-CN" = "zh-CN",
): ComplianceDocument {
  const title = titles[id][locale];
  const sections = [`# ${title}`, content[id][locale]];
  if (id === "privacy" || id === "personal-information" || id === "ai-rules") {
    sections.push(
      locale === "en"
        ? "You can withdraw all AI data consent in Settings → Privacy & data. Later external model requests require a new grant. Withdrawal does not erase data already processed by an external provider."
        : "你可以在“设置 → 隐私与数据”撤回全部 AI 数据授权，之后的外部模型请求需要重新授权；撤回不会清除服务商已处理的数据。",
    );
  }
  if (config.distributionRegion === "china-mainland") {
    sections.push(
      locale === "en"
        ? "The local consent gate is checked before Agent, WebView and connector initialization. Mainland use requires confirmation that you are at least 18 years old. The device records the consent version, time, adulthood confirmation and full document digests. Permissions are requested when used, rather than in a batch at startup."
        : "中国大陆配置在 Agent、WebView 和连接初始化前检查本机同意状态，并要求确认已满 18 周岁。本机保存同意版本、时间、成年资格确认与完整文档摘要。设备权限在使用时申请，不会在启动时批量申请。",
    );
  }
  if (config.operatorName)
    sections.push(
      `${locale === "en" ? "Maintainer" : "维护方"}: ${config.operatorName}`,
    );
  if (config.supportEmail)
    sections.push(
      `${locale === "en" ? "Contact" : "联系方式"}: ${config.supportEmail}`,
    );
  if (config.registeredAiServices.length) {
    sections.push(
      config.registeredAiServices
        .map(
          (service) =>
            `- ${service.providerName} / ${service.modelName}: ${service.recipientName}; ${service.recipientLocation}; ${service.filingNumber}`,
        )
        .join("\n"),
    );
  } else if (config.distributionRegion === "china-mainland") {
    sections.push(
      locale === "en"
        ? "Draft: model registration and release facts are incomplete. This configuration must not be used for a formal Mainland China release."
        : "模型登记与发行资料尚不完整，此配置不得作为中国大陆正式发布版本。",
    );
  }
  return { id, title, markdown: sections.join("\n\n") };
}
export function isComplianceDocumentId(
  value: unknown,
): value is ComplianceDocumentId {
  return (
    typeof value === "string" &&
    (COMPLIANCE_DOCUMENT_IDS as readonly string[]).includes(value)
  );
}
