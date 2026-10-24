import type { FirstPartyApiConfig } from "@/config/first-party-api";

export type McpCatalogRegion = "china-mainland" | "global";
export type McpCatalogSupport = "available" | "phase-one";
export type McpCatalogLocalizedText = Readonly<{ en: string; zhCN: string }>;

export type McpCatalogAuthentication =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "oauth" }>
  | Readonly<{
      credentialLabel: McpCatalogLocalizedText;
      kind: "token";
      parameterName?: string;
      placement: "bearer" | "header" | "query";
    }>;

export type McpCatalogEntry = Readonly<{
  configuration: Readonly<{
    authentication: McpCatalogAuthentication;
    serverUrl: string;
  }>;
  description: McpCatalogLocalizedText;
  documentationUrl: string;
  id: string;
  name: McpCatalogLocalizedText;
  provider: McpCatalogLocalizedText;
  support: McpCatalogSupport;
}>;

export type McpCatalog = Readonly<{
  catalogVersion: string;
  region: McpCatalogRegion;
  services: readonly McpCatalogEntry[];
}>;

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_SERVICES = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const SAFE_PARAMETER = /^[A-Za-z][A-Za-z0-9._~-]{0,63}$/u;

export class McpCatalogClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(
    config: FirstPartyApiConfig,
    options: Readonly<{ fetch?: typeof fetch; timeoutMs?: number }> = {},
  ) {
    this.#baseUrl = config.baseUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1_000 ||
      this.#timeoutMs > 60_000
    ) {
      throw new Error("Invalid MCP catalog timeout.");
    }
  }

  async load(
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<McpCatalog> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, this.#timeoutMs);
    try {
      const response = await this.#fetch(
        `${this.#baseUrl}/v1/mcp/catalog?region=${encodeURIComponent(region)}`,
        {
          credentials: "omit",
          headers: { Accept: "application/json" },
          method: "GET",
          signal: controller.signal,
        },
      );
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("MCP catalog response is too large.");
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("MCP catalog response is too large.");
      }
      if (!response.ok) throw new Error("MCP catalog request failed.");
      let value: unknown;
      try {
        value = JSON.parse(body) as unknown;
      } catch {
        throw new Error("MCP catalog response is not JSON.");
      }
      return parseCatalog(value, region);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function parseCatalog(
  value: unknown,
  expectedRegion: McpCatalogRegion,
): McpCatalog {
  if (!isRecordWithKeys(value, ["catalogVersion", "region", "services"])) {
    throw new Error("MCP catalog response is invalid.");
  }
  if (
    typeof value.catalogVersion !== "string" ||
    !/^\d{4}-\d{2}-\d{2}\.\d{1,4}$/u.test(value.catalogVersion) ||
    value.region !== expectedRegion ||
    !Array.isArray(value.services) ||
    value.services.length > MAX_SERVICES
  ) {
    throw new Error("MCP catalog response is invalid.");
  }
  const services = value.services.map(parseEntry);
  if (new Set(services.map((entry) => entry.id)).size !== services.length) {
    throw new Error("MCP catalog contains duplicate services.");
  }
  return {
    catalogVersion: value.catalogVersion,
    region: expectedRegion,
    services,
  };
}

function parseEntry(value: unknown): McpCatalogEntry {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      "configuration",
      "description",
      "documentationUrl",
      "id",
      "name",
      "provider",
      "support",
    ]) ||
    typeof value.id !== "string" ||
    !SAFE_ID.test(value.id) ||
    !["available", "phase-one"].includes(value.support as string)
  ) {
    throw new Error("MCP catalog service is invalid.");
  }
  const support = value.support as McpCatalogSupport;
  const configuration = parseConfiguration(value.configuration);
  return {
    id: value.id,
    name: parseLocalizedText(value.name),
    provider: parseLocalizedText(value.provider),
    description: parseLocalizedText(value.description),
    documentationUrl: secureUrl(value.documentationUrl, false),
    support,
    configuration,
  };
}

function parseConfiguration(value: unknown) {
  if (!isRecordWithKeys(value, ["authentication", "serverUrl"])) {
    throw new Error("MCP catalog configuration is invalid.");
  }
  return {
    authentication: parseAuthentication(value.authentication),
    serverUrl: secureUrl(value.serverUrl, true),
  };
}

function parseAuthentication(value: unknown): McpCatalogAuthentication {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("MCP catalog authentication is invalid.");
  }
  if (value.kind === "none" && onlyKeys(value, ["kind"])) {
    return { kind: "none" };
  }
  if (value.kind === "oauth" && onlyKeys(value, ["kind"])) {
    return { kind: "oauth" };
  }
  if (
    value.kind !== "token" ||
    !onlyKeys(value, [
      "credentialLabel",
      "kind",
      "parameterName",
      "placement",
    ]) ||
    !["bearer", "header", "query"].includes(value.placement as string)
  ) {
    throw new Error("MCP catalog authentication is invalid.");
  }
  const placement = value.placement as "bearer" | "header" | "query";
  const parameterName = value.parameterName;
  if (
    (placement === "bearer" && parameterName !== undefined) ||
    (placement !== "bearer" &&
      (typeof parameterName !== "string" ||
        !SAFE_PARAMETER.test(parameterName)))
  ) {
    throw new Error("MCP catalog credential placement is invalid.");
  }
  return {
    kind: "token",
    placement,
    credentialLabel: parseLocalizedText(value.credentialLabel),
    ...(typeof parameterName === "string" ? { parameterName } : {}),
  };
}

function parseLocalizedText(value: unknown): McpCatalogLocalizedText {
  if (!isRecordWithKeys(value, ["en", "zhCN"])) {
    throw new Error("MCP catalog text is invalid.");
  }
  return {
    en: safeText(value.en, 600),
    zhCN: safeText(value.zhCN, 600),
  };
}

function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error("MCP catalog text is invalid.");
  }
  return value.trim();
}

function secureUrl(value: unknown, endpoint: boolean): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("MCP catalog URL is invalid.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (endpoint && url.search) ||
    (endpoint && (url.hostname === "localhost" || isPrivateIp(url.hostname)))
  ) {
    throw new Error("MCP catalog URL is not permitted.");
  }
  return url.toString();
}

function isPrivateIp(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^127\./u.test(normalized) ||
    /^10\./u.test(normalized) ||
    /^192\.168\./u.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(normalized)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecordWithKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
