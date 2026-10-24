import { isLocalNetworkHostname } from "@boltpocket/connector-core";

export const MODEL_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];

/** Existing saved configurations migrate to an enabled, provider-safe level. */
export const DEFAULT_MODEL_THINKING_LEVEL: ModelThinkingLevel = "medium";

export type PublicModelConfig = {
  baseUrl: string;
  model: string;
  thinkingLevel: ModelThinkingLevel;
};

export type ModelRuntimeConfig = PublicModelConfig & {
  apiKey: string;
};

export type ModelConfigField = "baseUrl" | "model" | "apiKey" | "thinkingLevel";

export class ModelConfigValidationError extends Error {
  readonly field: ModelConfigField;

  constructor(field: ModelConfigField, message: string) {
    super(message);
    this.name = "ModelConfigValidationError";
    this.field = field;
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function developmentRuntimeAllowsHttpModelEndpoints() {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function requiredText(
  value: unknown,
  field: ModelConfigField,
  label: string,
  maxLength: number,
) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ModelConfigValidationError(field, `${label}不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ModelConfigValidationError(field, `${label}内容过长。`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new ModelConfigValidationError(field, `${label}包含无效字符。`);
  }
  return normalized;
}

export function normalizeModelBaseUrl(value: unknown) {
  const candidate = requiredText(value, "baseUrl", "Base URL", 2_048);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ModelConfigValidationError(
      "baseUrl",
      "Base URL 必须是有效的 HTTPS 地址，或局域网 HTTP 地址。",
    );
  }

  const permittedHttp =
    url.protocol === "http:" &&
    (developmentRuntimeAllowsHttpModelEndpoints() ||
      isLocalNetworkHostname(url.hostname));
  if (url.protocol !== "https:" && !permittedHttp) {
    throw new ModelConfigValidationError(
      "baseUrl",
      "公网 Base URL 必须使用 HTTPS；局域网地址可使用 HTTP。",
    );
  }
  if (url.username || url.password) {
    throw new ModelConfigValidationError(
      "baseUrl",
      "Base URL 不能包含用户名或密码。",
    );
  }
  if (url.search || url.hash) {
    throw new ModelConfigValidationError(
      "baseUrl",
      "Base URL 不能包含查询参数或锚点。",
    );
  }

  url.pathname =
    url.pathname === "/" ? "/v1" : url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export function normalizeModelThinkingLevel(
  value: unknown,
): ModelThinkingLevel {
  if (value === undefined) return DEFAULT_MODEL_THINKING_LEVEL;
  if (
    typeof value === "string" &&
    MODEL_THINKING_LEVELS.some((candidate) => candidate === value)
  ) {
    return value as ModelThinkingLevel;
  }
  throw new ModelConfigValidationError(
    "thinkingLevel",
    "思考强度不是支持的等级。",
  );
}

export function validatePublicModelConfig(input: {
  baseUrl: unknown;
  model: unknown;
  thinkingLevel?: unknown;
}): PublicModelConfig {
  return {
    baseUrl: normalizeModelBaseUrl(input.baseUrl),
    model: requiredText(input.model, "model", "模型名称", 256),
    thinkingLevel: normalizeModelThinkingLevel(input.thinkingLevel),
  };
}

export function validateModelConfig(input: {
  baseUrl: unknown;
  model: unknown;
  apiKey: unknown;
  thinkingLevel?: unknown;
}): ModelRuntimeConfig {
  return {
    ...validatePublicModelConfig(input),
    apiKey: requiredText(input.apiKey, "apiKey", "API Key", 8_192),
  };
}
