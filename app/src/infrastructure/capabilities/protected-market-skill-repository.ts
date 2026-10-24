import type { SkillCapability } from "@/application/ports/capability-catalog";
import type { DownloadedSkill } from "@/application/ports/downloaded-skills";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";
import { BOLTPOCKET_MARKET_SOURCE } from "./skill-market-client";

const STORAGE_PREFIX = "skills:market:protected:v1:";
const VERSION = 1;
const MAX_SKILL_BYTES = 64 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const PROTECTED_MARKET_SKILL_PLACEHOLDER =
  "[Protected Skill instructions are available only during an Agent run.]";

type ProtectedSkillRecord = Readonly<{
  catalogId: string;
  revision: string;
  sha256: string;
  skillDocument: string;
  skillId: string;
  sourceId: typeof BOLTPOCKET_MARKET_SOURCE.id;
  version: typeof VERSION;
}>;

export type ProtectedMarketSkillInput = Pick<
  SkillCapability,
  "id" | "revision" | "sha256" | "skillDocument" | "source"
>;

export class ProtectedMarketSkillRepository {
  constructor(
    private readonly store: DurableDocumentStore,
    private readonly digest: (value: string) => Promise<string>,
  ) {}

  async save(capability: ProtectedMarketSkillInput) {
    if (capability.source.id !== BOLTPOCKET_MARKET_SOURCE.id) {
      throw new Error("Only BoltPocket Skill Market instructions can be protected.");
    }
    const record: ProtectedSkillRecord = {
      catalogId: capability.source.entryId,
      revision: capability.revision,
      sha256: capability.sha256,
      skillDocument: capability.skillDocument,
      skillId: capability.id,
      sourceId: BOLTPOCKET_MARKET_SOURCE.id,
      version: VERSION,
    };
    assertRecordShape(record);
    if ((await this.digest(record.skillDocument)) !== record.sha256) {
      throw new Error("Protected Skill integrity check failed.");
    }
    await this.store.write(storageKey(record), JSON.stringify(record));
  }

  async load(item: DownloadedSkill) {
    assertProtectedDownload(item);
    const value = await this.store.read(storageKey(item));
    if (value === undefined) {
      throw new Error("Protected Skill instructions are missing.");
    }
    const record = parseRecord(value);
    if (
      record.catalogId !== item.catalogId ||
      record.revision !== item.revision ||
      record.sha256 !== item.sha256 ||
      record.skillId !== item.skillId ||
      record.sourceId !== item.sourceId ||
      (await this.digest(record.skillDocument)) !== record.sha256
    ) {
      throw new Error("Protected Skill integrity check failed.");
    }
    return record.skillDocument;
  }

  async remove(item: DownloadedSkill) {
    assertProtectedDownload(item);
    await this.store.remove(storageKey(item));
  }
}

export function isProtectedMarketDownload(
  item: DownloadedSkill,
): item is DownloadedSkill & Readonly<{ projectId: null }> {
  return item.projectId === null && item.sourceId === BOLTPOCKET_MARKET_SOURCE.id;
}

function parseRecord(value: string): ProtectedSkillRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Protected Skill instructions are unreadable.");
  }
  assertRecordShape(parsed);
  return parsed;
}

function assertRecordShape(
  value: unknown,
): asserts value is ProtectedSkillRecord {
  if (
    !record(value) ||
    !exactKeys(value, [
      "catalogId",
      "revision",
      "sha256",
      "skillDocument",
      "skillId",
      "sourceId",
      "version",
    ]) ||
    value.version !== VERSION ||
    value.sourceId !== BOLTPOCKET_MARKET_SOURCE.id ||
    !safeId(value.catalogId, 240) ||
    !safeId(value.skillId, 80) ||
    typeof value.revision !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.revision) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    typeof value.skillDocument !== "string" ||
    !value.skillDocument.trim() ||
    value.skillDocument.includes("\0") ||
    new TextEncoder().encode(value.skillDocument).byteLength > MAX_SKILL_BYTES
  ) {
    throw new Error("Protected Skill instructions are invalid.");
  }
}

function assertProtectedDownload(
  item: DownloadedSkill,
): asserts item is DownloadedSkill & Readonly<{ projectId: null }> {
  if (!isProtectedMarketDownload(item)) {
    throw new Error("Protected Skill metadata is invalid.");
  }
}

function storageKey(
  value: Pick<
    DownloadedSkill,
    "catalogId" | "revision" | "sha256" | "skillId" | "sourceId"
  >,
) {
  return `${STORAGE_PREFIX}${encodeURIComponent(value.sourceId)}:${encodeURIComponent(value.catalogId)}:${encodeURIComponent(value.skillId)}:${encodeURIComponent(value.revision)}:${value.sha256}`;
}

function safeId(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
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
