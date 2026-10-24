import {
  OPENAI_CODEX_AUTH_BASE_URL,
  OPENAI_CODEX_DEVICE_VERIFICATION_URL,
} from "./codex-provider-constants.ts";

const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_CODE_LIFETIME_MS = 15 * 60 * 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1_024;
const MAX_TOKEN_LENGTH = 64 * 1_024;
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;

export type CodexCredentialStore = Readonly<{
  deleteItem(key: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}>;

type CodexOAuthCredential = Readonly<{
  schema: 1;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  accountId: string;
  email: string | null;
  plan: string | null;
}>;

export type CodexAuthorizationSummary = Readonly<{
  accountId: string;
  email: string | null;
  plan: string | null;
  expiresAt: number;
}>;

export type CodexAuthorization = CodexAuthorizationSummary &
  Readonly<{ accessToken: string }>;

export type CodexDeviceCodeInfo = Readonly<{
  userCode: string;
  verificationUri: typeof OPENAI_CODEX_DEVICE_VERIFICATION_URL;
  expiresAt: number;
  intervalMs: number;
}>;

export type CodexDeviceOAuthErrorCode =
  | "account-changed"
  | "cancelled"
  | "expired"
  | "invalid-response"
  | "network"
  | "not-authorized"
  | "not-enabled"
  | "reauthorize"
  | "secure-storage";

export class CodexDeviceOAuthError extends Error {
  readonly code: CodexDeviceOAuthErrorCode;

  constructor(code: CodexDeviceOAuthErrorCode, cause?: unknown) {
    super(`Codex device authorization failed: ${code}`, { cause });
    this.name = "CodexDeviceOAuthError";
    this.code = code;
  }
}

export type CodexDeviceOAuthOptions = Readonly<{
  authBaseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  secureStore: CodexCredentialStore;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

type DeviceCode = Readonly<{
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
}>;

type DeviceTokenCode = Readonly<{
  authorizationCode: string;
  codeVerifier: string;
}>;

type JwtClaims = Readonly<{
  accountId: string | null;
  email: string | null;
  expiresAt: number | null;
  plan: string | null;
}>;

export class CodexDeviceOAuth {
  readonly #authBaseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #secureStore: CodexCredentialStore;
  readonly #sleep: NonNullable<CodexDeviceOAuthOptions["sleep"]>;
  readonly #epochs = new Map<string, number>();
  readonly #refreshes = new Map<string, Promise<CodexOAuthCredential>>();

  constructor(options: CodexDeviceOAuthOptions) {
    this.#authBaseUrl = normalizedAuthBaseUrl(
      options.authBaseUrl ?? OPENAI_CODEX_AUTH_BASE_URL,
    );
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1_000 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new Error("Invalid Codex OAuth request timeout.");
    }
    this.#secureStore = options.secureStore;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  async status(providerId: string): Promise<CodexAuthorizationSummary | null> {
    const credential = await this.#load(providerId);
    return credential ? summary(credential) : null;
  }

  async login(
    providerId: string,
    onDeviceCode: (information: CodexDeviceCodeInfo) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<CodexAuthorizationSummary> {
    const id = validatedProviderId(providerId);
    const epoch = this.#advanceEpoch(id);
    assertNotAborted(signal);
    const deviceCode = await this.#requestDeviceCode(signal);
    const expiresAt = this.#now() + DEVICE_CODE_LIFETIME_MS;
    await onDeviceCode({
      userCode: deviceCode.userCode,
      verificationUri: OPENAI_CODEX_DEVICE_VERIFICATION_URL,
      expiresAt,
      intervalMs: deviceCode.intervalMs,
    });
    const code = await this.#pollDeviceCode(deviceCode, expiresAt, signal);
    const credential = await this.#exchangeDeviceCode(code, signal);
    this.#assertCurrentEpoch(id, epoch);
    await this.#save(id, credential);
    return summary(credential);
  }

  async authorization(
    providerId: string,
    options: Readonly<{ forceRefresh?: boolean }> = {},
  ): Promise<CodexAuthorization> {
    const credential = await this.#load(providerId);
    if (!credential) throw new CodexDeviceOAuthError("not-authorized");
    const current =
      options.forceRefresh ||
      credential.expiresAt <= this.#now() + REFRESH_WINDOW_MS
        ? await this.#refreshSingleFlight(providerId, credential)
        : credential;
    return { ...summary(current), accessToken: current.accessToken };
  }

  authorizedFetch(providerId: string): typeof fetch {
    return async (input, init) => {
      assertCodexRequestUrl(input);
      const replay = replayableInput(input, init);
      const initial = await this.authorization(providerId);
      const response = await this.#fetch(replay.first, {
        ...init,
        credentials: "omit",
        headers: authorizationHeaders(input, init, initial),
      });
      if (response.status !== 401 || !replay.second) return response;
      await response.body?.cancel().catch(() => undefined);
      const refreshed = await this.authorization(providerId, {
        forceRefresh: true,
      });
      return this.#fetch(replay.second, {
        ...init,
        credentials: "omit",
        headers: authorizationHeaders(input, init, refreshed),
      });
    };
  }

  async logout(providerId: string): Promise<void> {
    const id = validatedProviderId(providerId);
    this.#advanceEpoch(id);
    const credential = await this.#load(id);
    try {
      await this.#secureStore.deleteItem(credentialStorageKey(id));
    } catch (error) {
      throw new CodexDeviceOAuthError("secure-storage", error);
    }
    if (credential) await this.#revokeBestEffort(credential);
  }

  async #requestDeviceCode(signal?: AbortSignal): Promise<DeviceCode> {
    const response = await this.#request(
      `${this.#authBaseUrl}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
        credentials: "omit",
      },
      signal,
    );
    if (response.status === 404) {
      throw new CodexDeviceOAuthError("not-enabled");
    }
    if (!response.ok) throw new CodexDeviceOAuthError("network");
    const value = await responseRecord(response);
    const intervalSeconds = numericInterval(value.interval);
    return {
      deviceAuthId: boundedText(value.device_auth_id, 4_096),
      userCode: boundedText(value.user_code ?? value.usercode, 128),
      intervalMs: intervalSeconds * 1_000,
    };
  }

  async #pollDeviceCode(
    device: DeviceCode,
    expiresAt: number,
    signal?: AbortSignal,
  ): Promise<DeviceTokenCode> {
    let intervalMs = device.intervalMs;
    while (this.#now() < expiresAt) {
      assertNotAborted(signal);
      const response = await this.#request(
        `${this.#authBaseUrl}/api/accounts/deviceauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_auth_id: device.deviceAuthId,
            user_code: device.userCode,
          }),
          credentials: "omit",
        },
        signal,
      );
      if (response.ok) {
        const value = await responseRecord(response);
        return {
          authorizationCode: boundedText(value.authorization_code, 8_192),
          codeVerifier: boundedText(value.code_verifier, 8_192),
        };
      }
      if (response.status !== 403 && response.status !== 404) {
        const errorCode = await responseErrorCode(response);
        if (errorCode === "slow_down") intervalMs += 5_000;
        else if (errorCode !== "deviceauth_authorization_pending") {
          throw new CodexDeviceOAuthError("network");
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      await this.#sleep(
        Math.min(intervalMs, Math.max(0, expiresAt - this.#now())),
        signal,
      );
    }
    throw new CodexDeviceOAuthError("expired");
  }

  async #exchangeDeviceCode(
    code: DeviceTokenCode,
    signal?: AbortSignal,
  ): Promise<CodexOAuthCredential> {
    const response = await this.#request(
      `${this.#authBaseUrl}/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CODEX_OAUTH_CLIENT_ID,
          code: code.authorizationCode,
          code_verifier: code.codeVerifier,
          redirect_uri: `${this.#authBaseUrl}/deviceauth/callback`,
        }).toString(),
        credentials: "omit",
      },
      signal,
    );
    if (!response.ok) throw new CodexDeviceOAuthError("reauthorize");
    return credentialFromTokenResponse(
      await responseRecord(response),
      this.#now(),
    );
  }

  #refreshSingleFlight(
    providerId: string,
    expected: CodexOAuthCredential,
  ): Promise<CodexOAuthCredential> {
    const id = validatedProviderId(providerId);
    const pending = this.#refreshes.get(id);
    if (pending) return pending;
    const epoch = this.#currentEpoch(id);
    const operation = this.#refresh(id, expected, epoch).finally(() => {
      if (this.#refreshes.get(id) === operation) this.#refreshes.delete(id);
    });
    this.#refreshes.set(id, operation);
    return operation;
  }

  async #refresh(
    providerId: string,
    expected: CodexOAuthCredential,
    epoch: number,
  ): Promise<CodexOAuthCredential> {
    const latest = await this.#load(providerId);
    if (!latest) throw new CodexDeviceOAuthError("not-authorized");
    if (
      latest.refreshToken !== expected.refreshToken &&
      latest.expiresAt > this.#now() + REFRESH_WINDOW_MS
    ) {
      return latest;
    }
    const response = await this.#request(`${this.#authBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: latest.refreshToken,
      }),
      credentials: "omit",
    });
    if (!response.ok) throw new CodexDeviceOAuthError("reauthorize");
    const refreshed = credentialFromTokenResponse(
      await responseRecord(response),
      this.#now(),
      latest,
    );
    if (refreshed.accountId !== latest.accountId) {
      throw new CodexDeviceOAuthError("account-changed");
    }
    this.#assertCurrentEpoch(providerId, epoch);
    await this.#save(providerId, refreshed);
    return refreshed;
  }

  async #revokeBestEffort(credential: CodexOAuthCredential) {
    try {
      await this.#request(`${this.#authBaseUrl}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: credential.refreshToken,
          token_type_hint: "refresh_token",
          client_id: CODEX_OAUTH_CLIENT_ID,
        }),
        credentials: "omit",
      });
    } catch {
      // Official Codex logout also treats revocation as best effort. Local
      // deletion below remains authoritative for this device.
    }
  }

  async #request(
    input: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    assertNotAborted(signal);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      this.#requestTimeoutMs,
    );
    try {
      return await this.#fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (signal?.aborted) throw new CodexDeviceOAuthError("cancelled", error);
      throw new CodexDeviceOAuthError("network", error);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async #load(providerId: string): Promise<CodexOAuthCredential | null> {
    let value: string | null;
    try {
      value = await this.#secureStore.getItem(credentialStorageKey(providerId));
    } catch (error) {
      throw new CodexDeviceOAuthError("secure-storage", error);
    }
    if (!value) return null;
    try {
      return decodeStoredCredential(value);
    } catch (error) {
      throw new CodexDeviceOAuthError("secure-storage", error);
    }
  }

  async #save(providerId: string, credential: CodexOAuthCredential) {
    try {
      await this.#secureStore.setItem(
        credentialStorageKey(providerId),
        JSON.stringify(credential),
      );
    } catch (error) {
      throw new CodexDeviceOAuthError("secure-storage", error);
    }
  }

  #currentEpoch(providerId: string) {
    return this.#epochs.get(providerId) ?? 0;
  }

  #advanceEpoch(providerId: string) {
    const next = this.#currentEpoch(providerId) + 1;
    this.#epochs.set(providerId, next);
    return next;
  }

  #assertCurrentEpoch(providerId: string, expected: number) {
    if (this.#currentEpoch(providerId) !== expected) {
      throw new CodexDeviceOAuthError("cancelled");
    }
  }
}

