import {
  compiledDistributionRegion,
  distributionProfile,
  type DistributionAiService,
  type DistributionProfile,
  type DistributionRegion,
  parseDistributionRegion,
} from "./distribution";

export const AI_CONSENT_POLICY_VERSION = "2026-08-21";
export const APP_FILING_QUERY_URL = "https://beian.miit.gov.cn/";

export type { DistributionRegion } from "./distribution";
export type RegisteredAiService = DistributionAiService;

export type DistributionCapabilities = DistributionProfile["capabilities"];

export type ComplianceConfig = {
  distributionRegion: DistributionRegion;
  operatorName: string | null;
  operatorAddress: string | null;
  supportEmail: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  appFilingNumber: string | null;
  websiteIcpFilingNumber: string | null;
  registeredAiServices: RegisteredAiService[];
  capabilities: DistributionCapabilities;
};

/** Pure test/release-check overrides; production code uses the signed profile. */
export type ComplianceEnvironment = {
  distributionRegion?: string;
  operatorName?: string | null;
  operatorAddress?: string | null;
  supportEmail?: string | null;
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  appFilingNumber?: string | null;
  websiteIcpFilingNumber?: string | null;
  registeredAiServices?: readonly RegisteredAiService[];
  capabilities?: Partial<DistributionCapabilities>;
};

function environmentForProfile(
  profile: DistributionProfile,
): Readonly<ComplianceEnvironment> {
  return {
    distributionRegion: profile.region,
    operatorName: profile.operatorName,
    operatorAddress: profile.operatorAddress,
    supportEmail: profile.supportEmail,
    privacyPolicyUrl: profile.privacyPolicyUrl,
    termsUrl: profile.termsUrl,
    appFilingNumber: profile.appFilingNumber,
    websiteIcpFilingNumber: profile.websiteIcpFilingNumber,
    registeredAiServices: profile.registeredAiServices,
    capabilities: profile.capabilities,
  };
}

export const DEFAULT_GLOBAL_COMPLIANCE_ENVIRONMENT = environmentForProfile(
  distributionProfile("global"),
);
export const DEFAULT_CHINA_MAINLAND_COMPLIANCE_ENVIRONMENT =
  environmentForProfile(distributionProfile("china-mainland"));

/**
 * Only the distribution region is read from the build environment. Every
 * public legal, service, model, and capability value comes from source code.
 */
export function complianceEnvironmentFromProcess(
  environment?: Readonly<Record<string, string | undefined>>,
): Readonly<ComplianceEnvironment> {
  const region = environment
    ? compiledDistributionRegion(
        environment.EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION,
      )
    : compiledDistributionRegion();
  return environmentForProfile(distributionProfile(region));
}

function optionalText(value: string | null | undefined, maximum = 2_048) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error("合规配置包含无效文本。");
  }
  return normalized;
}

function httpsUrl(
  value: string | null | undefined,
  label: string,
): string | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label}必须是有效的 HTTPS 地址。`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${label}必须是无凭据、无锚点的 HTTPS 地址。`);
  }
  return url.toString();
}

function email(value: string | null | undefined) {
  const normalized = optionalText(value, 320);
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("客服邮箱格式无效。");
  }
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRegistryText(
  value: Record<string, unknown>,
  key: keyof RegisteredAiService,
  maximum: number,
) {
  const item = value[key];
  if (
    typeof item !== "string" ||
    !item.trim() ||
    item.trim().length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(item)
  ) {
    throw new Error(`AI 服务登记表字段 ${key} 无效。`);
  }
  return item.trim();
}

function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AI 服务登记表的 baseUrl 无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("AI 服务登记表的 baseUrl 必须是安全的 HTTPS 地址。");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

