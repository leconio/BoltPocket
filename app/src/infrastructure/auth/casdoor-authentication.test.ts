import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticationConfig } from "@/config/authentication";
import {
  AuthenticationError,
  CasdoorAuthenticationService,
  type AuthenticationSessionStore,
  type StoredAuthenticationSession,
} from "./casdoor-authentication.ts";
import type {
  CasdoorAuthorizationClient,
  CasdoorAuthorizationProof,
} from "./expo-casdoor-authorization.ts";

const config: AuthenticationConfig = {
  serverUrl: "https://auth.example.com",
  clientId: "mobile-client_1",
  scope: "openid profile email",
  redirectUri: "boltpocket://auth/callback",
};

const proof: CasdoorAuthorizationProof = {
  state: "s".repeat(43),
  codeVerifier: "v".repeat(43),
  codeChallenge: "c".repeat(43),
};

test("hosted sign-in uses authorization code PKCE and stores the Casdoor profile", async () => {
  const store = new MemorySessionStore();
  const requests: { url: string; init?: RequestInit }[] = [];
  const authorization = new MemoryAuthorizationClient((url, redirectUri) => {
    assert.equal(redirectUri, config.redirectUri);
    const authorizeUrl = new URL(url);
    assert.equal(authorizeUrl.origin, config.serverUrl);
    assert.equal(authorizeUrl.pathname, "/login/oauth/authorize");
    assert.deepEqual(Object.fromEntries(authorizeUrl.searchParams), {
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      scope: config.scope,
      state: proof.state,
      code_challenge_method: "S256",
      code_challenge: proof.codeChallenge,
    });
    return `${config.redirectUri}?code=authorization-code-1&state=${proof.state}`;
  });
  const service = new CasdoorAuthenticationService(config, store, {
    authorization,
    now: () => 1_000,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/api/login/oauth/access_token")) {
        return jsonResponse({
          access_token: "access-token-value-12345",
          refresh_token: "refresh-token-value-12345",
          expires_in: 3_600,
        });
      }
      return jsonResponse({
        sub: "subject-1",
        iss: config.serverUrl,
        aud: config.clientId,
        preferred_username: "alice@example.com",
        name: "Alice",
        picture: "/avatar/alice.png",
        email: "alice@example.com",
        roles: ["boltpocket-admin-reviewer"],
      });
    },
  });

  const profile = await service.signIn();

  assert.deepEqual(profile, {
    subject: "subject-1",
    username: "alice@example.com",
    displayName: "Alice",
    avatarUrl: "https://auth.example.com/avatar/alice.png",
    email: "alice@example.com",
    adminRole: "reviewer",
  });
  assert.equal(store.boundSubject, "subject-1");
  assert.equal(store.session?.accessExpiresAt, 3_601_000);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: "authorization-code-1",
    redirect_uri: config.redirectUri,
    code_verifier: proof.codeVerifier,
  });
  assert.doesNotMatch(String(requests[0]?.init?.body), /client_secret/u);
  assert.equal(
    (requests[1]?.init?.headers as Record<string, string>).Authorization,
    "Bearer access-token-value-12345",
  );
});

test("closing the hosted account page cancels without changing local state", async () => {
  const store = new MemorySessionStore();
  let requestCount = 0;
  const service = new CasdoorAuthenticationService(config, store, {
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () => {
      requestCount += 1;
      return jsonResponse({});
    },
  });

  assert.equal(await service.signIn(), null);
  assert.equal(requestCount, 0);
  assert.equal(store.session, null);
});

test("OAuth access denial is treated as a user cancellation", async () => {
  const service = new CasdoorAuthenticationService(
    config,
    new MemorySessionStore(),
    {
      authorization: new MemoryAuthorizationClient(
        () => `${config.redirectUri}?error=access_denied&state=${proof.state}`,
      ),
      fetch: async () => {
        throw new Error("token endpoint must not be called");
      },
    },
  );

  assert.equal(await service.signIn(), null);
});

test("a mismatched state or redirect URI is rejected before token exchange", async () => {
  for (const callback of [
    `${config.redirectUri}?code=code-1&state=${"x".repeat(43)}`,
    `boltpocket://unexpected/callback?code=code-1&state=${proof.state}`,
  ]) {
    const service = new CasdoorAuthenticationService(
      config,
      new MemorySessionStore(),
      {
        authorization: new MemoryAuthorizationClient(() => callback),
        fetch: async () => {
          throw new Error("token endpoint must not be called");
        },
      },
    );

    await assert.rejects(
      service.signIn(),
      (error: unknown) =>
        error instanceof AuthenticationError &&
        error.code === "authorization_failed",
    );
  }
});

