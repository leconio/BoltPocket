import type { AuthenticationPort } from "@/application/ports/authentication";
import {
  AuthenticationError,
  isAuthenticationError,
} from "@/infrastructure/auth/casdoor-authentication";

export class AccountDeletionService {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #authentication: Pick<AuthenticationPort, "completeAccountDeletion">;

  constructor(options: {
    authentication: Pick<AuthenticationPort, "completeAccountDeletion">;
    baseUrl: string;
    fetch: typeof fetch;
  }) {
    this.#authentication = options.authentication;
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch;
  }

  async deleteAccount(): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/account`, {
        headers: { Accept: "application/json" },
        method: "DELETE",
      });
    } catch (error) {
      if (isAuthenticationError(error)) throw error;
      throw new AuthenticationError("network");
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError("session_expired");
    }
    if (response.status !== 204) {
      throw new AuthenticationError(
        response.status >= 500 ? "server" : "configuration",
      );
    }
    await this.#authentication.completeAccountDeletion();
  }
}
