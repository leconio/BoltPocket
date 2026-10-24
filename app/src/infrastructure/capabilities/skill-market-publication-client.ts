import type {
  PublishSkillMarketDocumentsInput,
  SkillMarketPublicationFinding,
  SkillMarketPublicationPort,
  SkillMarketPublicationResult,
  SkillMarketPublicationReview,
  SkillMarketPublicationStatus,
  SkillMarketOwnedPublication,
  SkillMarketOwnedPublications,
  SkillMarketWithdrawResult,
} from "@/application/ports/skill-market-publication";
import type { FirstPartyApiConfig } from "@/config/first-party-api";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const ENTRY_ID =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SKILL_ID = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/u;
const SAFE_TITLE = /^[^\u0000-\u001f\u007f]{1,256}$/u;

export class SkillMarketPublicationClient implements SkillMarketPublicationPort {
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
      throw new Error("Invalid Skill publication timeout.");
    }
  }

  async listOwned(signal?: AbortSignal): Promise<SkillMarketOwnedPublications> {
    return parseOwnedPublications(
      await this.#request(
        "/v1/skill-market/publications",
        { method: "GET" },
        signal,
      ),
    );
  }

  async publicationStatus(skillId: string, signal?: AbortSignal) {
    if (!SKILL_ID.test(skillId)) {
      throw new Error("Skill publication identifier is invalid.");
    }
    const value = await this.#request(
      `/v1/skill-market/publications/skills/${encodeURIComponent(skillId)}`,
      { method: "GET" },
      signal,
    );
    return parseStatus(value);
  }

  async review(
    input: Readonly<{ readmeDocument: string; skillDocument: string }>,
    signal?: AbortSignal,
  ) {
    return parseReview(
      await this.#request(
        "/v1/skill-market/reviews",
        jsonRequest({ files: publicationFiles(input) }),
        signal,
      ),
    );
  }

  async publish(input: PublishSkillMarketDocumentsInput, signal?: AbortSignal) {
    const { readmeDocument, skillDocument, ...metadata } = input;
    return parsePublication(
      await this.#request(
        "/v1/skill-market/publications",
        jsonRequest({
          ...metadata,
          files: publicationFiles({ readmeDocument, skillDocument }),
        }),
        signal,
      ),
    );
  }

  async withdraw(
    entryId: string,
    expectedRevision: string,
    signal?: AbortSignal,
  ): Promise<SkillMarketWithdrawResult> {
    if (!ENTRY_ID.test(entryId) || !REVISION.test(expectedRevision)) {
      throw new Error("Skill publication revision is invalid.");
    }
    return parseWithdraw(
      await this.#request(
        `/v1/skill-market/publications/${encodeURIComponent(entryId)}/withdraw`,
        jsonRequest({ expectedRevision }),
        signal,
      ),
    );
  }

  async #request(path: string, init: RequestInit, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, this.#timeoutMs);
    try {
      const response = await this.#fetch(
        new URL(path, this.#baseUrl).toString(),
        {
          ...init,
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-store",
            ...init.headers,
          },
          signal: controller.signal,
        },
      );
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Skill publication response is too large.");
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("Skill publication response is too large.");
      }
      if (!response.ok) throw new Error(publicError(body));
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new Error("Skill publication response is not JSON.");
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function publicationFiles(
  input: Readonly<{
    readmeDocument: string;
    skillDocument: string;
  }>,
): readonly {
  path: "README.md" | "SKILL.md";
  content: string;
}[] {
  return [
    { path: "README.md", content: input.readmeDocument },
    { path: "SKILL.md", content: input.skillDocument },
  ];
}

function jsonRequest(value: unknown): RequestInit {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
}

function parseStatus(value: unknown): SkillMarketPublicationStatus {
  if (
    !record(value) ||
    !exactKeys(value, ["entryId", "revision", "status"]) ||
    !(
      (value.entryId === null &&
        value.revision === null &&
        value.status === null) ||
      (typeof value.entryId === "string" &&
        ENTRY_ID.test(value.entryId) &&
        typeof value.revision === "string" &&
        REVISION.test(value.revision) &&
        (value.status === "published" ||
          value.status === "reviewing" ||
          value.status === "rejected" ||
          value.status === "withdrawn"))
    )
  ) {
    throw new Error("Skill publication status is invalid.");
  }
  return value as SkillMarketPublicationStatus;
}

function parseOwnedPublications(value: unknown): SkillMarketOwnedPublications {
  if (
    !record(value) ||
    !exactKeys(value, ["skills"]) ||
    !Array.isArray(value.skills)
  ) {
    throw new Error("Owned Skill publications are invalid.");
  }
  if (value.skills.length > 500) {
    throw new Error("Owned Skill publications are invalid.");
  }
  const skills = value.skills.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, [
        "canWithdraw",
        "entryId",
        "published",
        "revision",
        "reviewing",
        "skillId",
        "status",
        "title",
        "updatedAt",
      ]) ||
      typeof item.entryId !== "string" ||
      !ENTRY_ID.test(item.entryId) ||
      typeof item.skillId !== "string" ||
      !SKILL_ID.test(item.skillId) ||
      typeof item.title !== "string" ||
      !SAFE_TITLE.test(item.title) ||
      typeof item.revision !== "string" ||
      !REVISION.test(item.revision) ||
      (item.status !== "published" &&
        item.status !== "reviewing" &&
        item.status !== "rejected" &&
        item.status !== "withdrawn" &&
        item.status !== "suspended") ||
      typeof item.published !== "boolean" ||
      typeof item.reviewing !== "boolean" ||
      typeof item.canWithdraw !== "boolean" ||
      typeof item.updatedAt !== "number" ||
      !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < 0
    ) {
      throw new Error("Owned Skill publication is invalid.");
    }
    return {
      canWithdraw: item.canWithdraw,
      entryId: item.entryId,
      published: item.published,
      reviewing: item.reviewing,
      revision: item.revision,
      skillId: item.skillId,
      status: item.status as SkillMarketOwnedPublication["status"],
      title: item.title,
      updatedAt: item.updatedAt,
    };
  });
  return { skills };
}

