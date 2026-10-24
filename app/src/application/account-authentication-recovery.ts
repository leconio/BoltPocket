import type { AuthenticatedProfile } from "@/application/ports/authentication";
import { isAccountAuthenticationRequiredError } from "@/application/ports/authentication";

type Dependencies<Result> = Readonly<{
  operation(): Promise<Result>;
  signIn(): Promise<AuthenticatedProfile | null>;
}>;

export class AccountAuthenticationRejectedAfterSignInError extends Error {
  constructor(options?: ErrorOptions) {
    super("account_authentication_rejected_after_sign_in", options);
    this.name = "AccountAuthenticationRejectedAfterSignInError";
  }
}

export function isAccountAuthenticationRejectedAfterSignInError(
  error: unknown,
): error is AccountAuthenticationRejectedAfterSignInError {
  return error instanceof AccountAuthenticationRejectedAfterSignInError;
}

/** Opens account sign-in at most once, then retries the exact rejected operation. */
export async function runWithAccountAuthenticationRecovery<Result>({
  operation,
  signIn,
}: Dependencies<Result>): Promise<Result | null> {
  try {
    return await operation();
  } catch (error) {
    if (!isAccountAuthenticationRequiredError(error)) throw error;
  }

  const profile = await signIn();
  if (!profile) return null;
  try {
    return await operation();
  } catch (error) {
    if (isAccountAuthenticationRequiredError(error)) {
      throw new AccountAuthenticationRejectedAfterSignInError({
        cause: error,
      });
    }
    throw error;
  }
}
