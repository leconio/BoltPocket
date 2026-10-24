import type { AuthenticationAccessTokenPort } from "@/application/ports/authentication";
import type { DistributionRegion } from "@/config/distribution";
import { loadFirstPartyApiConfig } from "@/config/first-party-api";
import { loadOAuthBrokerConfig } from "@/config/oauth-broker";
import { createFirstPartyAuthenticatedFetch } from "@/infrastructure/auth/first-party-authenticated-fetch";

export function createAppFirstPartyAuthenticatedFetch(
  region: DistributionRegion,
  authentication: AuthenticationAccessTokenPort,
  fetchImplementation: typeof fetch = fetch,
) {
  return createFirstPartyAuthenticatedFetch({
    allowedOrigins: [
      loadFirstPartyApiConfig(undefined, region).baseUrl,
      loadOAuthBrokerConfig(undefined, region).baseUrl,
    ],
    authentication,
    distributionRegion: region,
    fetch: fetchImplementation,
  });
}
