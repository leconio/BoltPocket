import type {
  SkillBundleFile,
  SkillCapability,
  SkillUrlResolverPort,
} from "@/application/ports/capability-catalog";
import {
  normalizeSkillBundlePath,
  SKILL_BUNDLE_LIMITS,
  skillBundleFingerprintInput,
  verifySkillBundleIntegrity,
} from "@/application/skill-bundle";
import {
  decodeZipTextEntry,
  extractBoundedZipArchive,
  type BoundedZipArchiveEntry,
} from "@boltpocket/project-shell-extras";
import { isHttpsOrLocalNetworkHttpUrl } from "@boltpocket/connector-core";
import {
  parseProjectSkillDocument,
  validateProjectSkillDocument,
} from "@/domain/project-skill-document";
import type { McpCatalogRegion } from "@/infrastructure/mcp/catalog-types";
import {
  parsePublicGitHubRepositoryUrl,
  type PublicGitHubRepositoryRef,
} from "@/infrastructure/sources/public-github-source";

const MAX_URL_CHARACTERS = 2_048;
const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_GITHUB_ARCHIVE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const SKILLS_SH_ENTRY =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export const DIRECT_SKILL_SOURCE_ID = "direct-url";

export type DirectSkillUrlErrorCode =
  | "integrity-failed"
  | "invalid-document"
  | "invalid-url"
  | "request-failed"
  | "unsafe-url";

export class DirectSkillUrlError extends Error {
  readonly code: DirectSkillUrlErrorCode;

  constructor(code: DirectSkillUrlErrorCode) {
    super(code);
    this.name = "DirectSkillUrlError";
    this.code = code;
  }
}

type DirectSkillUrlResolverOptions = Readonly<{
  catalog: SkillUrlResolverPort;
  digest: (value: string) => Promise<string>;
  digestBytes: (value: Uint8Array) => Promise<string>;
  fetch: typeof fetch;
  region: McpCatalogRegion;
}>;

/** Resolves a user-provided secure or local URL into one reviewable Skill package. */
export class DirectSkillUrlResolver {
  readonly #catalog: SkillUrlResolverPort;
  readonly #digest: (value: string) => Promise<string>;
  readonly #digestBytes: (value: Uint8Array) => Promise<string>;
  readonly #fetch: typeof fetch;
  readonly #region: McpCatalogRegion;

  constructor(options: DirectSkillUrlResolverOptions) {
    this.#catalog = options.catalog;
    this.#digest = options.digest;
    this.#digestBytes = options.digestBytes;
    this.#fetch = options.fetch;
    this.#region = options.region;
  }

  async resolve(input: string, signal?: AbortSignal): Promise<SkillCapability> {
    const url = normalizedSkillUrl(input);
    const skillsShId = skillsShEntryId(url);
    if (skillsShId) {
      let capability: SkillCapability;
      try {
        capability = await this.#catalog.resolveSkill(
          "skills-sh",
          skillsShId,
          this.#region,
          signal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new DirectSkillUrlError("request-failed");
      }
      if (
        capability.source.id !== "skills-sh" ||
        capability.source.entryId !== skillsShId
      ) {
        throw new DirectSkillUrlError("invalid-document");
      }
      await this.#verifyCapability(capability);
      return capability;
    }

    const githubRepository = githubRepositoryFromUrl(url);
    const githubPackage = githubRepository
      ? await this.#requestGitHubSkillPackage(githubRepository, signal)
      : null;
    const sourceDocument = githubPackage
      ? decodeSkillTextEntry(githubPackage.entries, "SKILL.md")
      : await this.#requestDocument(url, signal);
    const skillDocument = githubRepository
      ? normalizeAgentSkillDocument(sourceDocument)
      : sourceDocument;
    const parsed = parseProjectSkillDocument(skillDocument);
    if (!parsed?.name) {
      throw new DirectSkillUrlError("invalid-document");
    }
    const validation = validateProjectSkillDocument(
      `skills/${parsed.name}/SKILL.md`,
      skillDocument,
    );
    if (!validation.valid) {
      throw new DirectSkillUrlError("invalid-document");
    }
    const { description, risk, title } = validation.document;
    if (!description || !risk || !title) {
      throw new DirectSkillUrlError("invalid-document");
    }
    const sha256 = await this.#sha256(skillDocument);
    const skillFile = await this.#textBundleFile("SKILL.md", skillDocument);
    const files = githubPackage
      ? await this.#githubBundleFiles(githubPackage.entries, skillFile)
      : [skillFile];
    const bundleSha256 = await this.#sha256(skillBundleFingerprintInput(files));
    const provider = githubRepository?.repository ?? url.hostname;
    const capability: SkillCapability = {
      bundle: {
        complete: true,
        files,
        sha256: bundleSha256,
        totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
      },
      description: {
        en: description,
        zhCN: description,
      },
      documentationUrl: githubRepository?.url ?? url.toString(),
      id: validation.slug,
      kind: "skill",
      name: {
        en: title,
        zhCN: title,
      },
      provider: { en: provider, zhCN: provider },
      requirements: [],
      revision: githubPackage?.revision ?? sha256,
      risk,
      sha256,
      skillDocument,
      source: {
        entryId: validation.slug,
        id: DIRECT_SKILL_SOURCE_ID,
        kind: "catalog-json",
        name: "URL",
      },
    };
    await this.#verifyCapability(capability);
    return capability;
  }