test("an authorization code can only be exchanged with a valid proof", async () => {
  const invalidAuthorization: CasdoorAuthorizationClient = {
    async createProof() {
      return { ...proof, codeVerifier: "too-short" };
    },
    async open() {
      throw new Error("browser must not open");
    },
  };
  const service = new CasdoorAuthenticationService(
    config,
    new MemorySessionStore(),
    { authorization: invalidAuthorization },
  );

  await assert.rejects(
    service.signIn(),
    (error: unknown) =>
      error instanceof AuthenticationError &&
      error.code === "authorization_failed",
  );
});

test("restore rotates an expired access token before loading profile", async () => {
  const store = new MemorySessionStore({
    version: 1,
    accessToken: "old-access-token-value",
    refreshToken: "old-refresh-token-value",
    accessExpiresAt: 2_000,
    profile: {
      subject: "subject-1",
      username: "alice@example.com",
      displayName: "Old Alice",
      avatarUrl: null,
      email: "alice@example.com",
      adminRole: null,
    },
  });
  const bodies: unknown[] = [];
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async (url, init) => {
      if (url.endsWith("/api/login/oauth/access_token")) {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return jsonResponse({
          access_token: "new-access-token-value",
          refresh_token: "",
          expires_in: 7_200,
        });
      }
      return jsonResponse({
        sub: "subject-1",
        iss: config.serverUrl,
        aud: config.clientId,
        preferred_username: "alice@example.com",
        name: "Alice Updated",
        picture: "https://cdn.example.com/alice.png",
        email: "alice@example.com",
      });
    },
  });

  assert.equal((await service.restore())?.displayName, "Alice Updated");
  assert.deepEqual(bodies, [
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      scope: config.scope,
      refresh_token: "old-refresh-token-value",
    },
  ]);
  assert.equal(store.session?.accessToken, "new-access-token-value");
  assert.equal(store.session?.refreshToken, "old-refresh-token-value");
});

test("first-party requests reuse or refresh the secure Casdoor access token", async () => {
  const store = new MemorySessionStore({
    version: 1,
    accessToken: "old-access-token-value",
    refreshToken: "old-refresh-token-value",
    accessExpiresAt: 2_000,
    profile: {
      subject: "subject-1",
      username: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
      email: "alice@example.com",
      adminRole: null,
    },
  });
  let refreshes = 0;
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () => {
      refreshes += 1;
      return jsonResponse({
        access_token: "new-access-token-value",
        refresh_token: "new-refresh-token-value",
        expires_in: 7_200,
      });
    },
  });

  assert.equal(await service.accessToken(), "new-access-token-value");
  assert.equal(await service.accessToken(), "new-access-token-value");
  assert.equal(refreshes, 1);
  assert.equal(store.session?.refreshToken, "new-refresh-token-value");
});

test("concurrent first-party requests share one refresh-token rotation", async () => {
  const store = new MemorySessionStore(expiredSession());
  const refreshStarted = deferred<void>();
  const releaseRefresh = deferred<void>();
  let refreshes = 0;
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () => {
      refreshes += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return jsonResponse({
        access_token: "rotated-access-token-value",
        refresh_token: "rotated-refresh-token-value",
        expires_in: 7_200,
      });
    },
  });

  const first = service.accessToken();
  await refreshStarted.promise;
  const second = service.accessToken();
  releaseRefresh.resolve();

  assert.deepEqual(await Promise.all([first, second]), [
    "rotated-access-token-value",
    "rotated-access-token-value",
  ]);
  assert.equal(refreshes, 1);
  assert.equal(store.session?.refreshToken, "rotated-refresh-token-value");
});

test("an expired refresh grant clears the stale profile state exactly once", async () => {
  const store = new MemorySessionStore(expiredSession());
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "expired" },
        400,
      ),
  });
  let expirations = 0;
  const unsubscribe = service.onSessionExpired(() => {
    expirations += 1;
  });

  await assert.rejects(
    service.accessToken(),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === "session_expired",
  );
  unsubscribe();

  assert.equal(store.session, null);
  assert.equal(expirations, 1);
});

test("signing out cannot be undone by an in-flight token refresh", async () => {
  const store = new MemorySessionStore(expiredSession());
  const refreshStarted = deferred<void>();
  const releaseRefresh = deferred<void>();
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async (url) => {
      if (url.endsWith("/api/sso-logout?logoutAll=false")) {
        return jsonResponse({ status: "ok" });
      }
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return jsonResponse({
        access_token: "late-access-token-value",
        refresh_token: "late-refresh-token-value",
        expires_in: 7_200,
      });
    },
  });

  const refreshing = service.accessToken();
  await refreshStarted.promise;
  await service.signOut();
  releaseRefresh.resolve();

  await assert.rejects(
    refreshing,
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === "session_expired",
  );
  assert.equal(store.session, null);
});