function summary(credential: CodexOAuthCredential): CodexAuthorizationSummary {
  return {
    accountId: credential.accountId,
    email: credential.email,
    plan: credential.plan,
    expiresAt: credential.expiresAt,
  };
}

function credentialFromTokenResponse(
  value: Record<string, unknown>,
  now: number,
  previous?: CodexOAuthCredential,
): CodexOAuthCredential {
  const accessToken = optionalBoundedText(value.access_token, MAX_TOKEN_LENGTH);
  const refreshToken = optionalBoundedText(
    value.refresh_token,
    MAX_TOKEN_LENGTH,
  );
  const idToken = optionalBoundedText(value.id_token, MAX_TOKEN_LENGTH);
  if (!previous && (!accessToken || !refreshToken || !idToken)) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  const nextAccessToken = accessToken ?? previous?.accessToken;
  const nextRefreshToken = refreshToken ?? previous?.refreshToken;
  const nextIdToken = idToken ?? previous?.idToken;
  if (!nextAccessToken || !nextRefreshToken || !nextIdToken) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  const accessClaims = decodeJwtClaims(nextAccessToken);
  const idClaims = decodeJwtClaims(nextIdToken);
  const responseExpiresIn = numericExpiresIn(value.expires_in);
  const expiresAt =
    accessClaims.expiresAt ??
    (responseExpiresIn === null ? null : now + responseExpiresIn * 1_000);
  const accountId =
    accessClaims.accountId ?? idClaims.accountId ?? previous?.accountId;
  if (!accountId || expiresAt === null || expiresAt <= now) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  return {
    schema: 1,
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
    idToken: nextIdToken,
    expiresAt,
    accountId: boundedText(accountId, 512),
    email: idClaims.email ?? previous?.email ?? null,
    plan: idClaims.plan ?? previous?.plan ?? null,
  };
}