  async #requestGitHubSkillPackage(
    repository: PublicGitHubRepositoryRef,
    signal?: AbortSignal,
  ) {
    const repositoryPath = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    try {
      const metadata = parseJsonRecord(
        await this.#requestDocument(
          new URL(`https://api.github.com/repos/${repositoryPath}`),
          signal,
          "application/vnd.github+json",
        ),
      );
      if (
        metadata.private !== false ||
        typeof metadata.full_name !== "string" ||
        metadata.full_name.toLocaleLowerCase("en-US") !==
          repository.repository.toLocaleLowerCase("en-US") ||
        typeof metadata.default_branch !== "string" ||
        !metadata.default_branch ||
        metadata.default_branch.length > 255
      ) {
        throw new DirectSkillUrlError("invalid-document");
      }
      const commit = parseJsonRecord(
        await this.#requestDocument(
          new URL(
            `https://api.github.com/repos/${repositoryPath}/commits/${encodeURIComponent(metadata.default_branch)}`,
          ),
          signal,
          "application/vnd.github+json",
        ),
      );
      if (
        typeof commit.sha !== "string" ||
        !/^[0-9a-f]{40}$/u.test(commit.sha)
      ) {
        throw new DirectSkillUrlError("invalid-document");
      }
      const archive = await this.#requestBytes(
        new URL(
          `https://api.github.com/repos/${repositoryPath}/zipball/${commit.sha}`,
        ),
        signal,
      );
      return {
        entries: extractGitHubSkillEntries(archive, signal),
        revision: commit.sha,
      };
    } catch (error) {
      if (
        !(error instanceof DirectSkillUrlError) ||
        error.code !== "request-failed"
      ) {
        throw error;
      }
      // GitHub's unauthenticated metadata API can be rate-limited. The HEAD
      // archive fallback remains bound to its exact downloaded file hashes.
      const archive = await this.#requestBytes(
        new URL(`https://github.com/${repositoryPath}/archive/HEAD.zip`),
        signal,
      );
      return {
        entries: extractGitHubSkillEntries(archive, signal),
        revision: await this.#sha256Bytes(archive),
      };
    }
  }

  async #githubBundleFiles(
    entries: readonly GitHubSkillEntry[],
    skillFile: SkillBundleFile,
  ) {
    const files: SkillBundleFile[] = [];
    for (const entry of entries) {
      if (entry.path === "SKILL.md") {
        files.push(skillFile);
        continue;
      }
      let content: string;
      try {
        content = decodeZipTextEntry({ name: entry.path, data: entry.data });
      } catch {
        content = encodeBase64(entry.data);
        files.push({
          byteLength: entry.data.byteLength,
          content,
          encoding: "base64",
          executable: false,
          mimeType: mimeTypeForPath(entry.path, false),
          path: entry.path,
          sha256: await this.#sha256Bytes(entry.data),
        });
        continue;
      }
      files.push(await this.#textBundleFile(entry.path, content));
    }
    return files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  }

  async #textBundleFile(
    path: string,
    content: string,
  ): Promise<SkillBundleFile> {
    const bytes = new TextEncoder().encode(content);
    return {
      byteLength: bytes.byteLength,
      content,
      encoding: "utf8",
      executable: false,
      mimeType: mimeTypeForPath(path, true),
      path,
      sha256: await this.#sha256(content),
    };
  }

  async #requestBytes(url: URL, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetch(url.toString(), {
        credentials: "omit",
        headers: {
          Accept: "application/zip, application/octet-stream;q=0.9",
          ...(url.hostname === "api.github.com"
            ? { "X-GitHub-Api-Version": "2022-11-28" }
            : {}),
        },
        method: "GET",
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_GITHUB_ARCHIVE_BYTES
      ) {
        throw new DirectSkillUrlError("invalid-document");
      }
      if (!response.ok) throw new DirectSkillUrlError("request-failed");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_GITHUB_ARCHIVE_BYTES) {
        throw new DirectSkillUrlError("invalid-document");
      }
      return bytes;
    } catch (error) {
      if (error instanceof DirectSkillUrlError || signal?.aborted) throw error;
      throw new DirectSkillUrlError("request-failed");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async #requestDocument(
    url: URL,
    signal?: AbortSignal,
    accept = "text/markdown, text/plain;q=0.9, */*;q=0.1",
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetch(url.toString(), {
        credentials: "omit",
        headers: {
          Accept: accept,
          ...(url.hostname === "api.github.com"
            ? { "X-GitHub-Api-Version": "2022-11-28" }
            : {}),
        },
        method: "GET",
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_DOCUMENT_BYTES
      ) {
        throw new DirectSkillUrlError("invalid-document");
      }
      if (!response.ok) throw new DirectSkillUrlError("request-failed");
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_DOCUMENT_BYTES) {
        throw new DirectSkillUrlError("invalid-document");
      }
      return body;
    } catch (error) {
      if (error instanceof DirectSkillUrlError || signal?.aborted) throw error;
      throw new DirectSkillUrlError("request-failed");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async #sha256(value: string) {
    let sha256: string;
    try {
      sha256 = await this.#digest(value);
    } catch {
      throw new DirectSkillUrlError("integrity-failed");
    }
    if (!SHA256.test(sha256)) {
      throw new DirectSkillUrlError("integrity-failed");
    }
    return sha256;
  }

  async #sha256Bytes(value: Uint8Array) {
    let sha256: string;
    try {
      sha256 = await this.#digestBytes(value);
    } catch {
      throw new DirectSkillUrlError("integrity-failed");
    }
    if (!SHA256.test(sha256)) {
      throw new DirectSkillUrlError("integrity-failed");
    }
    return sha256;
  }

  async #verifyCapability(capability: SkillCapability) {
    const validation = validateProjectSkillDocument(
      `skills/${capability.id}/SKILL.md`,
      capability.skillDocument,
    );
    if (!validation.valid || validation.document.risk !== capability.risk) {
      throw new DirectSkillUrlError("invalid-document");
    }
    if (
      !(await verifySkillBundleIntegrity(capability, {
        bytes: this.#digestBytes,
        text: this.#digest,
      }))
    ) {
      throw new DirectSkillUrlError("integrity-failed");
    }
  }
}