test("restore clears a session when the refresh grant expires", async () => {
  const store = new MemorySessionStore({
    version: 1,
    accessToken: "old-access-token-value",
    refreshToken: "old-refresh-token-value",
    accessExpiresAt: 2_000,
    profile: {
      subject: "subject-1",
      username: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
      email: "alice@example.com",
      adminRole: null,
    },
  });
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 100_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "expired" },
        400,
      ),
  });

  assert.equal(await service.restore(), null);
  assert.equal(store.session, null);
});

test("restore uses the encrypted cached profile during a network outage", async () => {
  const cached = {
    subject: "subject-1",
    username: "alice@example.com",
    displayName: "Alice",
    avatarUrl: null,
    email: "alice@example.com",
    adminRole: null,
  } as const;
  const store = new MemorySessionStore({
    version: 1,
    accessToken: "cached-access-token-value",
    refreshToken: "cached-refresh-token-value",
    accessExpiresAt: 3_700_000,
    profile: cached,
  });
  const service = new CasdoorAuthenticationService(config, store, {
    now: () => 1_000,
    authorization: new MemoryAuthorizationClient(() => null),
    fetch: async () => {
      throw new Error("offline");
    },
  });

  assert.deepEqual(await service.restore(), cached);
});

test("confirmed account deletion clears only the local session without another network request", async () => {
  const store = new MemorySessionStore({
    version: 1,
    accessToken: "account-access-token-value",
    refreshToken: "account-refresh-token-value",
    accessExpiresAt: 3_700_000,
    profile: {
      subject: "subject-1",
      username: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
      email: "alice@example.com",
      adminRole: null,
    },
  });
  let requests = 0;
  const service = new CasdoorAuthenticationService(config, store, {
    fetch: async () => {
      requests += 1;
      throw new Error("must not make another identity request");
    },
  });

  await service.completeAccountDeletion();

  assert.equal(store.session, null);
  assert.equal(requests, 0);
});

test("a different account cannot inherit the device's existing local data", async () => {
  const store = new MemorySessionStore();
  store.boundSubject = "subject-previous";
  const service = new CasdoorAuthenticationService(config, store, {
    authorization: new MemoryAuthorizationClient(
      () => `${config.redirectUri}?code=code-1&state=${proof.state}`,
    ),
    fetch: async (url) =>
      url.endsWith("/api/login/oauth/access_token")
        ? jsonResponse({
            access_token: "access-token-value-12345",
            refresh_token: "refresh-token-value-12345",
            expires_in: 3_600,
          })
        : jsonResponse({
            sub: "subject-new",
            iss: config.serverUrl,
            aud: config.clientId,
            preferred_username: "bob@example.com",
            name: "Bob",
            email: "bob@example.com",
          }),
  });

  await assert.rejects(
    service.signIn(),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === "account_mismatch",
  );
  assert.equal(store.session, null);
});

class MemoryAuthorizationClient implements CasdoorAuthorizationClient {
  readonly #callback: (
    authorizeUrl: string,
    redirectUri: string,
  ) => string | null;

  constructor(
    callback: (authorizeUrl: string, redirectUri: string) => string | null,
  ) {
    this.#callback = callback;
  }

  async createProof() {
    return proof;
  }

  async open(authorizeUrl: string, redirectUri: string) {
    return this.#callback(authorizeUrl, redirectUri);
  }
}

function expiredSession(): StoredAuthenticationSession {
  return {
    version: 1,
    accessToken: "old-access-token-value",
    refreshToken: "old-refresh-token-value",
    accessExpiresAt: 2_000,
    profile: {
      subject: "subject-1",
      username: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
      email: "alice@example.com",
      adminRole: null,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class MemorySessionStore implements AuthenticationSessionStore {
  session: StoredAuthenticationSession | null;
  boundSubject: string | null = null;

  constructor(session: StoredAuthenticationSession | null = null) {
    this.session = session;
  }

  async load() {
    return this.session;
  }

  async save(session: StoredAuthenticationSession) {
    this.session = session;
  }

  async clear() {
    this.session = null;
  }

  async assertSubjectAllowed(subject: string) {
    if (this.boundSubject && this.boundSubject !== subject) {
      throw new AuthenticationError("account_mismatch");
    }
    this.boundSubject = subject;
  }
}

function jsonResponse(
  value: unknown,
  status = 200,
): Pick<Response, "ok" | "status" | "headers" | "text"> {
  const body = JSON.stringify(value);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-length": String(body.length) }),
    text: async () => body,
  };
}
