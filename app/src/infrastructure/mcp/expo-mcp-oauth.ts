import type {
  McpOAuthAuthorization,
  McpOAuthPort,
} from "@/application/ports/mcp-connections";
import { isAccountAuthenticationRequiredError } from "@/application/ports/authentication";
import type { OAuthBrokerConfig } from "@/config/oauth-broker";
import { isAuthenticationError } from "@/infrastructure/auth/casdoor-authentication";
import { namespacedStorageKey } from "@/infrastructure/persistence/storage-namespace";

const SESSION_PREFIX = "boltpocket-mcp-oauth-session-v1.";
const PENDING_PREFIX = "boltpocket-mcp-oauth-pending-v1.";
const AUTHORIZATION_ID = /^mcpa_[A-Za-z0-9_-]{43}$/u;
const SESSION_TOKEN = /^mcps_[A-Za-z0-9_-]{43}$/u;
const RECEIPT = /^[A-Za-z0-9_-]{43}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_TYPE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type StoredSession = McpOAuthAuthorization & { sessionToken: string };
type PendingFlow = Readonly<{ serverUrl: string; verifier: string }>;

type McpOAuthSecureStore = {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type McpAuthSessionResult = { type: string; url?: string };

type ExpoMcpOAuthOptions = Readonly<{
  fetch?: typeof fetch;
  now?: () => number;
  openAuthSession?: (
    url: string,
    redirectUrl: string,
  ) => Promise<McpAuthSessionResult>;
  randomVerifier?: () => Promise<string>;
  requestTimeoutMs?: number;
  secureStore?: McpOAuthSecureStore;
  sha256Base64Url?: (value: string) => Promise<string>;
  storageNamespace?: string;
}>;

export class ExpoMcpOAuth implements McpOAuthPort {
  readonly #config: OAuthBrokerConfig;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #openAuthSession: NonNullable<
    ExpoMcpOAuthOptions["openAuthSession"]
  >;
  readonly #randomVerifier: () => Promise<string>;
  readonly #requestTimeoutMs: number;
  readonly #secureStore: McpOAuthSecureStore;
  readonly #sha256Base64Url: (value: string) => Promise<string>;
  readonly #storageNamespace?: string;
  readonly #completions = new Map<string, Promise<McpOAuthAuthorization>>();
  readonly #forceRefresh = new Set<string>();
  readonly #leases = new Map<
    string,
    { accessToken: string; leaseExpiresAt: number }
  >();

  constructor(config: OAuthBrokerConfig, options: ExpoMcpOAuthOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#openAuthSession = options.openAuthSession ?? openSystemAuthSession;
    this.#randomVerifier = options.randomVerifier ?? randomBase64Url;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#secureStore = options.secureStore ?? secureStore;
    this.#sha256Base64Url = options.sha256Base64Url ?? sha256Base64Url;
    this.#storageNamespace = options.storageNamespace;
    namespacedStorageKey(SESSION_PREFIX, this.#storageNamespace);
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new Error("MCP OAuth 请求超时配置无效。");
    }
  }

  async connect(
    serverUrlValue: string,
    requiredScopes: readonly string[] = [],
  ) {
    const serverUrl = normalizedServerUrl(serverUrlValue);
    const scopes = normalizedScopes(requiredScopes);
    const verifier = await this.#randomVerifier();
    const challenge = await this.#sha256Base64Url(verifier);
    if (!CHALLENGE.test(challenge)) throw invalidBrokerResponse();
    const pendingKey = this.#storageKey(`${PENDING_PREFIX}${challenge}`);
    await this.#secureStore.setItemAsync(
      pendingKey,
      JSON.stringify({ serverUrl, verifier } satisfies PendingFlow),
    );
    try {
      const started = await this.#json(
        `${this.#config.baseUrl}/v1/mcp/oauth/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appChallenge: challenge,
            serverUrl,
            ...(scopes.length ? { scopes } : {}),
          }),
        },
      );
      const authorizationUrl = recordString(started, "authorizationUrl", 8_192);
      if (
        normalizedServerUrl(recordString(started, "serverUrl", 2_048)) !==
        serverUrl
      ) {
        throw invalidBrokerResponse();
      }
      const authResult = await this.#openAuthSession(
        authorizationUrl,
        "boltpocket://oauth/mcp/complete",
      );
      if (authResult.type !== "success" || typeof authResult.url !== "string") {
        return null;
      }
      return await this.completeFromUrl(authResult.url);
    } finally {
      await this.#secureStore
        .deleteItemAsync(pendingKey)
        .catch(() => undefined);
    }
  }

  async completeFromUrl(urlValue: string) {
    const existing = this.#completions.get(urlValue);
    if (existing) return existing;
    const completion = this.#completeFromUrl(urlValue);
    this.#completions.set(urlValue, completion);
    try {
      return await completion;
    } finally {
      if (this.#completions.size > 32) this.#completions.delete(urlValue);
    }
  }

  async #completeFromUrl(urlValue: string) {
    const url = new URL(urlValue);
    if (
      url.protocol !== "boltpocket:" ||
      url.hostname !== "oauth" ||
      url.pathname !== "/mcp/complete"
    ) {
      throw new Error("MCP OAuth 回跳地址无效。");
    }
    const authorizationId = url.searchParams.get("authorization_id") ?? "";
    const receipt = url.searchParams.get("receipt") ?? "";
    const challenge = url.searchParams.get("app_challenge") ?? "";
    if (
      !AUTHORIZATION_ID.test(authorizationId) ||
      !RECEIPT.test(receipt) ||
      !CHALLENGE.test(challenge)
    ) {
      throw new Error("MCP OAuth 回跳凭据无效。");
    }
    const pendingKey = this.#storageKey(`${PENDING_PREFIX}${challenge}`);
    const pending = parsePending(
      await this.#secureStore.getItemAsync(pendingKey),
    );
    if (!pending) {
      throw new Error("MCP 授权已返回，但本机设备绑定已过期；请重新连接。");
    }
    const completed = await this.#json(
      `${this.#config.baseUrl}/v1/mcp/oauth/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appVerifier: pending.verifier,
          authorizationId,
          receipt,
        }),
      },
    );
    const authorization = parseAuthorization(completed);
    const sessionToken = recordString(completed, "sessionToken", 128);
    const expiresAt = recordNumber(completed, "expiresAt");
    if (
      !SESSION_TOKEN.test(sessionToken) ||
      expiresAt <= this.#now() ||
      authorization.authorizationId !== authorizationId ||
      authorization.serverUrl !== pending.serverUrl
    ) {
      throw invalidBrokerResponse();
    }
    const stored: StoredSession = {
      ...authorization,
      expiresAt,
      sessionToken,
    };
    await this.#secureStore.setItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${authorizationId}`),
      JSON.stringify(stored),
    );
    await this.#secureStore.deleteItemAsync(pendingKey).catch(() => undefined);
    return authorizationWithExpiry(stored);
  }

  async lease(authorizationId: string, serverUrlValue: string) {
    if (!AUTHORIZATION_ID.test(authorizationId)) {
      throw new Error("MCP OAuth 授权编号无效。");
    }
    const serverUrl = normalizedServerUrl(serverUrlValue);
    const cached = this.#leases.get(authorizationId);
    if (
      cached &&
      !this.#forceRefresh.has(authorizationId) &&
      cached.leaseExpiresAt > this.#now() + 15
    ) {
      return cached;
    }
    const session = await this.#session(authorizationId);
    if (
      !session ||
      session.expiresAt <= this.#now() ||
      session.serverUrl !== serverUrl
    ) {
      throw new Error("MCP OAuth 授权已过期或与服务地址不匹配，请重新连接。");
    }
    const forceRefresh = this.#forceRefresh.delete(authorizationId);
    const value = await this.#json(
      `${this.#config.baseUrl}/v1/mcp/oauth/authorizations/${authorizationId}/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ forceRefresh }),
      },
    );
    const returnedId = recordString(value, "authorizationId", 80);
    const returnedServerUrl = normalizedServerUrl(
      recordString(value, "serverUrl", 2_048),
    );
    const accessToken = recordString(value, "accessToken", 16_384);
    const tokenType = recordString(value, "tokenType", 64);
    const leaseExpiresAt = recordNumber(value, "leaseExpiresAt");
    const sessionExpiresAt = optionalRecordNumber(value, "sessionExpiresAt");
    if (
      returnedId !== authorizationId ||
      returnedServerUrl !== serverUrl ||
      !TOKEN_TYPE.test(tokenType) ||
      tokenType.toLowerCase() !== "bearer" ||
      leaseExpiresAt <= this.#now()
    ) {
      throw invalidBrokerResponse();
    }
    if (sessionExpiresAt !== undefined) {
      if (sessionExpiresAt <= this.#now()) throw invalidBrokerResponse();
      await this.#secureStore.setItemAsync(
        this.#storageKey(`${SESSION_PREFIX}${authorizationId}`),
        JSON.stringify({ ...session, expiresAt: sessionExpiresAt }),
      );
    }
    const lease = { accessToken, leaseExpiresAt };
    this.#leases.set(authorizationId, lease);
    return lease;
  }

  async invalidate(authorizationId: string) {
    this.#leases.delete(authorizationId);
    this.#forceRefresh.add(authorizationId);
  }

  async disconnect(authorizationId: string) {
    if (!AUTHORIZATION_ID.test(authorizationId)) {
      throw new Error("MCP OAuth 授权编号无效。");
    }
    const session = await this.#session(authorizationId);
    if (!session || session.expiresAt <= this.#now()) {
      throw new Error("MCP OAuth 授权已过期，无法确认服务端凭据已经删除。");
    }
    const response = await this.#networkRequest((signal) =>
      this.#fetch(
        `${this.#config.baseUrl}/v1/mcp/oauth/authorizations/${authorizationId}`,
        {
          method: "DELETE",
          credentials: "omit",
          headers: { Authorization: `Bearer ${session.sessionToken}` },
          signal,
        },
      ),
    );
    if (response.status !== 204) {
      throw new Error(
        "MCP OAuth broker 未确认删除；本机仍保留撤销凭据以便重试。",
      );
    }
    await this.#secureStore.deleteItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${authorizationId}`),
    );
    this.#leases.delete(authorizationId);
    this.#forceRefresh.delete(authorizationId);
  }

  async #session(authorizationId: string) {
    const value = await this.#secureStore.getItemAsync(
      this.#storageKey(`${SESSION_PREFIX}${authorizationId}`),
    );
    if (!value) return null;
    try {
      return parseStoredSession(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  #storageKey(key: string) {
    return namespacedStorageKey(key, this.#storageNamespace);
  }

  async #json(url: string, init: RequestInit) {
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
    });
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
          : "MCP OAuth broker 拒绝了请求。";
      throw new Error(message);
    }
    if (!isRecord(value)) throw invalidBrokerResponse();
    return value;
  }

  async #networkRequest<T>(operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#requestTimeoutMs,
    );
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (
        error instanceof InvalidMcpOAuthBrokerResponseError ||
        isAccountAuthenticationRequiredError(error) ||
        isAuthenticationError(error)
      ) {
        throw error;
      }
      throw new Error("无法连接 MCP OAuth broker，请检查网络后重试。", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parsePending(value: string | null): PendingFlow | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const verifier = recordString(parsed, "verifier", 128);
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(verifier)) return null;
    return {
      serverUrl: normalizedServerUrl(recordString(parsed, "serverUrl", 2_048)),
      verifier,
    };
  } catch {
    return null;
  }
}