function normalizedSkillUrl(input: string) {
  const normalized = input.trim();
  if (normalized.length === 0 || normalized.length > MAX_URL_CHARACTERS) {
    throw new DirectSkillUrlError("invalid-url");
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new DirectSkillUrlError("invalid-url");
  }
  if (!isHttpsOrLocalNetworkHttpUrl(url) || url.username || url.password) {
    throw new DirectSkillUrlError("unsafe-url");
  }
  return url;
}

function skillsShEntryId(url: URL) {
  if (url.hostname.toLocaleLowerCase("en-US") !== "skills.sh") return null;
  const entryId = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  return SKILLS_SH_ENTRY.test(entryId) ? entryId : null;
}

type GitHubSkillEntry = Readonly<{ path: string; data: Uint8Array }>;

function extractGitHubSkillEntries(
  archive: Uint8Array,
  signal?: AbortSignal,
): readonly GitHubSkillEntry[] {
  let extracted: readonly BoundedZipArchiveEntry[];
  try {
    extracted = extractBoundedZipArchive(
      archive,
      {
        maxArchiveBytes: MAX_GITHUB_ARCHIVE_BYTES,
        maxEntries: SKILL_BUNDLE_LIMITS.maxFiles * 2 + 1,
        maxEntryBytes: SKILL_BUNDLE_LIMITS.maxFileBytes,
        maxExtractedBytes: SKILL_BUNDLE_LIMITS.maxTotalBytes,
        maxPathBytes: SKILL_BUNDLE_LIMITS.maxPathBytes + 160,
      },
      signal,
    );
  } catch {
    throw new DirectSkillUrlError("invalid-document");
  }
  const roots = new Set(
    extracted.map((entry) => entry.name.split("/")[0]).filter((root) => root),
  );
  if (roots.size !== 1) {
    throw new DirectSkillUrlError("invalid-document");
  }
  const root = roots.values().next().value;
  if (!root) throw new DirectSkillUrlError("invalid-document");
  const seen = new Set<string>();
  const entries: GitHubSkillEntry[] = [];
  let totalBytes = 0;
  for (const entry of extracted) {
    if (entry.name.endsWith("/")) continue;
    const path = entry.name.split("/").slice(1).join("/");
    if (!path) continue;
    const normalized = normalizeSkillBundlePath(path);
    if (!normalized || normalized !== path || seen.has(path)) {
      throw new DirectSkillUrlError("invalid-document");
    }
    seen.add(path);
    totalBytes += entry.data.byteLength;
    entries.push({ path, data: entry.data });
    if (
      entries.length > SKILL_BUNDLE_LIMITS.maxFiles ||
      totalBytes > SKILL_BUNDLE_LIMITS.maxTotalBytes
    ) {
      throw new DirectSkillUrlError("invalid-document");
    }
  }
  if (!seen.has("SKILL.md")) {
    throw new DirectSkillUrlError("invalid-document");
  }
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function decodeSkillTextEntry(
  entries: readonly GitHubSkillEntry[],
  path: string,
) {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry || entry.data.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DirectSkillUrlError("invalid-document");
  }
  try {
    const content = decodeZipTextEntry({ name: path, data: entry.data });
    if (content.includes("\0")) {
      throw new DirectSkillUrlError("invalid-document");
    }
    return content;
  } catch (error) {
    if (error instanceof DirectSkillUrlError) throw error;
    throw new DirectSkillUrlError("invalid-document");
  }
}

