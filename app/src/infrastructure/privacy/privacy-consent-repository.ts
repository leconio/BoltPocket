import type { ComplianceConfig } from "@/config/compliance";
import {
  complianceDocument,
  type ComplianceDocumentId,
} from "@/domain/compliance-documents";

export const MAINLAND_PRIVACY_POLICY_VERSION = "2026-08-21.1";

const STORAGE_KEY = "boltpocket.privacy-consent.v1";
const SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONSENT_DOCUMENTS: readonly ComplianceDocumentId[] = [
  "privacy",
  "terms",
  "ai-rules",
  "third-parties",
  "personal-information",
  "permissions",
];

export type PrivacyConsentDecision = "accepted" | "declined";

export type PrivacyConsentRecord = Readonly<{
  schema: typeof SCHEMA_VERSION;
  region: "china-mainland";
  policyVersion: typeof MAINLAND_PRIVACY_POLICY_VERSION;
  documentsSha256: string;
  decision: PrivacyConsentDecision;
  adultEligibilityConfirmed: boolean;
  decidedAt: string;
}>;

type SecureStorePort = Readonly<{
  isAvailableAsync?: () => Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}>;

type PrivacyConsentRepositoryOptions = Readonly<{
  secureStore?: SecureStorePort;
  digestSha256?: (value: string) => Promise<string>;
  now?: () => Date;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePrivacyConsentRecord(
  value: string | null,
): PrivacyConsentRecord | null {
  if (!value || value.length > 4_096) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const keys = Object.keys(parsed).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (
    keys.join("\0") !==
    [
      "adultEligibilityConfirmed",
      "decidedAt",
      "decision",
      "documentsSha256",
      "policyVersion",
      "region",
      "schema",
    ].join("\0")
  ) {
    return null;
  }
  if (
    parsed.schema !== SCHEMA_VERSION ||
    parsed.region !== "china-mainland" ||
    parsed.policyVersion !== MAINLAND_PRIVACY_POLICY_VERSION ||
    (parsed.decision !== "accepted" && parsed.decision !== "declined") ||
    typeof parsed.adultEligibilityConfirmed !== "boolean" ||
    (parsed.decision === "accepted" &&
      parsed.adultEligibilityConfirmed !== true) ||
    (parsed.decision === "declined" &&
      parsed.adultEligibilityConfirmed !== false) ||
    typeof parsed.documentsSha256 !== "string" ||
    !SHA256_PATTERN.test(parsed.documentsSha256) ||
    typeof parsed.decidedAt !== "string" ||
    parsed.decidedAt.length > 64 ||
    !Number.isFinite(Date.parse(parsed.decidedAt))
  ) {
    return null;
  }
  return parsed as PrivacyConsentRecord;
}

export function privacyConsentDocumentSource(config: ComplianceConfig) {
  if (config.distributionRegion !== "china-mainland") {
    throw new Error("Only the Mainland China edition requires this consent.");
  }
  return JSON.stringify({
    policyVersion: MAINLAND_PRIVACY_POLICY_VERSION,
    documents: CONSENT_DOCUMENTS.map((id) => {
      const document = complianceDocument(id, config, "zh-CN");
      return { id, markdown: document.markdown, title: document.title };
    }),
  });
}

async function defaultDigestSha256(value: string) {
  const Crypto = await import("expo-crypto");
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

const defaultSecureStore: SecureStorePort = {
  async isAvailableAsync() {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.isAvailableAsync();
  },
  async getItemAsync(key) {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async setItemAsync(key, value) {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
};

export class PrivacyConsentRepository {
  readonly #config: ComplianceConfig;
  readonly #secureStore: SecureStorePort;
  readonly #digestSha256: (value: string) => Promise<string>;
  readonly #now: () => Date;

  constructor(
    config: ComplianceConfig,
    options: PrivacyConsentRepositoryOptions = {},
  ) {
    if (config.distributionRegion !== "china-mainland") {
      throw new Error(
        "PrivacyConsentRepository is only available in the Mainland edition.",
      );
    }
    this.#config = config;
    this.#secureStore = options.secureStore ?? defaultSecureStore;
    this.#digestSha256 = options.digestSha256 ?? defaultDigestSha256;
    this.#now = options.now ?? (() => new Date());
  }

  async loadCurrent(): Promise<PrivacyConsentRecord | null> {
    await this.#assertAvailable();
    const [stored, documentsSha256] = await Promise.all([
      this.#secureStore.getItemAsync(STORAGE_KEY),
      this.#currentDocumentsSha256(),
    ]);
    const record = parsePrivacyConsentRecord(stored);
    if (!record || record.documentsSha256 !== documentsSha256) return null;
    return record;
  }

  async decide(
    decision: PrivacyConsentDecision,
    adultEligibilityConfirmed = false,
  ): Promise<PrivacyConsentRecord> {
    await this.#assertAvailable();
    if (decision === "accepted" && !adultEligibilityConfirmed) {
      throw new Error("Adult eligibility confirmation is required.");
    }
    const record: PrivacyConsentRecord = {
      schema: SCHEMA_VERSION,
      region: "china-mainland",
      policyVersion: MAINLAND_PRIVACY_POLICY_VERSION,
      documentsSha256: await this.#currentDocumentsSha256(),
      decision,
      adultEligibilityConfirmed:
        decision === "accepted" && adultEligibilityConfirmed,
      decidedAt: this.#now().toISOString(),
    };
    await this.#secureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  async #assertAvailable() {
    if (
      this.#secureStore.isAvailableAsync &&
      !(await this.#secureStore.isAvailableAsync())
    ) {
      throw new Error("Secure local consent storage is unavailable.");
    }
  }

  async #currentDocumentsSha256() {
    const digest = (
      await this.#digestSha256(privacyConsentDocumentSource(this.#config))
    ).toLowerCase();
    if (!SHA256_PATTERN.test(digest)) {
      throw new Error("Privacy document digest is invalid.");
    }
    return digest;
  }
}