function parseWithdraw(value: unknown): SkillMarketWithdrawResult {
  if (
    !record(value) ||
    !exactKeys(value, ["entryId", "patch", "receipt"]) ||
    typeof value.entryId !== "string" ||
    !ENTRY_ID.test(value.entryId) ||
    !record(value.patch) ||
    !exactKeys(value.patch, ["sha256", "text"]) ||
    typeof value.patch.sha256 !== "string" ||
    !SHA256.test(value.patch.sha256) ||
    typeof value.patch.text !== "string" ||
    !safeText(value.patch.text, 32_000) ||
    !record(value.receipt) ||
    !exactKeys(value.receipt, ["id", "recoveryAvailable"]) ||
    typeof value.receipt.id !== "string" ||
    !UUID.test(value.receipt.id) ||
    value.receipt.recoveryAvailable !== true
  ) {
    throw new Error("Skill withdrawal receipt is invalid.");
  }
  return {
    entryId: value.entryId,
    patch: { sha256: value.patch.sha256, text: value.patch.text },
    receipt: { id: value.receipt.id, recoveryAvailable: true },
  };
}

function parseReview(value: unknown): SkillMarketPublicationReview {
  if (
    !record(value) ||
    !exactKeys(value, [
      "documentSha256",
      "findings",
      "readmeSha256",
      "reviewHash",
      "status",
    ]) ||
    typeof value.documentSha256 !== "string" ||
    !SHA256.test(value.documentSha256) ||
    typeof value.readmeSha256 !== "string" ||
    !SHA256.test(value.readmeSha256) ||
    typeof value.reviewHash !== "string" ||
    !SHA256.test(value.reviewHash) ||
    (value.status !== "pass" && value.status !== "needs_changes") ||
    !Array.isArray(value.findings) ||
    value.findings.length > 64
  ) {
    throw new Error("Skill publication review is invalid.");
  }
  const findings = value.findings.map(parseFinding);
  if (
    (value.status === "pass" &&
      findings.some(({ severity }) => severity === "blocker")) ||
    (value.status === "needs_changes" &&
      !findings.some(({ severity }) => severity === "blocker"))
  ) {
    throw new Error("Skill publication review status is invalid.");
  }
  return {
    documentSha256: value.documentSha256,
    findings,
    readmeSha256: value.readmeSha256,
    reviewHash: value.reviewHash,
    status: value.status,
  };
}

function parseFinding(value: unknown): SkillMarketPublicationFinding {
  if (
    !record(value) ||
    !exactKeys(value, [
      "code",
      "line",
      "message",
      "severity",
      "suggestion",
      "target",
    ]) ||
    typeof value.code !== "string" ||
    !/^[a-z][a-z0-9-]{0,79}$/u.test(value.code) ||
    (value.line !== null &&
      (typeof value.line !== "number" ||
        !Number.isSafeInteger(value.line) ||
        value.line < 1 ||
        value.line > 100_000)) ||
    typeof value.message !== "string" ||
    !safeText(value.message, 1_000) ||
    typeof value.suggestion !== "string" ||
    !safeText(value.suggestion, 1_000) ||
    (value.severity !== "blocker" && value.severity !== "warning") ||
    (value.target !== "README.md" && value.target !== "SKILL.md")
  ) {
    throw new Error("Skill publication finding is invalid.");
  }
  return value as SkillMarketPublicationFinding;
}

function parsePublication(value: unknown): SkillMarketPublicationResult {
  if (
    !record(value) ||
    !exactKeys(value, ["entryId", "patch", "receipt", "review", "revision"]) ||
    typeof value.entryId !== "string" ||
    !ENTRY_ID.test(value.entryId) ||
    typeof value.revision !== "string" ||
    !REVISION.test(value.revision) ||
    !record(value.patch) ||
    !exactKeys(value.patch, ["sha256", "text"]) ||
    typeof value.patch.sha256 !== "string" ||
    !SHA256.test(value.patch.sha256) ||
    typeof value.patch.text !== "string" ||
    !safeText(value.patch.text, 32_000) ||
    !record(value.receipt) ||
    !exactKeys(value.receipt, ["id", "recoveryAvailable"]) ||
    typeof value.receipt.id !== "string" ||
    !UUID.test(value.receipt.id) ||
    value.receipt.recoveryAvailable !== true
  ) {
    throw new Error("Skill publication receipt is invalid.");
  }
  return {
    entryId: value.entryId,
    patch: { sha256: value.patch.sha256, text: value.patch.text },
    receipt: { id: value.receipt.id, recoveryAvailable: true },
    review: parseReview(value.review),
    revision: value.revision,
  };
}

function publicError(body: string) {
  try {
    const value = JSON.parse(body) as unknown;
    if (
      record(value) &&
      record(value.error) &&
      typeof value.error.message === "string" &&
      safeText(value.error.message, 1_000)
    ) {
      return value.error.message;
    }
  } catch {
    // Fall through to a content-free error.
  }
  return "Skill publication request failed.";
}

function safeText(value: string, maximum: number) {
  return (
    Boolean(value.trim()) &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
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
