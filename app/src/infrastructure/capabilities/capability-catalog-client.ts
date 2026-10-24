import type {
  CapabilityRequirement,
  OpenSkillProvenance,
  SkillBundle,
  SkillCapability,
} from "@/application/ports/capability-catalog";
import {
  SKILL_BUNDLE_LIMITS,
  validateSkillBundleMetadata,
} from "@/application/skill-bundle";
import type { CapabilitySource } from "@/application/ports/capability-sources";
import type { FirstPartyApiConfig } from "@/config/first-party-api";
import type {
  McpCatalogLocalizedText,
  McpCatalogRegion,
} from "@/infrastructure/mcp/mcp-catalog-client";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Fetches one exact, complete Skills.sh package through the bounded first-party bridge. */
export class CapabilityCatalogClient {
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
      throw new Error("Invalid Skill URL resolver timeout.");
    }
  }

  async resolveSkill(
    entryId: string,
    region: McpCatalogRegion,
    source: CapabilitySource,
    signal?: AbortSignal,
  ): Promise<SkillCapability> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,239}$/u.test(entryId)) {
      throw new Error("Skill URL identifier is invalid.");
    }
    const url = new URL(
      "/v1/capabilities/catalog/skills/resolve",
      this.#baseUrl,
    );
    url.searchParams.set("region", region);
    url.searchParams.set("id", entryId);
    const value = await this.#request(url, signal);
    const resolved = parseResolvedSkill(value, region, source, entryId);
    if (
      resolved.source.entryId !== entryId ||
      (resolved.provenance !== undefined &&
        resolved.provenance.sourceId !== entryId)
    ) {
      throw new Error("Resolved Skill response is invalid.");
    }
    return resolved;
  }

  async #request(url: URL, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, this.#timeoutMs);
    try {
      const response = await this.#fetch(url.toString(), {
        credentials: "omit",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Resolved Skill response is too large.");
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("Resolved Skill response is too large.");
      }
      if (!response.ok) throw new Error("Skill URL resolution failed.");
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new Error("Resolved Skill response is not JSON.");
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function parseResolvedSkill(
  value: unknown,
  expectedRegion: McpCatalogRegion,
  source: CapabilitySource,
  entryId: string,
) {
  if (
    !record(value) ||
    !exactKeys(value, ["catalogVersion", "entries", "region"]) ||
    typeof value.catalogVersion !== "string" ||
    !/^\d{4}-\d{2}-\d{2}\.\d{1,4}$/u.test(value.catalogVersion) ||
    value.region !== expectedRegion ||
    !Array.isArray(value.entries) ||
    value.entries.length !== 1 ||
    !record(value.entries[0]) ||
    value.entries[0].kind !== "skill"
  ) {
    throw new Error("Resolved Skill response is invalid.");
  }
  return parseCapabilityCatalogSkill(value.entries[0], source, entryId);
}

export function parseCapabilityCatalogSkill(
  value: Record<string, unknown>,
  source: CapabilitySource,
  entryId: string,
): SkillCapability {
  if (
    !onlyKeys(value, [
      "description",
      "documentationUrl",
      "bundle",
      "id",
      "kind",
      "name",
      "provenance",
      "provider",
      "requirements",
      "revision",
      "risk",
      "sha256",
      "skillDocument",
    ]) ||
    typeof value.id !== "string" ||
    !SAFE_ID.test(value.id) ||
    typeof value.revision !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.revision) ||
    (value.risk !== "read" && value.risk !== "propose") ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    typeof value.skillDocument !== "string" ||
    !value.skillDocument.trim() ||
    new TextEncoder().encode(value.skillDocument).byteLength >
      MAX_SKILL_BYTES ||
    value.skillDocument.includes("\0") ||
    !Array.isArray(value.requirements) ||
    value.requirements.length > 32
  ) {
    throw new Error("Resolved Skill is invalid.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u.test(entryId)) {
    throw new Error("Resolved Skill source identifier is invalid.");
  }
  const provenance =
    value.provenance === undefined
      ? undefined
      : parseOpenSkillProvenance(value.provenance);
  const capability: SkillCapability = {
    bundle: parseBundle(value.bundle),
    id: value.id,
    kind: "skill",
    name: localized(value.name),
    provider: localized(value.provider),
    description: localized(value.description),
    documentationUrl: secureUrl(value.documentationUrl, false),
    revision: value.revision,
    risk: value.risk,
    sha256: value.sha256,
    skillDocument: value.skillDocument,
    requirements: value.requirements.map(parseRequirement),
    source: {
      entryId,
      id: source.id,
      kind: source.kind,
      name: source.name,
    },
    ...(provenance === undefined ? {} : { provenance }),
  };
  if (!validateSkillBundleMetadata(capability)) {
    throw new Error("Resolved Skill package is invalid.");
  }
  return capability;
}

