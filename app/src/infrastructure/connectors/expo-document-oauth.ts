import type {
  DocumentAccessTokenLease,
  DocumentOAuthConnection,
  DocumentOAuthPort,
  DocumentProviderId,
} from "@/application/ports/document-oauth";
import type { OAuthBrokerConfig } from "@/config/oauth-broker";
import { assertCloudDocumentConnectorsPermitted } from "@/config/compliance";
import { namespacedStorageKey } from "@/infrastructure/persistence/storage-namespace";

const INDEX_KEY = "boltpocket-document-oauth-index-v1";
const SESSION_PREFIX = "boltpocket-document-oauth-session-v1.";
const PENDING_PREFIX = "boltpocket-document-oauth-pending-v1.";
const CONNECTION_ID = /^conn_[A-Za-z0-9_-]{32}$/u;
const SESSION_TOKEN = /^ihs_[A-Za-z0-9_-]{43}$/u;
const RECEIPT = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_TYPE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;

type StoredSession = DocumentOAuthConnection & { sessionToken: string };

type DocumentSecureStore = {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type DocumentAuthSessionResult = {
  type: string;
  url?: string;
};

type ExpoDocumentOAuthOptions = {
  fetch?: typeof fetch;
  openAuthSession?: (
    url: string,
    redirectUrl: string,
  ) => Promise<DocumentAuthSessionResult>;
  secureStore?: DocumentSecureStore;
  now?: () => number;
  randomVerifier?: () => Promise<string>;
  sha256Base64Url?: (value: string) => Promise<string>;
  assertConnectionPermitted?: () => void;
  requestTimeoutMs?: number;
  storageNamespace?: string;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class ExpoDocumentOAuth implements DocumentOAuthPort {
  readonly #config: OAuthBrokerConfig;
  readonly #fetch: typeof fetch;
  readonly #openAuthSession: NonNullable<
    ExpoDocumentOAuthOptions["openAuthSession"]
  >;
  readonly #store: ExpoDocumentOAuthOptions["secureStore"];
  readonly #now: () => number;
  readonly #randomVerifier: () => Promise<string>;
  readonly #sha256Base64Url: (value: string) => Promise<string>;
  readonly #assertConnectionPermitted: () => void;
  readonly #requestTimeoutMs: number;
  readonly #storageNamespace?: string;
  readonly #leases = new Map<string, DocumentAccessTokenLease>();
  readonly #completions = new Map<string, Promise<DocumentOAuthConnection>>();

  constructor(
    config: OAuthBrokerConfig,
    options: ExpoDocumentOAuthOptions = {},
  ) {
    this.#config = config;
    this.#fetch = options.fetch ?? fetch;
    this.#openAuthSession = options.openAuthSession ?? openSystemAuthSession;
    this.#store = options.secureStore ?? secureStore;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#randomVerifier = options.randomVerifier ?? randomBase64Url;
    this.#sha256Base64Url = options.sha256Base64Url ?? sha256Base64Url;
    this.#assertConnectionPermitted =
      options.assertConnectionPermitted ??
      assertCloudDocumentConnectorsPermitted;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#storageNamespace = options.storageNamespace;
    namespacedStorageKey(INDEX_KEY, this.#storageNamespace);
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new Error("OAuth 请求超时配置无效。");
    }
  }

  async connect(provider: DocumentProviderId) {
    this.#assertConnectionPermitted();
    const verifier = await this.#randomVerifier();
    const challenge = await this.#sha256Base64Url(verifier);
    await this.#store!.setItemAsync(
      this.#storageKey(`${PENDING_PREFIX}${provider}`),
      verifier,
    );
    try {
      const started = await this.#json(
        `${this.#config.baseUrl}/v1/oauth/${provider}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appChallenge: challenge }),
        },
      );
      const authorizationUrl = recordString(started, "authorizationUrl", 8_192);
      const returnedProvider = providerValue(started.provider);
      if (returnedProvider !== provider) throw invalidBrokerResponse();
      const authResult = await this.#openAuthSession(
        authorizationUrl,
        this.#config.returnUrl,
      );
      if (authResult.type !== "success" || typeof authResult.url !== "string") {
        return null;
      }
      return await this.completeFromUrl(authResult.url, provider);
    } finally {
      await this.#store!.deleteItemAsync(
        this.#storageKey(`${PENDING_PREFIX}${provider}`),
      ).catch(() => undefined);
    }
  }

  async completeFromUrl(
    urlValue: string,
    expectedProvider?: DocumentProviderId,
  ) {
    this.#assertConnectionPermitted();
    const key = urlValue;
    const existing = this.#completions.get(key);
    if (existing) return existing;
    const completion = this.#completeFromUrl(urlValue, expectedProvider);
    this.#completions.set(key, completion);
    try {
      return await completion;
    } finally {
      if (this.#completions.size > 32) this.#completions.delete(key);
    }
  }

  async #completeFromUrl(
    urlValue: string,
    expectedProvider?: DocumentProviderId,
  ) {
    const url = new URL(urlValue);
    if (
      url.protocol !== "boltpocket:" ||
      url.hostname !== "oauth" ||
      url.pathname !== "/complete"
    ) {
      throw new Error("OAuth 回跳地址无效。");
    }
    const provider = providerValue(url.searchParams.get("provider"));
    if (expectedProvider && provider !== expectedProvider) {
      throw new Error("OAuth 回跳的连接器不匹配。");
    }
    const connectionId = url.searchParams.get("connection_id") ?? "";
    const receipt = url.searchParams.get("receipt") ?? "";
    if (!CONNECTION_ID.test(connectionId) || !RECEIPT.test(receipt)) {
      throw new Error("OAuth 回跳凭据无效。");
    }
    const verifier = await this.#store!.getItemAsync(
      this.#storageKey(`${PENDING_PREFIX}${provider}`),
    );
    if (!verifier) {
      throw new Error("授权已返回，但本机设备绑定已过期；请重新连接。");
    }
    const completed = await this.#json(
      `${this.#config.baseUrl}/v1/oauth/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, receipt, appVerifier: verifier }),
      },
    );
    const connection = parseConnection(completed, provider);
    const sessionToken = recordString(completed, "sessionToken", 128);
    const expiresAt = recordNumber(completed, "expiresAt");
    if (!SESSION_TOKEN.test(sessionToken) || expiresAt <= this.#now()) {
      throw invalidBrokerResponse();
    }
    const stored: StoredSession = { ...connection, expiresAt, sessionToken };
    await this.#save(stored);
    await this.#store!.deleteItemAsync(
      this.#storageKey(`${PENDING_PREFIX}${provider}`),
    ).catch(() => undefined);
    return { ...connection, expiresAt };
  }

  async list(provider?: DocumentProviderId) {
    const sessions = await Promise.all(
      (await this.#sessions()).map((session) => this.#refreshStatus(session)),
    );
    return sessions
      .filter(
        (session) =>
          session.expiresAt > this.#now() &&
          (!provider || session.provider === provider),
      )
      .map(({ sessionToken: _sessionToken, ...connection }) => connection);
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!CONNECTION_ID.test(connectionId)) throw new Error("连接器会话无效。");
    const session = await this.#session(connectionId);
    if (!session || session.expiresAt <= this.#now()) {
      throw new Error("文档授权已过期，无法确认服务端数据已经删除。");
    }
    const response = await this.#networkRequest((signal) =>
      this.#fetch(`${this.#config.baseUrl}/v1/connections/${connectionId}`, {
        method: "DELETE",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.sessionToken}`,
        },
        signal,
      }),
    ).catch((error: unknown) => {
      throw new Error("无法连接文档授权服务；服务端数据尚未确认删除。", {
        cause: error,
      });
    });
    if (response.status !== 204) {
      throw new Error("文档授权服务未确认删除；本机仍保留撤销凭据以便重试。");
    }
    const index = new Set(await this.#index());
    index.delete(connectionId);
    await this.#store!.setItemAsync(
      this.#storageKey(INDEX_KEY),
      JSON.stringify([...index].sort()),
    );
    await this.#store!.deleteItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${connectionId}`),
    );
    this.#leases.delete(connectionId);
  }

  async lease(connectionId: string): Promise<DocumentAccessTokenLease> {
    this.#assertConnectionPermitted();
    if (!CONNECTION_ID.test(connectionId)) throw new Error("连接器会话无效。");
    const cached = this.#leases.get(connectionId);
    if (cached && cached.leaseExpiresAt > this.#now() + 15) return cached;
    const session = await this.#session(connectionId);
    if (!session || session.expiresAt <= this.#now()) {
      throw new Error("文档授权已过期，请重新连接。");
    }
    const value = await this.#json(
      `${this.#config.baseUrl}/v1/connections/${connectionId}/token`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      },
    );
    const provider = providerValue(value.provider);
    const returnedConnectionId = recordString(value, "connectionId", 64);
    const accessToken = recordString(value, "accessToken", 16_384);
    const tokenType = recordString(value, "tokenType", 64);
    const leaseExpiresAt = recordNumber(value, "leaseExpiresAt");
    if (
      provider !== session.provider ||
      returnedConnectionId !== connectionId ||
      !TOKEN_TYPE.test(tokenType) ||
      leaseExpiresAt <= this.#now()
    ) {
      throw invalidBrokerResponse();
    }
    const lease = {
      provider,
      connectionId,
      accessToken,
      tokenType,
      leaseExpiresAt,
    };
    this.#leases.set(connectionId, lease);
    return lease;
  }

  async connectionForAccount(provider: DocumentProviderId, accountId: string) {
    return (await this.list(provider)).find(
      (session) =>
        session.accountId === accountId &&
        !session.requiresReauthorization &&
        session.expiresAt > this.#now(),
    );
  }

  async #refreshStatus(session: StoredSession): Promise<StoredSession> {
    try {
      const value = await this.#json(
        `${this.#config.baseUrl}/v1/connections/${session.connectionId}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${session.sessionToken}` },
        },
      );
      const current = parseConnection(value, session.provider);
      if (
        current.connectionId !== session.connectionId ||
        current.accountId !== session.accountId
      ) {
        throw invalidBrokerResponse();
      }
      const refreshed = { ...session, ...current };
      await this.#store!.setItemAsync(
        this.#storageKey(`${SESSION_PREFIX}${session.connectionId}`),
        JSON.stringify(refreshed),
      ).catch(() => undefined);
      return refreshed;
    } catch {
      // Offline status checks must not erase the local revocation handle.
      return session;
    }
  }

  clearLease(accessToken: string) {
    for (const [connectionId, lease] of this.#leases) {
      if (lease.accessToken === accessToken) this.#leases.delete(connectionId);
    }
  }

  async #json(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const { body, response } = await this.#networkRequest(async (signal) => {
      const response = await this.#fetch(url, {
        ...init,
        credentials: "omit",
        headers: { Accept: "application/json", ...init.headers },
        signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw invalidBrokerResponse();
      }
      return { body: await response.text(), response };
    }, init.signal);
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw invalidBrokerResponse();
    }
    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      throw invalidBrokerResponse();
    }
    if (!response.ok) {
      const message =
        isRecord(value) &&
        isRecord(value.error) &&
        typeof value.error.message === "string"
          ? value.error.message.slice(0, 500)
          : "文档授权服务拒绝了请求。";
      throw new Error(message);
    }
    if (!isRecord(value)) throw invalidBrokerResponse();
    return value;
  }

  async #networkRequest<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal | null,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timeout = setTimeout(abort, this.#requestTimeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof InvalidBrokerResponseError) throw error;
      throw new Error("无法连接文档授权服务，请检查网络后重试。", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async #save(session: StoredSession) {
    const index = new Set(await this.#index());
    const replacedConnectionIds: string[] = [];
    for (const connectionId of index) {
      if (connectionId === session.connectionId) continue;
      const existing = await this.#session(connectionId);
      if (
        existing?.provider === session.provider &&
        existing.accountId === session.accountId
      ) {
        index.delete(connectionId);
        replacedConnectionIds.push(connectionId);
      }
    }
    index.add(session.connectionId);
    await this.#store!.setItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${session.connectionId}`),
      JSON.stringify(session),
    );
    await this.#store!.setItemAsync(
      this.#storageKey(INDEX_KEY),
      JSON.stringify([...index].sort()),
    );
    await Promise.all(
      replacedConnectionIds.map(async (connectionId) => {
        this.#leases.delete(connectionId);
        await this.#store!.deleteItemAsync(
          this.#storageKey(`${SESSION_PREFIX}${connectionId}`),
        );
      }),
    );
  }

  async #sessions() {
    const sessions: StoredSession[] = [];
    for (const id of await this.#index()) {
      const session = await this.#session(id);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  async #session(connectionId: string) {
    const value = await this.#store!.getItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${connectionId}`),
    );
    if (!value) return null;
    try {
      return parseStoredSession(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  async #index() {
    const value = await this.#store!.getItemAsync(this.#storageKey(INDEX_KEY));
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length > 32 ||
        !parsed.every(
          (item) => typeof item === "string" && CONNECTION_ID.test(item),
        )
      ) {
        return [];
      }
      return [...new Set(parsed)];
    } catch {
      return [];
    }
  }

  #storageKey(key: string) {
    return namespacedStorageKey(key, this.#storageNamespace);
  }
}

