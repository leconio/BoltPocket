import type {
  SafetyReportInput,
  SafetyReportPort,
  SafetyReportReceipt,
} from "@/application/ports/safety-report";
import { SafetyReportError } from "@/application/ports/safety-report";
import type { OAuthBrokerConfig } from "@/config/oauth-broker";
import { getCurrentLocale } from "@/i18n/translate";
import { namespacedStorageKey } from "@/infrastructure/persistence/storage-namespace";

const INSTALLATION_ID_KEY = "boltpocket.safety-report-installation.v1";
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type ExpoSafetyReportOptions = {
  appVersion?: string;
  fetch?: typeof fetch;
  installationIdentity?: () => Promise<string>;
  locale?: () => string;
  platform?: "android" | "ios";
  requestTimeoutMs?: number;
  storageNamespace?: string;
};

export class ExpoSafetyReportService implements SafetyReportPort {
  readonly #baseUrl: string;
  readonly #appVersion: string;
  readonly #fetch: typeof fetch;
  readonly #installationIdentity: () => Promise<string>;
  readonly #locale: () => string;
  readonly #platform: "android" | "ios";
  readonly #requestTimeoutMs: number;

  constructor(
    config: OAuthBrokerConfig,
    options: ExpoSafetyReportOptions = {},
  ) {
    this.#baseUrl = config.baseUrl;
    this.#appVersion = options.appVersion ?? "unknown";
    this.#fetch = options.fetch ?? fetch;
    this.#installationIdentity =
      options.installationIdentity ??
      (() => installationIdentity(options.storageNamespace));
    this.#locale = options.locale ?? getCurrentLocale;
    this.#platform = options.platform ?? "android";
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new Error("安全举报请求超时配置无效。");
    }
  }

  async submit(
    input: SafetyReportInput,
    signal?: AbortSignal,
  ): Promise<SafetyReportReceipt> {
    let installationId: string;
    try {
      installationId = await this.#installationIdentity();
    } catch (error) {
      throw new SafetyReportError("submit-failed", { cause: error });
    }
    if (!UUID_PATTERN.test(installationId)) {
      throw new SafetyReportError("submit-failed");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, this.#requestTimeoutMs);
    let body: string;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/reports`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-BoltPocket-Installation-Id": installationId,
        },
        body: JSON.stringify({
          appVersion: this.#appVersion,
          category: input.category,
          includeContent: input.includeContent,
          locale: this.#locale(),
          platform: this.#platform,
          targetId: input.targetId,
          targetType: input.targetType,
          ...(input.includeContent && input.excerpt
            ? { excerpt: input.excerpt.slice(0, 4_000) }
            : {}),
          ...(input.includeContent && input.note
            ? { note: input.note.slice(0, 2_000) }
            : {}),
        }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafetyReportError("invalid-response");
      }
      body = await response.text();
    } catch (error) {
      if (error instanceof SafetyReportError) throw error;
      throw new SafetyReportError("submit-failed", { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new SafetyReportError("invalid-response");
    }
    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      value = null;
    }
    if (!response.ok) {
      throw new SafetyReportError(
        errorCode(value) === "report_rate_limited"
          ? "rate-limited"
          : "submit-failed",
      );
    }
    if (!isRecord(value)) throw new SafetyReportError("invalid-response");
    const reportId = value.reportId;
    const expiresAt = value.expiresAt;
    if (
      typeof reportId !== "string" ||
      !UUID_PATTERN.test(reportId) ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      value.status !== "received"
    ) {
      throw new SafetyReportError("invalid-response");
    }
    return { expiresAt, reportId, status: "received" };
  }
}

async function installationIdentity(
  storageNamespace?: string,
): Promise<string> {
  const [Crypto, SecureStore] = await Promise.all([
    import("expo-crypto"),
    import("expo-secure-store"),
  ]);
  const options = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  const installationIdKey = namespacedStorageKey(
    INSTALLATION_ID_KEY,
    storageNamespace,
  );
  const stored = await SecureStore.getItemAsync(installationIdKey, options);
  if (stored !== null && UUID_PATTERN.test(stored)) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(installationIdKey, created, options);
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.code === "string" ? value.error.code : null;
}