function parseBundle(value: unknown): SkillBundle {
  if (
    !record(value) ||
    !exactKeys(value, ["complete", "files", "sha256", "totalBytes"]) ||
    value.complete !== true ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    typeof value.totalBytes !== "number" ||
    !Number.isSafeInteger(value.totalBytes) ||
    value.totalBytes < 0 ||
    value.totalBytes > SKILL_BUNDLE_LIMITS.maxTotalBytes ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > SKILL_BUNDLE_LIMITS.maxFiles
  ) {
    throw new Error("Resolved Skill package is invalid.");
  }
  return {
    complete: true,
    files: value.files.map((file) => {
      if (
        !record(file) ||
        !exactKeys(file, [
          "byteLength",
          "content",
          "encoding",
          "executable",
          "mimeType",
          "path",
          "sha256",
        ]) ||
        typeof file.byteLength !== "number" ||
        typeof file.content !== "string" ||
        (file.encoding !== "utf8" && file.encoding !== "base64") ||
        typeof file.executable !== "boolean" ||
        typeof file.mimeType !== "string" ||
        typeof file.path !== "string" ||
        typeof file.sha256 !== "string"
      ) {
        throw new Error("Resolved Skill package file is invalid.");
      }
      return {
        byteLength: file.byteLength,
        content: file.content,
        encoding: file.encoding,
        executable: file.executable,
        mimeType: file.mimeType,
        path: file.path,
        sha256: file.sha256,
      };
    }),
    sha256: value.sha256,
    totalBytes: value.totalBytes,
  };
}

function parseOpenSkillProvenance(value: unknown): OpenSkillProvenance {
  if (
    !record(value) ||
    !exactKeys(value, [
      "archived",
      "audit",
      "commitSha",
      "compatibility",
      "installs",
      "kind",
      "license",
      "repositoryUrl",
      "sourceId",
      "supportingFileCount",
    ]) ||
    value.kind !== "skills-sh" ||
    typeof value.archived !== "boolean" ||
    (value.audit !== "pass" &&
      value.audit !== "warn" &&
      value.audit !== "fail" &&
      value.audit !== "unavailable") ||
    typeof value.commitSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.commitSha) ||
    (value.compatibility !== null &&
      (typeof value.compatibility !== "string" ||
        !value.compatibility.trim() ||
        value.compatibility.length > 500 ||
        CONTROL_CHARACTERS.test(value.compatibility))) ||
    typeof value.installs !== "number" ||
    !Number.isSafeInteger(value.installs) ||
    value.installs < 0 ||
    value.installs > 1_000_000_000 ||
    (value.license !== null &&
      (typeof value.license !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,79}$/u.test(value.license))) ||
    typeof value.sourceId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{2,239}$/u.test(value.sourceId) ||
    typeof value.supportingFileCount !== "number" ||
    !Number.isSafeInteger(value.supportingFileCount) ||
    value.supportingFileCount < 0 ||
    value.supportingFileCount > 10_000
  ) {
    throw new Error("Open Skill provenance is invalid.");
  }
  return {
    archived: value.archived,
    audit: value.audit,
    commitSha: value.commitSha,
    compatibility: value.compatibility,
    installs: value.installs,
    kind: "skills-sh",
    license: value.license,
    repositoryUrl: secureUrl(value.repositoryUrl, false),
    sourceId: value.sourceId,
    supportingFileCount: value.supportingFileCount,
  };
}

function parseRequirement(value: unknown): CapabilityRequirement {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(value.id) ||
    (value.kind !== "host-tool" && value.kind !== "mcp-server") ||
    typeof value.required !== "boolean" ||
    !exactKeys(
      value,
      value.kind === "host-tool"
        ? ["id", "kind", "label", "required"]
        : ["id", "kind", "label", "required", "serverUrl"],
    )
  ) {
    throw new Error("Capability requirement is invalid.");
  }
  const base = {
    id: value.id,
    label: localized(value.label),
    required: value.required,
  };
  return value.kind === "host-tool"
    ? { ...base, kind: "host-tool" }
    : {
        ...base,
        kind: "mcp-server",
        serverUrl: secureUrl(value.serverUrl, true),
      };
}

function localized(value: unknown): McpCatalogLocalizedText {
  if (!record(value) || !exactKeys(value, ["en", "zhCN"])) {
    throw new Error("Resolved Skill text is invalid.");
  }
  return { en: safeText(value.en, 600), zhCN: safeText(value.zhCN, 600) };
}

function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error("Resolved Skill text is invalid.");
  }
  return value.trim();
}

function secureUrl(value: unknown, endpoint: boolean) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Resolved Skill URL is invalid.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (endpoint && url.search) ||
    (endpoint && isPrivateIp(url.hostname))
  ) {
    throw new Error("Resolved Skill URL is not permitted.");
  }
  return url.toString();
}

function isPrivateIp(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const mappedIpv4 = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  return (
    normalized === "localhost" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    /^f[cd][0-9a-f]{2}:/u.test(normalized) ||
    /^fe[89ab][0-9a-f]:/u.test(normalized) ||
    /^127\./u.test(mappedIpv4) ||
    /^10\./u.test(mappedIpv4) ||
    /^192\.168\./u.test(mappedIpv4) ||
    /^169\.254\./u.test(mappedIpv4) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(mappedIpv4)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
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