function parseAuthorization(value: Record<string, unknown>) {
  if (!isRecord(value.authorization)) throw invalidBrokerResponse();
  const requiresReauthorization = value.authorization.requiresReauthorization;
  if (typeof requiresReauthorization !== "boolean")
    throw invalidBrokerResponse();
  return {
    authorizationId: recordString(value.authorization, "id", 80),
    expiresAt: recordNumber(value, "expiresAt"),
    requiresReauthorization,
    serverUrl: normalizedServerUrl(
      recordString(value.authorization, "serverUrl", 2_048),
    ),
  } satisfies McpOAuthAuthorization;
}

function parseStoredSession(value: unknown): StoredSession {
  if (!isRecord(value)) throw invalidBrokerResponse();
  const authorizationId = recordString(value, "authorizationId", 80);
  const sessionToken = recordString(value, "sessionToken", 128);
  const requiresReauthorization = value.requiresReauthorization;
  if (
    !AUTHORIZATION_ID.test(authorizationId) ||
    !SESSION_TOKEN.test(sessionToken) ||
    typeof requiresReauthorization !== "boolean"
  ) {
    throw invalidBrokerResponse();
  }
  return {
    authorizationId,
    expiresAt: recordNumber(value, "expiresAt"),
    requiresReauthorization,
    serverUrl: normalizedServerUrl(recordString(value, "serverUrl", 2_048)),
    sessionToken,
  };
}