function parseAiServiceRegistry(value: readonly RegisteredAiService[]) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("AI 服务登记表必须是最多 32 项的数组。");
  }
  const services = value.map((item): RegisteredAiService => {
    if (!record(item)) throw new Error("AI 服务登记表包含无效条目。");
    return {
      providerId: requiredRegistryText(item, "providerId", 240),
      providerName: requiredRegistryText(item, "providerName", 320),
      baseUrl: normalizeBaseUrl(requiredRegistryText(item, "baseUrl", 2_048)),
      modelId: requiredRegistryText(item, "modelId", 256),
      modelName: requiredRegistryText(item, "modelName", 320),
      recipientName: requiredRegistryText(item, "recipientName", 320),
      recipientLocation: requiredRegistryText(item, "recipientLocation", 120),
      filingNumber: requiredRegistryText(item, "filingNumber", 240),
    };
  });
  const identities = services.map(
    (service) => `${service.baseUrl}\0${service.modelId}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("AI 服务登记表存在重复的 Base URL 与模型组合。");
  }
  return services;
}

export function loadComplianceConfig(
  input: ComplianceEnvironment = complianceEnvironmentFromProcess(),
): ComplianceConfig {
  const region = parseDistributionRegion(input.distributionRegion);
  const profile = distributionProfile(region);
  return {
    distributionRegion: region,
    operatorName: optionalText(
      input.operatorName === undefined
        ? profile.operatorName
        : input.operatorName,
      320,
    ),
    operatorAddress: optionalText(
      input.operatorAddress === undefined
        ? profile.operatorAddress
        : input.operatorAddress,
      1_024,
    ),
    supportEmail: email(
      input.supportEmail === undefined
        ? profile.supportEmail
        : input.supportEmail,
    ),
    privacyPolicyUrl: httpsUrl(
      input.privacyPolicyUrl === undefined
        ? profile.privacyPolicyUrl
        : input.privacyPolicyUrl,
      "隐私政策地址",
    ),
    termsUrl: httpsUrl(
      input.termsUrl === undefined ? profile.termsUrl : input.termsUrl,
      "用户协议地址",
    ),
    appFilingNumber: optionalText(
      input.appFilingNumber === undefined
        ? profile.appFilingNumber
        : input.appFilingNumber,
      240,
    ),
    websiteIcpFilingNumber: optionalText(
      input.websiteIcpFilingNumber === undefined
        ? profile.websiteIcpFilingNumber
        : input.websiteIcpFilingNumber,
      240,
    ),
    registeredAiServices: parseAiServiceRegistry(
      input.registeredAiServices ?? profile.registeredAiServices,
    ),
    capabilities: {
      ...profile.capabilities,
      ...input.capabilities,
    },
  };
}

export function registeredAiServiceForModel(
  config: ComplianceConfig,
  input: { baseUrl: string; model: string },
) {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch {
    return undefined;
  }
  return config.registeredAiServices.find(
    (service) => service.baseUrl === baseUrl && service.modelId === input.model,
  );
}

export function assertModelPermittedForDistribution(
  config: ComplianceConfig,
  input: { baseUrl: string; model: string },
) {
  const service = registeredAiServiceForModel(config, input);
  if (config.distributionRegion === "china-mainland" && !service) {
    throw new Error(
      "中国大陆发行版仅允许使用已登记并写入发行代码的生成式 AI 模型。",
    );
  }
  if (
    config.distributionRegion === "china-mainland" &&
    service &&
    !isMainlandChinaRecipient(service.recipientLocation)
  ) {
    throw new Error("当前中国大陆发行版仅允许在中国大陆境内处理的模型服务。");
  }
  return service ?? null;
}

export function assertModelEndpointPermittedForDistribution(
  config: ComplianceConfig,
  baseUrlValue: string,
) {
  if (config.distributionRegion !== "china-mainland") return;
  let baseUrl: string | undefined;
  try {
    baseUrl = normalizeBaseUrl(baseUrlValue);
  } catch {
    // Fall through to the same fail-closed release error.
  }
  if (
    !baseUrl ||
    !config.registeredAiServices.some((service) => service.baseUrl === baseUrl)
  ) {
    throw new Error("中国大陆发行版不能连接未登记的模型服务地址。");
  }
}

export function isMainlandChinaRecipient(location: string) {
  return /^(?:中国大陆|中国|CN|PRC)$/iu.test(location.trim());
}

export function thirdPartyMcpEnabled(
  config: ComplianceConfig = loadComplianceConfig(),
) {
  return config.capabilities.thirdPartyMcp;
}

export function assertThirdPartyMcpPermitted(
  config: ComplianceConfig = loadComplianceConfig(),
) {
  if (!thirdPartyMcpEnabled(config)) {
    throw new Error(
      "中国大陆发行版暂不提供第三方 MCP；接收方告知、单独同意和数据出境机制完成前保持关闭。",
    );
  }
}

export function generatedImagesEnabled(
  config: ComplianceConfig = loadComplianceConfig(),
) {
  return config.capabilities.generatedImages;
}

export function generatedVideoEnabled(
  config: ComplianceConfig = loadComplianceConfig(),
) {
  return config.capabilities.generatedVideo;
}

export type ChinaReleaseConfigurationIssueCode =
  | "region"
  | "operatorName"
  | "operatorAddress"
  | "supportEmail"
  | "privacyUrl"
  | "termsUrl"
  | "appFiling"
  | "websiteIcpFiling"
  | "aiRegistry"
  | "crossBorder";

export function chinaReleaseConfigurationIssueCodes(config: ComplianceConfig) {
  const issues: ChinaReleaseConfigurationIssueCode[] = [];
  if (config.distributionRegion !== "china-mainland") issues.push("region");
  if (!config.operatorName) issues.push("operatorName");
  if (!config.operatorAddress) issues.push("operatorAddress");
  if (!config.supportEmail) issues.push("supportEmail");
  if (!config.privacyPolicyUrl) issues.push("privacyUrl");
  if (!config.termsUrl) issues.push("termsUrl");
  if (!config.appFilingNumber) issues.push("appFiling");
  if (!config.websiteIcpFilingNumber) issues.push("websiteIcpFiling");
  if (config.registeredAiServices.length === 0) issues.push("aiRegistry");
  if (
    config.registeredAiServices.some(
      (service) => !isMainlandChinaRecipient(service.recipientLocation),
    )
  ) {
    issues.push("crossBorder");
  }
  return issues;
}

const CHINA_RELEASE_ISSUE_TEXT: Readonly<
  Record<ChinaReleaseConfigurationIssueCode, string>
> = {
  region: "发行地区尚未设置为 china-mainland",
  operatorName: "缺少运营主体名称",
  operatorAddress: "缺少运营主体联系地址",
  supportEmail: "缺少客服邮箱",
  privacyUrl: "缺少隐私政策 HTTPS 地址",
  termsUrl: "缺少用户协议 HTTPS 地址",
  appFiling: "缺少 APP 备案编号",
  websiteIcpFiling: "缺少 example.invalid 网站 ICP 备案编号",
  aiRegistry: "发行代码缺少已备案/登记的生成式 AI 服务清单",
  crossBorder: "当前大陆发行门禁不允许模型在中国大陆境外处理数据",
};

export function chinaReleaseConfigurationIssues(config: ComplianceConfig) {
  return chinaReleaseConfigurationIssueCodes(config).map(
    (issue) => CHINA_RELEASE_ISSUE_TEXT[issue],
  );
}

const RELEASE_PLACEHOLDER =
  /待填写|示例|your-|example\.(?:com|cn)|placeholder|replace[-_ ]?me/iu;

export function productionReleaseConfigurationIssues(
  input: ComplianceEnvironment = complianceEnvironmentFromProcess(),
): string[] {
  const issues: string[] = [];
  let config: ComplianceConfig;
  try {
    config = loadComplianceConfig(input);
  } catch (error) {
    return [error instanceof Error ? error.message : "发行配置无法读取"];
  }
  for (const [label, value] of [
    ["运营主体", config.operatorName],
    ["运营地址", config.operatorAddress],
    ["客服邮箱", config.supportEmail],
    ["隐私政策地址", config.privacyPolicyUrl],
    ["用户协议地址", config.termsUrl],
  ] as const) {
    if (!value) issues.push(`缺少${label}`);
    else if (RELEASE_PLACEHOLDER.test(value)) issues.push(`${label}仍是占位值`);
  }
  if (config.distributionRegion === "china-mainland") {
    if (
      config.appFilingNumber &&
      RELEASE_PLACEHOLDER.test(config.appFilingNumber)
    ) {
      issues.push("APP 备案编号仍是占位值");
    }
    if (
      config.websiteIcpFilingNumber &&
      RELEASE_PLACEHOLDER.test(config.websiteIcpFilingNumber)
    ) {
      issues.push("网站 ICP 备案编号仍是占位值");
    }
    issues.push(...chinaReleaseConfigurationIssues(config));
    for (const service of config.registeredAiServices) {
      if (
        Object.values(service).some((value) => RELEASE_PLACEHOLDER.test(value))
      ) {
        issues.push(`AI 服务 ${service.providerId} 仍包含占位值`);
      }
    }
  }
  return [...new Set(issues)];
}
