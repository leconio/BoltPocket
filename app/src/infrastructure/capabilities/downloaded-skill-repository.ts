import type {
  DownloadedSkill,
  DownloadedSkillRepositoryPort,
} from "@/application/ports/downloaded-skills";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";
import {
  createMutableSingleFlightLoader,
  type MutableSingleFlightLoader,
} from "@/infrastructure/persistence/single-flight-loader";

const STORAGE_KEY = "skills:downloads:manifest:v1";
const VERSION = 3;
const MAX_ITEMS = 500;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const CATALOG_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

type Manifest = Readonly<{
  items: readonly DownloadedSkill[];
  version: typeof VERSION;
}>;

type LegacyDownloadedSkill = Omit<DownloadedSkill, "sourceId" | "projectId"> & {
  projectId: string;
};
type VersionTwoDownloadedSkill = Omit<DownloadedSkill, "projectId"> & {
  projectId: string;
};

export class DownloadedSkillRepository implements DownloadedSkillRepositoryPort {
  readonly #store: DurableDocumentStore;
  readonly #loader: MutableSingleFlightLoader<Manifest>;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(store: DurableDocumentStore) {
    this.#store = store;
    this.#loader = createMutableSingleFlightLoader(async () =>
      parseManifest(await store.read(STORAGE_KEY)),
    );
  }

  async list() {
    return [...(await this.#loader.load()).items].sort((left, right) =>
      `${left.projectId ?? "inventory"}:${left.skillId}`.localeCompare(
        `${right.projectId ?? "inventory"}:${right.skillId}`,
        "en",
      ),
    );
  }

  async save(item: DownloadedSkill) {
    if (!validItem(item)) throw new Error("下载 Skill 记录无效。");
    return this.#mutate(async () => {
      const manifest = await this.#loader.load();
      const items = [
        ...manifest.items.filter(
          (candidate) =>
            candidate.projectId !== item.projectId ||
            candidate.skillId !== item.skillId,
        ),
        item,
      ];
      if (items.length > MAX_ITEMS)
        throw new Error("下载 Skill 数量已达上限。");
      await this.#replace({ version: VERSION, items });
    });
  }

  async remove(projectId: string | null, skillId: string) {
    return this.#mutate(async () => {
      const manifest = await this.#loader.load();
      const items = manifest.items.filter(
        (candidate) =>
          candidate.projectId !== projectId || candidate.skillId !== skillId,
      );
      if (items.length === manifest.items.length) return;
      await this.#replace({ version: VERSION, items });
    });
  }

  async #mutate(operation: () => Promise<void>) {
    const started = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = started.catch(() => undefined);
    return started;
  }

  async #replace(manifest: Manifest) {
    try {
      await this.#store.write(STORAGE_KEY, JSON.stringify(manifest));
    } catch (error) {
      this.#loader.invalidate();
      throw error;
    }
    this.#loader.replace(manifest);
  }
}

function parseManifest(value: string | undefined): Manifest {
  if (value === undefined) return { version: VERSION, items: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("下载 Skill 清单无法读取。");
  }
  if (isLegacyManifest(parsed)) {
    return {
      items: parsed.items.map((item) => ({ ...item, sourceId: "boltpocket" })),
      version: VERSION,
    };
  }
  if (isVersionTwoManifest(parsed)) {
    return { items: parsed.items, version: VERSION };
  }
  if (
    !record(parsed) ||
    parsed.version !== VERSION ||
    !Array.isArray(parsed.items) ||
    parsed.items.length > MAX_ITEMS ||
    !parsed.items.every(validItem) ||
    Object.keys(parsed).some((key) => key !== "version" && key !== "items")
  ) {
    throw new Error("下载 Skill 清单无效。");
  }
  const items = parsed.items as DownloadedSkill[];
  if (
    new Set(
      items.map((item) => `${item.projectId ?? "inventory"}:${item.skillId}`),
    ).size !== items.length
  ) {
    throw new Error("下载 Skill 清单存在重复项。");
  }
  return { version: VERSION, items };
}

function validItem(value: unknown): value is DownloadedSkill {
  if (!record(value)) return false;
  const keys = new Set([
    "autoUpdate",
    "catalogId",
    "installedAt",
    "projectId",
    "resourcePath",
    "revision",
    "sha256",
    "skillId",
    "sourceId",
    "updatedAt",
  ]);
  return (
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key)) &&
    typeof value.autoUpdate === "boolean" &&
    typeof value.catalogId === "string" &&
    CATALOG_ENTRY_ID.test(value.catalogId) &&
    (value.projectId === null || safeId(value.projectId)) &&
    typeof value.skillId === "string" &&
    SKILL_ID.test(value.skillId) &&
    value.resourcePath === `skills/${value.skillId}/SKILL.md` &&
    typeof value.revision === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.revision) &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256) &&
    safeId(value.sourceId) &&
    validDate(value.installedAt) &&
    validDate(value.updatedAt)
  );
}

function isVersionTwoManifest(value: unknown): value is Readonly<{
  items: readonly VersionTwoDownloadedSkill[];
  version: 2;
}> {
  return (
    record(value) &&
    value.version === 2 &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_ITEMS &&
    value.items.every(
      (item) => validItem(item) && typeof item.projectId === "string",
    ) &&
    Object.keys(value).every((key) => key === "version" || key === "items") &&
    new Set(value.items.map((item) => `${item.projectId}:${item.skillId}`))
      .size === value.items.length
  );
}

function isLegacyManifest(
  value: unknown,
): value is Readonly<{ items: readonly LegacyDownloadedSkill[]; version: 1 }> {
  return (
    record(value) &&
    value.version === 1 &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_ITEMS &&
    value.items.every(validLegacyItem) &&
    Object.keys(value).every((key) => key === "version" || key === "items") &&
    new Set(value.items.map((item) => `${item.projectId}:${item.skillId}`))
      .size === value.items.length
  );
}

function validLegacyItem(value: unknown): value is LegacyDownloadedSkill {
  if (!record(value)) return false;
  const keys = new Set([
    "autoUpdate",
    "catalogId",
    "installedAt",
    "projectId",
    "resourcePath",
    "revision",
    "sha256",
    "skillId",
    "updatedAt",
  ]);
  return (
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key)) &&
    typeof value.autoUpdate === "boolean" &&
    safeId(value.catalogId) &&
    safeId(value.projectId) &&
    typeof value.skillId === "string" &&
    SKILL_ID.test(value.skillId) &&
    value.resourcePath === `skills/${value.skillId}/SKILL.md` &&
    typeof value.revision === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.revision) &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256) &&
    validDate(value.installedAt) &&
    validDate(value.updatedAt)
  );
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
