import {
  AccountAuthenticationRequiredError,
  type AuthenticationAccessTokenPort,
} from "@/application/ports/authentication";
import type { DistributionRegion } from "@/config/compliance";
import { isAuthenticationError } from "@/infrastructure/auth/casdoor-authentication";

export const ACCOUNT_AUTHORIZATION_HEADER =
  "X-BoltPocket-Account-Authorization" as const;
export const DISTRIBUTION_REGION_HEADER =
  "X-BoltPocket-Distribution-Region" as const;

export function createFirstPartyAuthenticatedFetch(options: {
  allowedOrigins: readonly string[];
  authentication: AuthenticationAccessTokenPort;
  distributionRegion: DistributionRegion;
  fetch?: typeof fetch;
}): typeof fetch {
  const baseFetch = options.fetch ?? fetch;
  const allowedOrigins = new Set(options.allowedOrigins.map(exactHttpsOrigin));
  if (allowedOrigins.size === 0) {
    throw new Error("First-party authenticated fetch requires an origin.");
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!allowedOrigins.has(url.origin)) {
      throw new Error(
        "Refusing to attach a BoltPocket account token to a non-first-party origin.",
      );
    }
    let token: string;
    try {
      token = await options.authentication.accessToken();
    } catch (error) {
      if (isAuthenticationError(error, "session_expired")) {
        throw new AccountAuthenticationRequiredError({ cause: error });
      }
      throw error;
    }
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    if (init?.headers) {
      for (const [name, value] of new Headers(init.headers)) {
        headers.set(name, value);
      }
    }
    headers.set(ACCOUNT_AUTHORIZATION_HEADER, `Bearer ${token}`);
    headers.set(DISTRIBUTION_REGION_HEADER, options.distributionRegion);
    const response = await baseFetch(input, {
      ...init,
      credentials: "omit",
      headers,
    });
    if (boltpocketAccountChallenge(response)) {
      await response.body?.cancel().catch(() => undefined);
      throw new AccountAuthenticationRequiredError();
    }
    return response;
  }) as typeof fetch;
}

function boltpocketAccountChallenge(response: Response) {
  return (
    response.status === 401 &&
    /\bBearer\b[^\r\n]*\brealm="BoltPocket account"/iu.test(
      response.headers.get("www-authenticate") ?? "",
    )
  );
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  const localDevelopment =
    typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("First-party account origin must be an HTTPS origin.");
  }
  return url.origin;
}
