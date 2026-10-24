import type {
  AuthenticationAccessTokenPort,
  AuthenticatedAdminRole,
  AuthenticatedProfile,
  AuthenticationPort,
} from "@/application/ports/authentication";
import type { AuthenticationConfig } from "@/config/authentication";
import {
  type CasdoorAuthorizationProof,
  type CasdoorAuthorizationClient,
  ExpoCasdoorAuthorizationClient,
} from "@/infrastructure/auth/expo-casdoor-authorization";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 16 * 1024;
const MAX_CALLBACK_LENGTH = 8 * 1024;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;
const PKCE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;

export type AuthenticationErrorCode =
  | "account_mismatch"
  | "authorization_failed"
  | "configuration"
  | "network"
  | "secure_storage"
  | "session_expired"
  | "server";

export class AuthenticationError extends Error {
  readonly code: AuthenticationErrorCode;

  constructor(code: AuthenticationErrorCode) {
    super(code);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

export type StoredAuthenticationSession = Readonly<{
  version: 1;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  profile: AuthenticatedProfile;
}>;

export interface AuthenticationSessionStore {
  load(): Promise<StoredAuthenticationSession | null>;
  save(session: StoredAuthenticationSession): Promise<void>;
  clear(): Promise<void>;
  assertSubjectAllowed(subject: string): Promise<void>;
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "text">>;

type TokenResponse = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}>;

export class CasdoorAuthenticationService
  implements AuthenticationPort, AuthenticationAccessTokenPort
{
  readonly #config: AuthenticationConfig;
  readonly #store: AuthenticationSessionStore;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #authorization: CasdoorAuthorizationClient;
  readonly #sessionExpiredListeners = new Set<() => void>();
  #refreshingSession: Promise<StoredAuthenticationSession> | null = null;
  #sessionMutation = 0;

  constructor(
    config: AuthenticationConfig,
    store: AuthenticationSessionStore,
    options: Readonly<{
      fetch?: FetchLike;
      now?: () => number;
      authorization?: CasdoorAuthorizationClient;
    }> = {},
  ) {
    this.#config = config;
    this.#store = store;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#authorization =
      options.authorization ?? new ExpoCasdoorAuthorizationClient();
  }

  onSessionExpired(listener: () => void): () => void {
    this.#sessionExpiredListeners.add(listener);
    return () => this.#sessionExpiredListeners.delete(listener);
  }

  async restore(): Promise<AuthenticatedProfile | null> {
    let session: StoredAuthenticationSession | null;
    try {
      session = await this.#store.load();
    } catch {
      throw new AuthenticationError("secure_storage");
    }
    if (!session) return null;

    const sessionMutation = this.#sessionMutation;
    try {
      const active = await this.#activeSession(session);
      const profile = await this.#loadProfile(active.accessToken);
      await this.#store.save({ ...active, profile });
      return profile;
    } catch (error) {
      if (isAuthenticationError(error, "network")) return session.profile;
      if (isAuthenticationError(error, "session_expired")) {
        await this.#expireSession(sessionMutation, false);
        return null;
      }
      throw error;
    }
  }

  async signIn(): Promise<AuthenticatedProfile | null> {
    let proof: CasdoorAuthorizationProof;
    let callbackUrl: string | null;
    try {
      proof = await this.#authorization.createProof();
      validateProof(proof);
      callbackUrl = await this.#authorization.open(
        authorizationUrl(this.#config, proof),
        this.#config.redirectUri,
      );
    } catch (error) {
      if (isAuthenticationError(error)) throw error;
      throw new AuthenticationError("authorization_failed");
    }
    if (!callbackUrl) return null;

    const code = authorizationCode(
      callbackUrl,
      this.#config.redirectUri,
      proof.state,
    );
    if (!code) return null;

    const token = await this.#requestToken(
      {
        grant_type: "authorization_code",
        client_id: this.#config.clientId,
        code,
        redirect_uri: this.#config.redirectUri,
        code_verifier: proof.codeVerifier,
      },
      "authorization_failed",
    );
    const profile = await this.#loadProfile(token.accessToken);

    try {
      await this.#store.assertSubjectAllowed(profile.subject);
    } catch (error) {
      await this.#revoke(token.accessToken);
      if (isAuthenticationError(error, "account_mismatch")) throw error;
      throw new AuthenticationError("secure_storage");
    }

    const session: StoredAuthenticationSession = {
      version: 1,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessExpiresAt: this.#now() + token.expiresIn * 1_000,
      profile,
    };
    try {
      this.#sessionMutation += 1;
      await this.#store.save(session);
    } catch {
      await this.#revoke(token.accessToken);
      throw new AuthenticationError("secure_storage");
    }
    return profile;
  }

  async refreshProfile(): Promise<AuthenticatedProfile> {
    let session: StoredAuthenticationSession | null;
    try {
      session = await this.#store.load();
    } catch {
      throw new AuthenticationError("secure_storage");
    }
    if (!session) throw new AuthenticationError("session_expired");

    const sessionMutation = this.#sessionMutation;
    try {
      const active = await this.#activeSession(session);
      const profile = await this.#loadProfile(active.accessToken);
      await this.#store.save({ ...active, profile });
      return profile;
    } catch (error) {
      if (isAuthenticationError(error, "session_expired")) {
        await this.#expireSession(sessionMutation, true);
      }
      if (isAuthenticationError(error)) throw error;
      throw new AuthenticationError("secure_storage");
    }
  }

  async accessToken(): Promise<string> {
    let session: StoredAuthenticationSession | null;
    try {
      session = await this.#store.load();
    } catch {
      throw new AuthenticationError("secure_storage");
    }
    if (!session) throw new AuthenticationError("session_expired");
    const sessionMutation = this.#sessionMutation;
    try {
      return (await this.#activeSession(session)).accessToken;
    } catch (error) {
      if (isAuthenticationError(error, "session_expired")) {
        await this.#expireSession(sessionMutation, true);
      }
      throw error;
    }
  }

  async signOut(): Promise<void> {
    this.#sessionMutation += 1;
    let session: StoredAuthenticationSession | null = null;
    try {
      session = await this.#store.load();
    } catch {
      // Local session removal below still takes precedence.
    }
    if (session) await this.#revoke(session.accessToken);
    try {
      await this.#store.clear();
    } catch {
      throw new AuthenticationError("secure_storage");
    }
  }

  async completeAccountDeletion(): Promise<void> {
    this.#sessionMutation += 1;
    try {
      await this.#store.clear();
    } catch {
      throw new AuthenticationError("secure_storage");
    }
  }

  async #activeSession(
    session: StoredAuthenticationSession,
  ): Promise<StoredAuthenticationSession> {
    if (
      session.accessExpiresAt >
      this.#now() + ACCESS_TOKEN_REFRESH_WINDOW_MS
    ) {
      return session;
    }
    if (!session.refreshToken) {
      throw new AuthenticationError("session_expired");
    }

    if (this.#refreshingSession) return this.#refreshingSession;
    const sessionMutation = this.#sessionMutation;
    const refreshing = this.#refreshSession(session, sessionMutation);
    this.#refreshingSession = refreshing;
    try {
      return await refreshing;
    } finally {
      if (this.#refreshingSession === refreshing) {
        this.#refreshingSession = null;
      }
    }
  }

  async #refreshSession(
    session: StoredAuthenticationSession,
    sessionMutation: number,
  ): Promise<StoredAuthenticationSession> {
    const token = await this.#requestToken(
      {
        grant_type: "refresh_token",
        client_id: this.#config.clientId,
        scope: this.#config.scope,
        refresh_token: session.refreshToken,
      },
      "session_expired",
    );
    const updated: StoredAuthenticationSession = {
      ...session,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || session.refreshToken,
      accessExpiresAt: this.#now() + token.expiresIn * 1_000,
    };
    if (this.#sessionMutation !== sessionMutation) {
      let current: StoredAuthenticationSession | null;
      try {
        current = await this.#store.load();
      } catch {
        throw new AuthenticationError("secure_storage");
      }
      if (
        current &&
        current.accessExpiresAt > this.#now() + ACCESS_TOKEN_REFRESH_WINDOW_MS
      ) {
        return current;
      }
      throw new AuthenticationError("session_expired");
    }
    try {
      await this.#store.save(updated);
    } catch {
      throw new AuthenticationError("secure_storage");
    }
    return updated;
  }

