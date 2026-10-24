export type AuthenticatedAdminRole = "viewer" | "reviewer" | "admin";

export type AuthenticatedProfile = Readonly<{
  subject: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  /** A display-only projection of the first-party Casdoor admin role. */
  adminRole: AuthenticatedAdminRole | null;
}>;

export interface AuthenticationPort {
  restore(): Promise<AuthenticatedProfile | null>;
  signIn(): Promise<AuthenticatedProfile | null>;
  refreshProfile(): Promise<AuthenticatedProfile>;
  signOut(): Promise<void>;
  completeAccountDeletion(): Promise<void>;
}

/** Internal first-party request credential; never expose this token to Agent context. */
export interface AuthenticationAccessTokenPort {
  accessToken(): Promise<string>;
}

/**
 * A first-party endpoint rejected the current BoltPocket account session. UI flows
 * may recover by opening the account sign-in page once and retrying the exact
 * operation; background flows must surface the error without guessing.
 */
export class AccountAuthenticationRequiredError extends Error {
  constructor(options?: ErrorOptions) {
    super("account_authentication_required", options);
    this.name = "AccountAuthenticationRequiredError";
  }
}

export function isAccountAuthenticationRequiredError(
  error: unknown,
): error is AccountAuthenticationRequiredError {
  return error instanceof AccountAuthenticationRequiredError;
}