function decodeStoredCredential(value: string): CodexOAuthCredential {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.schema !== 1) throw new Error("schema");
  const accessToken = boundedText(parsed.accessToken, MAX_TOKEN_LENGTH);
  const credential: CodexOAuthCredential = {
    schema: 1,
    accessToken,
    refreshToken: boundedText(parsed.refreshToken, MAX_TOKEN_LENGTH),
    idToken: boundedText(parsed.idToken, MAX_TOKEN_LENGTH),
    expiresAt: safeTimestamp(parsed.expiresAt),
    accountId: boundedText(parsed.accountId, 512),
    email: nullableText(parsed.email, 1_024),
    plan: nullableText(parsed.plan, 128),
  };
  const tokenAccountId = decodeJwtClaims(accessToken).accountId;
  if (tokenAccountId && tokenAccountId !== credential.accountId) {
    throw new Error("account");
  }
  return credential;
}

function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  try {
    const encoded = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isRecord(value)) throw new Error("claims");
    const auth = isRecord(value[JWT_AUTH_CLAIM]) ? value[JWT_AUTH_CLAIM] : null;
    const profile = isRecord(value["https://api.openai.com/profile"])
      ? value["https://api.openai.com/profile"]
      : null;
    return {
      accountId: nullableText(auth?.chatgpt_account_id, 512),
      email:
        nullableText(value.email, 1_024) ?? nullableText(profile?.email, 1_024),
      expiresAt:
        typeof value.exp === "number" && Number.isSafeInteger(value.exp)
          ? value.exp * 1_000
          : null,
      plan: nullableText(auth?.chatgpt_plan_type, 128),
    };
  } catch (error) {
    if (error instanceof CodexDeviceOAuthError) throw error;
    throw new CodexDeviceOAuthError("invalid-response", error);
  }
}

function authorizationHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  authorization: CodexAuthorization,
) {
  const requestHeaders =
    init?.headers ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.headers
      : undefined);
  const headers = new Headers(requestHeaders);
  headers.set("Authorization", `Bearer ${authorization.accessToken}`);
  headers.set("chatgpt-account-id", authorization.accountId);
  return headers;
}

function replayableInput(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return { first: input.clone(), second: input.clone() };
    } catch {
      return { first: input, second: null };
    }
  }
  const replayableBody =
    !init?.body ||
    typeof init.body === "string" ||
    init.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(init.body) ||
    init.body instanceof URLSearchParams;
  return { first: input, second: replayableBody ? input : null };
}

function assertCodexRequestUrl(input: RequestInfo | URL) {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new CodexDeviceOAuthError("invalid-response", error);
  }
  if (
    url.origin !== "https://chatgpt.com" ||
    url.pathname !== "/backend-api/codex/responses" ||
    url.username ||
    url.password
  ) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
}

async function responseRecord(response: Response) {
  const text = await boundedResponseText(response);
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) throw new Error("record");
    return value;
  } catch (error) {
    throw new CodexDeviceOAuthError("invalid-response", error);
  }
}

async function responseErrorCode(response: Response) {
  try {
    const value = JSON.parse(await boundedResponseText(response)) as unknown;
    if (!isRecord(value)) return null;
    if (typeof value.error === "string") return value.error;
    if (isRecord(value.error) && typeof value.error.code === "string") {
      return value.error.code;
    }
    return typeof value.code === "string" ? value.code : null;
  } catch {
    return null;
  }
}

async function boundedResponseText(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUTH_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new CodexDeviceOAuthError("invalid-response");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AUTH_RESPONSE_BYTES) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  return text;
}

function numericInterval(value: unknown) {
  const interval =
    typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval < 0 ||
    interval > 60
  ) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  return Math.max(1, Math.ceil(interval));
}

function numericExpiresIn(value: unknown) {
  if (value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 31 * 24 * 60 * 60
  ) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  return Math.floor(value);
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("text");
  }
  const normalized = value.trim();
  return normalized || null;
}

function optionalBoundedText(value: unknown, maximum: number) {
  if (value === undefined || value === null) return null;
  return boundedText(value, maximum);
}

function boundedText(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CodexDeviceOAuthError("invalid-response");
  }
  return value.trim();
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("timestamp");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatedProviderId(providerId: string) {
  if (!PROVIDER_ID.test(providerId)) {
    throw new CodexDeviceOAuthError("secure-storage");
  }
  return providerId;
}

function credentialStorageKey(providerId: string) {
  return `boltpocket.model.codex-oauth.v1.${validatedProviderId(providerId)}`;
}

function normalizedAuthBaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid Codex OAuth issuer.");
  }
  return url.toString().replace(/\/$/u, "");
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CodexDeviceOAuthError("cancelled");
}

function abortableSleep(milliseconds: number, signal?: AbortSignal) {
  assertNotAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(new CodexDeviceOAuthError("cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