function authorizationWithExpiry(value: StoredSession): McpOAuthAuthorization {
  const { sessionToken: _sessionToken, ...authorization } = value;
  return authorization;
}

function normalizedServerUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("MCP OAuth 服务地址必须使用 HTTPS。");
  }
  return url.toString();
}

function normalizedScopes(value: readonly string[]) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("MCP OAuth scope 列表无效。");
  }
  const scopes = [...new Set(value)];
  if (
    scopes.some(
      (scope) =>
        typeof scope !== "string" ||
        !scope ||
        !/^[\u0021\u0023-\u005b\u005d-\u007e]{1,256}$/u.test(scope),
    )
  ) {
    throw new Error("MCP OAuth scope 无效。");
  }
  return scopes.sort();
}

function recordString(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const item = value[key];
  if (typeof item !== "string" || !item || item.length > maximum) {
    throw invalidBrokerResponse();
  }
  return item;
}

function recordNumber(value: Record<string, unknown>, key: string) {
  const item = value[key];
  if (!Number.isSafeInteger(item) || (item as number) <= 0) {
    throw invalidBrokerResponse();
  }
  return item as number;
}

function optionalRecordNumber(value: Record<string, unknown>, key: string) {
  if (value[key] === undefined) return undefined;
  return recordNumber(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

const secureStore: McpOAuthSecureStore = {
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

class InvalidMcpOAuthBrokerResponseError extends Error {
  constructor() {
    super("MCP OAuth broker 返回了无效数据。");
    this.name = "InvalidMcpOAuthBrokerResponseError";
  }
}

function invalidBrokerResponse() {
  return new InvalidMcpOAuthBrokerResponseError();
}
