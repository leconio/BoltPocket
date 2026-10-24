import { runWithAccountAuthenticationRecovery } from "@/application/account-authentication-recovery";
import type { AuthenticatedProfile } from "@/application/ports/authentication";
import type { McpOAuthAuthorization } from "@/application/ports/mcp-connections";

type Dependencies = Readonly<{
  authorize(): Promise<McpOAuthAuthorization | null>;
  signIn(): Promise<AuthenticatedProfile | null>;
}>;

/**
 * Recovers one MCP OAuth attempt when the application account session was rejected.
 * Cancellation stays on the caller's current page; a second rejection is
 * surfaced instead of creating an authorization loop.
 */
export async function authorizeMcpOAuthWithAccountRecovery({
  authorize,
  signIn,
}: Dependencies): Promise<McpOAuthAuthorization | null> {
  return runWithAccountAuthenticationRecovery({
    operation: authorize,
    signIn,
  });
}