  async #expireSession(sessionMutation: number, notify: boolean) {
    if (this.#sessionMutation !== sessionMutation) return;
    this.#sessionMutation += 1;
    await this.#store.clear().catch(() => undefined);
    if (notify) {
      for (const listener of this.#sessionExpiredListeners) {
        try {
          listener();
        } catch {
          // One UI subscriber must not mask the authentication failure.
        }
      }
    }
  }

  async #requestToken(
    body: Readonly<Record<string, string>>,
    invalidGrantCode: AuthenticationErrorCode,
  ) {
    const response = await this.#request(
      `${this.#config.serverUrl}/api/login/oauth/access_token`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const payload = await readJson(response);
    if (!response.ok || tokenError(payload)) {
      if (isRecord(payload) && payload.error === "invalid_grant") {
        throw new AuthenticationError(invalidGrantCode);
      }
      if (isRecord(payload) && payload.error === "invalid_client") {
        throw new AuthenticationError("configuration");
      }
      throw new AuthenticationError(
        response.status >= 500 ? "server" : "configuration",
      );
    }
    return parseToken(payload);
  }

  async #loadProfile(accessToken: string) {
    const response = await this.#request(
      `${this.#config.serverUrl}/api/userinfo`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError("session_expired");
    }
    if (!response.ok) {
      throw new AuthenticationError(
        response.status >= 500 ? "server" : "configuration",
      );
    }
    return parseProfile(
      await readJson(response),
      this.#config.serverUrl,
      this.#config.clientId,
    );
  }

  async #revoke(accessToken: string) {
    try {
      await this.#request(
        `${this.#config.serverUrl}/api/sso-logout?logoutAll=false`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
    } catch {
      // Signing out locally must not be blocked by an unavailable server.
    }
  }

  async #request(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new AuthenticationError("network");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function authorizationUrl(
  config: AuthenticationConfig,
  proof: Readonly<{
    state: string;
    codeChallenge: string;
  }>,
) {
  const url = new URL("/login/oauth/authorize", config.serverUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", proof.state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", proof.codeChallenge);
  return url.toString();
}