function parseConnection(
  value: Record<string, unknown>,
  expectedProvider: DocumentProviderId,
): Omit<DocumentOAuthConnection, "expiresAt"> {
  if (!isRecord(value.connection)) throw invalidBrokerResponse();
  const connectionId = recordString(value.connection, "id", 64);
  const provider = providerValue(value.connection.provider);
  const accountId = recordString(value.connection, "accountId", 512);
  const accountNameValue = value.connection.accountName;
  const accountName =
    typeof accountNameValue === "string" && accountNameValue.length <= 1_024
      ? accountNameValue
      : accountId;
  const requiresReauthorizationValue = value.connection.requiresReauthorization;
  const requiresReauthorization =
    requiresReauthorizationValue === undefined
      ? false
      : requiresReauthorizationValue;
  if (!CONNECTION_ID.test(connectionId) || provider !== expectedProvider) {
    throw invalidBrokerResponse();
  }
  if (typeof requiresReauthorization !== "boolean") {
    throw invalidBrokerResponse();
  }
  return {
    accountId,
    accountName,
    connectionId,
    provider,
    requiresReauthorization,
  };
}

function parseStoredSession(value: unknown): StoredSession {
  if (!isRecord(value)) throw invalidBrokerResponse();
  const provider = providerValue(value.provider);
  const connectionId = recordString(value, "connectionId", 64);
  const sessionToken = recordString(value, "sessionToken", 128);
  const accountId = recordString(value, "accountId", 512);
  const accountName = recordString(value, "accountName", 1_024);
  const expiresAt = recordNumber(value, "expiresAt");
  const requiresReauthorization =
    value.requiresReauthorization === undefined
      ? false
      : value.requiresReauthorization;
  if (!CONNECTION_ID.test(connectionId) || !SESSION_TOKEN.test(sessionToken)) {
    throw invalidBrokerResponse();
  }
  if (typeof requiresReauthorization !== "boolean") {
    throw invalidBrokerResponse();
  }
  return {
    provider,
    connectionId,
    sessionToken,
    accountId,
    accountName,
    expiresAt,
    requiresReauthorization,
  };
}