function encodeBase64(value: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1] ?? 0;
    const third = value[index + 2] ?? 0;
    const bits = (first << 16) | (second << 8) | third;
    output += alphabet[(bits >>> 18) & 63];
    output += alphabet[(bits >>> 12) & 63];
    output += index + 1 < value.length ? alphabet[(bits >>> 6) & 63] : "=";
    output += index + 2 < value.length ? alphabet[bits & 63] : "=";
  }
  return output;
}

function mimeTypeForPath(path: string, text: boolean) {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US");
  const known: Record<string, string> = {
    css: "text/css",
    csv: "text/csv",
    gif: "image/gif",
    html: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    md: "text/markdown",
    mjs: "text/javascript",
    png: "image/png",
    py: "text/x-python",
    sh: "text/x-shellscript",
    svg: "image/svg+xml",
    toml: "application/toml",
    ts: "text/typescript",
    txt: "text/plain",
    yaml: "application/yaml",
    yml: "application/yaml",
  };
  return (
    (extension && known[extension]) ||
    (text ? "text/plain" : "application/octet-stream")
  );
}

function githubRepositoryFromUrl(url: URL) {
  if (url.hostname.toLocaleLowerCase("en-US") !== "github.com") return null;
  try {
    return parsePublicGitHubRepositoryUrl(url.toString());
  } catch {
    throw new DirectSkillUrlError("invalid-url");
  }
}

function parseJsonRecord(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new DirectSkillUrlError("invalid-document");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DirectSkillUrlError("invalid-document");
  }
  return parsed as Record<string, unknown>;
}

function frontmatterScalar(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/gu, "'");
  }
  return trimmed;
}

function standardFrontmatter(value: string) {
  const normalized = value.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new DirectSkillUrlError("invalid-document");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new DirectSkillUrlError("invalid-document");
  const lines = normalized.slice(4, end).split("\n");
  const fields = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(
      lines[index] ?? "",
    );
    if (!match?.[1] || fields.has(match[1])) continue;
    const rawValue = match[2] ?? "";
    if ((rawValue === "|" || rawValue === ">") && match[1] === "description") {
      const continuation: string[] = [];
      while (index + 1 < lines.length && /^\s+/u.test(lines[index + 1] ?? "")) {
        continuation.push((lines[(index += 1)] ?? "").trim());
      }
      fields.set(match[1], continuation.join(rawValue === ">" ? " " : "\n"));
    } else {
      fields.set(match[1], frontmatterScalar(rawValue));
    }
  }
  const body = normalized.slice(end + 5).trim();
  if (!body) throw new DirectSkillUrlError("invalid-document");
  return { body, fields };
}

function boundedMetadata(value: string, limit: number) {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1).trimEnd()}…`;
}

/** Converts the portable Agent Skills frontmatter into BoltPocket's reviewed form. */
export function normalizeAgentSkillDocument(value: string) {
  const { body, fields } = standardFrontmatter(value);
  const name = fields.get("name") ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(name)) {
    throw new DirectSkillUrlError("invalid-document");
  }
  const heading = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();
  const title = boundedMetadata(fields.get("title") || heading || name, 120);
  const description = boundedMetadata(fields.get("description") ?? "", 240);
  if (!title || !description) {
    throw new DirectSkillUrlError("invalid-document");
  }
  const requestedRisk = fields.get("risk");
  const risk = requestedRisk === "read" ? "read" : "propose";
  const normalized = [
    "---",
    `name: ${name}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `risk: ${risk}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  if (new TextEncoder().encode(normalized).byteLength > MAX_DOCUMENT_BYTES) {
    throw new DirectSkillUrlError("invalid-document");
  }
  return normalized;
}
