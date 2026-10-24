import type { CapabilitySource } from "@/application/ports/capability-sources";
import type {
  SkillMarketCatalog,
  SkillMarketCategory,
  SkillMarketDetail,
  SkillMarketLicense,
  SkillMarketPort,
  SkillMarketSummary,
  SkillMarketExecutionStatus,
} from "@/application/ports/skill-market";
import type { FirstPartyApiConfig } from "@/config/first-party-api";
import { parseCapabilityCatalogSkill } from "@/infrastructure/capabilities/capability-catalog-client";
import type {
  McpCatalogLocalizedText,
  McpCatalogRegion,
} from "@/infrastructure/mcp/mcp-catalog-client";

const CATEGORIES = new Set<SkillMarketCategory>([
  "engineering",
  "operations",
  "privacy",
  "productivity",
  "research",
  "writing",
]);
const LICENSES = new Set<SkillMarketLicense>(["Apache-2.0", "CC0-1.0", "MIT"]);
const MAX_CATALOG_RESPONSE_BYTES = 512 * 1024;
const MAX_DETAIL_RESPONSE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 10_000;
const ENTRY_ID =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const DOCUMENT_CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const BOLTPOCKET_MARKET_SOURCE: CapabilitySource = Object.freeze({
  id: "boltpocket-market",
  kind: "boltpocket",
  name: "BoltPocket Skill Market",
});