function providerValue(value: unknown): DocumentProviderId {
  if (value !== "google" && value !== "notion") throw invalidBrokerResponse();
  return value;
}

function recordString(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0 || item.length > maximum) {
    throw invalidBrokerResponse();
  }
  return item;
}

function recordNumber(value: Record<string, unknown>, key: string) {
  const item = value[key];
  if (!Number.isSafeInteger(item) || (item as number) <= 0)
    throw invalidBrokerResponse();
  return item as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function randomBase64Url() {
  const Crypto = await import("expo-crypto");
  return sha256Base64Url(`${Crypto.randomUUID()}\u0000${Crypto.randomUUID()}`);
}

async function sha256Base64Url(value: string) {
  const Crypto = await import("expo-crypto");
  const base64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function openSystemAuthSession(url: string, redirectUrl: string) {
  const WebBrowser = await import("expo-web-browser");
  return WebBrowser.openAuthSessionAsync(url, redirectUrl);
}

const secureStore: DocumentSecureStore = {
  async deleteItemAsync(key) {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.deleteItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
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

class InvalidBrokerResponseError extends Error {
  constructor() {
    super("文档授权服务返回了无效数据。");
    this.name = "InvalidBrokerResponseError";
  }
}

function invalidBrokerResponse() {
  return new InvalidBrokerResponseError();
}
