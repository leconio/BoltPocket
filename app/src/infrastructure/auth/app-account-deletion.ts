import type { AuthenticationPort } from "@/application/ports/authentication";
import type { DistributionRegion } from "@/config/distribution";
import { loadFirstPartyApiConfig } from "@/config/first-party-api";
import { AccountDeletionService } from "@/infrastructure/auth/account-deletion";

export function createAppAccountDeletion(options: {
  authentication: AuthenticationPort;
  fetch: typeof fetch;
  region: DistributionRegion;
}) {
  return new AccountDeletionService({
    authentication: options.authentication,
    baseUrl: loadFirstPartyApiConfig(undefined, options.region).baseUrl,
    fetch: options.fetch,
  });
}
