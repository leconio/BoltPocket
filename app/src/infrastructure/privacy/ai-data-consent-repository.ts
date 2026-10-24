import type {
  AiDataCategory,
  AiDataConsentGrant,
  AiDataConsentStore,
} from "@/application/ports/ai-data-consent";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";
import { namespacedStorageKey } from "@/infrastructure/persistence/storage-namespace";
import {
  createMutableSingleFlightLoader,
  type MutableSingleFlightLoader,
} from "@/infrastructure/persistence/single-flight-loader";

const STORAGE_KEY = "privacy:ai-data-consents:v1";
const MANIFEST_VERSION = 1;
const MAX_GRANTS = 64;
const categories: readonly AiDataCategory[] = [
  "message",
  "attachments",
  "project-context",
  "connected-documents",
];

type Manifest = {
  version: typeof MANIFEST_VERSION;
  grants: AiDataConsentGrant[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validGrant(value: unknown): value is AiDataConsentGrant {
  if (!record(value)) return false;
  return (
    safeText(value.consentKey, 4_096) &&
    safeText(value.providerId, 240) &&
    safeText(value.providerName, 320) &&
    safeText(value.baseUrl, 2_048) &&
    safeText(value.modelId, 256) &&
    safeText(value.modelName, 320) &&
    safeText(value.recipientName, 320) &&
    (value.recipientLocation === null ||
      safeText(value.recipientLocation, 120)) &&
    (value.filingNumber === null || safeText(value.filingNumber, 240)) &&
    (typeof value.crossBorder === "boolean" ||
      value.crossBorder === "unknown") &&
    Array.isArray(value.categories) &&
    value.categories.length > 0 &&
    value.categories.every((item) =>
      categories.includes(item as AiDataCategory),
    ) &&
    safeText(value.consentedAt, 64) &&
    Number.isFinite(Date.parse(value.consentedAt)) &&
    safeText(value.policyVersion, 64)
  );
}

function parseManifest(value: string | undefined): Manifest {
  if (!value) return { version: MANIFEST_VERSION, grants: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("本机 AI 数据授权记录无效。");
  }
  if (
    !record(parsed) ||
    parsed.version !== MANIFEST_VERSION ||
    !Array.isArray(parsed.grants) ||
    parsed.grants.length > MAX_GRANTS ||
    !parsed.grants.every(validGrant)
  ) {
    throw new Error("本机 AI 数据授权记录无效。");
  }
  const grants = parsed.grants as AiDataConsentGrant[];
  if (new Set(grants.map((grant) => grant.consentKey)).size !== grants.length) {
    throw new Error("本机 AI 数据授权记录存在重复项。");
  }
  return { version: MANIFEST_VERSION, grants };
}

export class AiDataConsentRepository implements AiDataConsentStore {
  readonly #store: DurableDocumentStore;
  readonly #storageKey: string;
  readonly #manifestLoader: MutableSingleFlightLoader<Manifest>;

  constructor(store: DurableDocumentStore, storageNamespace?: string) {
    this.#store = store;
    this.#storageKey = namespacedStorageKey(STORAGE_KEY, storageNamespace);
    this.#manifestLoader = createMutableSingleFlightLoader(async () =>
      parseManifest(await this.#store.read(this.#storageKey)),
    );
  }

  async find(consentKey: string) {
    return (
      (await this.#manifest()).grants.find(
        (grant) => grant.consentKey === consentKey,
      ) ?? null
    );
  }

  async list() {
    return [...(await this.#manifest()).grants].sort((left, right) =>
      right.consentedAt.localeCompare(left.consentedAt, "en"),
    );
  }

  async save(grant: AiDataConsentGrant) {
    if (!validGrant(grant)) throw new Error("AI 数据授权内容无效。");
    const manifest = await this.#manifest();
    const grants = [
      ...manifest.grants.filter((item) => item.consentKey !== grant.consentKey),
      grant,
    ];
    if (grants.length > MAX_GRANTS)
      throw new Error("AI 数据授权记录已达上限。");
    const nextManifest: Manifest = { version: MANIFEST_VERSION, grants };
    try {
      await this.#store.write(this.#storageKey, JSON.stringify(nextManifest));
    } catch (error) {
      this.#manifestLoader.invalidate();
      throw error;
    }
    this.#manifestLoader.replace(nextManifest);
  }

  async withdrawAll() {
    try {
      await this.#store.remove(this.#storageKey);
    } catch (error) {
      this.#manifestLoader.invalidate();
      throw error;
    }
    this.#manifestLoader.replace({ version: MANIFEST_VERSION, grants: [] });
  }

  async #manifest() {
    return this.#manifestLoader.load();
  }
}