function validateProof(
  proof: Readonly<{
    state: string;
    codeVerifier: string;
    codeChallenge: string;
  }>,
) {
  if (
    !PKCE_VALUE_PATTERN.test(proof.state) ||
    !PKCE_VALUE_PATTERN.test(proof.codeVerifier) ||
    !PKCE_CHALLENGE_PATTERN.test(proof.codeChallenge)
  ) {
    throw new AuthenticationError("authorization_failed");
  }
}

function authorizationCode(
  value: string,
  redirectUri: string,
  expectedState: string,
) {
  if (value.length < 1 || value.length > MAX_CALLBACK_LENGTH) {
    throw new AuthenticationError("authorization_failed");
  }
  let callback: URL;
  let expected: URL;
  try {
    callback = new URL(value);
    expected = new URL(redirectUri);
  } catch {
    throw new AuthenticationError("authorization_failed");
  }
  if (
    callback.protocol !== expected.protocol ||
    callback.hostname !== expected.hostname ||
    callback.port !== expected.port ||
    callback.pathname !== expected.pathname ||
    callback.username !== "" ||
    callback.password !== "" ||
    callback.hash !== ""
  ) {
    throw new AuthenticationError("authorization_failed");
  }
  const states = callback.searchParams.getAll("state");
  if (states.length !== 1 || states[0] !== expectedState) {
    throw new AuthenticationError("authorization_failed");
  }
  const errors = callback.searchParams.getAll("error");
  if (errors.length > 1) {
    throw new AuthenticationError("authorization_failed");
  }
  if (errors[0] === "access_denied") return null;
  if (errors.length === 1) {
    throw new AuthenticationError("authorization_failed");
  }
  const codes = callback.searchParams.getAll("code");
  if (codes.length !== 1 || codes[0]!.length < 1 || codes[0]!.length > 4_096) {
    throw new AuthenticationError("authorization_failed");
  }
  return codes[0]!;
}

function parseToken(value: unknown): TokenResponse {
  if (!isRecord(value)) throw new AuthenticationError("server");
  const accessToken = boundedToken(value.access_token);
  const refreshToken = boundedToken(value.refresh_token, true);
  const expiresIn = value.expires_in;
  if (
    !accessToken ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 60 ||
    expiresIn > 90 * 24 * 60 * 60
  ) {
    throw new AuthenticationError("server");
  }
  return { accessToken, refreshToken, expiresIn };
}

function parseProfile(
  value: unknown,
  serverUrl: string,
  clientId: string,
): AuthenticatedProfile {
  if (!isRecord(value)) throw new AuthenticationError("server");
  const subject = boundedString(value.sub, 1, 200);
  const username = boundedString(value.preferred_username, 1, 255);
  const displayName = boundedString(value.name, 1, 255);
  const issuer = boundedString(value.iss, 8, 2_048);
  const audience = boundedString(value.aud, 1, 128);
  if (!subject || !username || issuer !== serverUrl || audience !== clientId) {
    throw new AuthenticationError("server");
  }
  return {
    subject,
    username,
    displayName: displayName ?? username,
    avatarUrl: avatarUrl(value.picture, serverUrl),
    email: boundedString(value.email, 3, 320),
    adminRole: casdoorAdminRole(value.roles),
  };
}

function casdoorAdminRole(value: unknown): AuthenticatedAdminRole | null {
  if (!Array.isArray(value)) return null;
  if (value.some((role) => role === "boltpocket-admin-admin")) return "admin";
  if (value.some((role) => role === "boltpocket-admin-reviewer")) {
    return "reviewer";
  }
  if (value.some((role) => role === "boltpocket-admin-viewer")) return "viewer";
  return null;
}

async function readJson(
  response: Pick<Response, "headers" | "text">,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new AuthenticationError("server");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AuthenticationError("server");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthenticationError("server");
  }
}

function boundedToken(value: unknown, optional = false) {
  if (optional && (value === "" || value === undefined)) return "";
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > MAX_TOKEN_LENGTH
  ) {
    return "";
  }
  return value;
}

function boundedString(value: unknown, minimum: number, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    return null;
  }
  return value;
}

function avatarUrl(value: unknown, serverUrl: string) {
  const candidate = boundedString(value, 1, 2_048);
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate, serverUrl);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "https:" && parsed.origin !== serverUrl) ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  return parsed.toString();
}

function tokenError(value: unknown) {
  return (
    isRecord(value) && typeof value.error === "string" && value.error !== ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAuthenticationError(
  error: unknown,
  code?: AuthenticationErrorCode,
): error is AuthenticationError {
  return (
    error instanceof AuthenticationError &&
    (code === undefined || error.code === code)
  );
}