export class SkillMarketClient implements SkillMarketPort {
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
      throw new Error("Invalid Skill market timeout.");
    }
  }

  async loadCatalog(
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketCatalog> {
    const url = new URL("/v1/skill-market/catalog", this.#baseUrl);
    url.searchParams.set("region", region);
    return parseCatalog(
      await this.#request(url, MAX_CATALOG_RESPONSE_BYTES, signal),
      region,
    );
  }

  async loadDetail(
    entryId: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketDetail> {
    if (!ENTRY_ID.test(entryId)) {
      throw new Error("Skill market identifier is invalid.");
    }
    const url = new URL(
      `/v1/skill-market/skills/${encodeURIComponent(entryId)}`,
      this.#baseUrl,
    );
    url.searchParams.set("region", region);
    const value = await this.#request(url, MAX_DETAIL_RESPONSE_BYTES, signal);
    if (
      !record(value) ||
      !exactKeys(value, ["catalogVersion", "entry", "region"]) ||
      !validVersion(value.catalogVersion) ||
      value.region !== region ||
      !record(value.entry) ||
      !exactKeys(value.entry, ["readmeDocument", "summary"]) ||
      typeof value.entry.readmeDocument !== "string" ||
      !value.entry.readmeDocument.trim() ||
      new TextEncoder().encode(value.entry.readmeDocument).byteLength >
        64 * 1024 ||
      DOCUMENT_CONTROL_CHARACTERS.test(value.entry.readmeDocument)
    ) {
      throw new Error("Skill market detail is invalid.");
    }
    const summary = parseSummary(value.entry.summary);
    if (summary.id !== entryId) {
      throw new Error("Skill market detail identifier does not match.");
    }
    return { readmeDocument: value.entry.readmeDocument, summary };
  }

  async downloadSkill(
    entryId: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ) {
    if (!ENTRY_ID.test(entryId)) {
      throw new Error("Skill market identifier is invalid.");
    }
    const url = new URL(
      `/v1/skill-market/skills/${encodeURIComponent(entryId)}/download`,
      this.#baseUrl,
    );
    url.searchParams.set("region", region);
    const value = await this.#request(
      url,
      MAX_DETAIL_RESPONSE_BYTES,
      signal,
      true,
    );
    if (
      !record(value) ||
      !exactKeys(value, ["catalogVersion", "entries", "region"]) ||
      !validVersion(value.catalogVersion) ||
      value.region !== region ||
      !Array.isArray(value.entries) ||
      value.entries.length !== 1 ||
      !record(value.entries[0])
    ) {
      throw new Error("Skill market download is invalid.");
    }
    return parseCapabilityCatalogSkill(
      value.entries[0],
      BOLTPOCKET_MARKET_SOURCE,
      entryId,
    );
  }

  async checkExecution(
    entryId: string,
    revision: string,
    sha256: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketExecutionStatus> {
    if (
      !ENTRY_ID.test(entryId) ||
      !REVISION.test(revision) ||
      !SHA256.test(sha256)
    ) {
      throw new Error("Skill market execution metadata is invalid.");
    }
    const url = new URL(
      `/v1/skill-market/skills/${encodeURIComponent(entryId)}/execution-status`,
      this.#baseUrl,
    );
    url.searchParams.set("region", region);
    url.searchParams.set("revision", revision);
    url.searchParams.set("sha256", sha256);
    const value = await this.#request(url, 16 * 1024, signal, true);
    if (
      !record(value) ||
      !exactKeys(value, ["allowed", "reason", "region"]) ||
      typeof value.allowed !== "boolean" ||
      !["active", "not_found", "revoked", "version_mismatch"].includes(
        String(value.reason),
      ) ||
      value.region !== region ||
      value.allowed !== (value.reason === "active")
    ) {
      throw new Error("Skill market execution status is invalid.");
    }
    return {
      allowed: value.allowed,
      reason: value.reason as SkillMarketExecutionStatus["reason"],
    };
  }

  async #request(
    url: URL,
    maximumBytes: number,
    signal?: AbortSignal,
    noStore = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, this.#timeoutMs);
    try {
      const response = await this.#fetch(url.toString(), {
        cache: noStore ? "no-store" : "default",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          ...(noStore ? { "Cache-Control": "no-store" } : {}),
        },
        method: "GET",
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Skill market response is too large.");
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > maximumBytes) {
        throw new Error("Skill market response is too large.");
      }
      if (!response.ok) throw new Error("Skill market request failed.");
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new Error("Skill market response is not JSON.");
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function parseCatalog(
  value: unknown,
  region: McpCatalogRegion,
): SkillMarketCatalog {
  if (
    !record(value) ||
    !exactKeys(value, ["catalogVersion", "entries", "region"]) ||
    !validVersion(value.catalogVersion) ||
    value.region !== region ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_ENTRIES
  ) {
    throw new Error("Skill market catalog is invalid.");
  }
  const entries = value.entries.map(parseSummary);
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error("Skill market catalog contains duplicate entries.");
  }
  return {
    catalogVersion: value.catalogVersion,
    entries,
    region,
  };
}

function parseSummary(value: unknown): SkillMarketSummary {
  if (
    !record(value) ||
    !exactKeys(value, [
      "ageRating",
      "category",
      "contentDescriptors",
      "description",
      "featured",
      "id",
      "license",
      "name",
      "provider",
      "publisherId",
      "publishedAt",
      "revision",
      "risk",
      "sha256",
      "tags",
      "universalLink",
      "verified",
    ]) ||
    value.ageRating !== "16+" ||
    !Array.isArray(value.contentDescriptors) ||
    value.contentDescriptors.length !== 2 ||
    value.contentDescriptors[0] !== "user-generated-content" ||
    value.contentDescriptors[1] !== "agent-automation" ||
    typeof value.id !== "string" ||
    !ENTRY_ID.test(value.id) ||
    typeof value.category !== "string" ||
    !CATEGORIES.has(value.category as SkillMarketCategory) ||
    typeof value.license !== "string" ||
    !LICENSES.has(value.license as SkillMarketLicense) ||
    typeof value.featured !== "boolean" ||
    typeof value.verified !== "boolean" ||
    typeof value.publisherId !== "string" ||
    !/^publisher-[a-z0-9-]{8,80}$/u.test(value.publisherId) ||
    typeof value.publishedAt !== "number" ||
    !Number.isSafeInteger(value.publishedAt) ||
    value.publishedAt < 0 ||
    typeof value.revision !== "string" ||
    !REVISION.test(value.revision) ||
    (value.risk !== "read" && value.risk !== "propose") ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !Array.isArray(value.tags) ||
    value.tags.length < 1 ||
    value.tags.length > 5 ||
    value.tags.some((tag) => typeof tag !== "string" || !TAG.test(tag)) ||
    typeof value.universalLink !== "string" ||
    !validUniversalLink(value.universalLink, value.id)
  ) {
    throw new Error("Skill market entry is invalid.");
  }
  return {
    ageRating: "16+",
    category: value.category as SkillMarketCategory,
    contentDescriptors: ["user-generated-content", "agent-automation"],
    description: localized(value.description),
    featured: value.featured,
    id: value.id,
    license: value.license as SkillMarketLicense,
    name: localized(value.name),
    provider: localized(value.provider),
    publisherId: value.publisherId,
    publishedAt: value.publishedAt,
    revision: value.revision,
    risk: value.risk,
    sha256: value.sha256,
    tags: value.tags as readonly string[],
    universalLink: value.universalLink,
    verified: value.verified,
  };
}

function validUniversalLink(value: string, entryId: unknown) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === `/mini-apps/${encodeURIComponent(String(entryId))}`
    );
  } catch {
    return false;
  }
}

function localized(value: unknown): McpCatalogLocalizedText {
  if (!record(value) || !exactKeys(value, ["en", "zhCN"])) {
    throw new Error("Skill market localized text is invalid.");
  }
  return { en: safeText(value.en, 600), zhCN: safeText(value.zhCN, 600) };
}

function safeText(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error("Skill market text is invalid.");
  }
  return value.trim();
}

function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}\.\d{1,4}$/u.test(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
