import type { MessageKey } from "@/i18n/messages";
import {
  isAuthenticationError,
  type AuthenticationErrorCode,
} from "@/infrastructure/auth/casdoor-authentication";

const errorKeys: Readonly<Record<AuthenticationErrorCode, MessageKey>> = {
  account_mismatch: "auth.error.accountMismatch",
  authorization_failed: "auth.error.authorizationFailed",
  configuration: "auth.error.configuration",
  network: "auth.error.network",
  secure_storage: "auth.error.secureStorage",
  session_expired: "auth.error.sessionExpired",
  server: "auth.error.server",
};

export function authenticationErrorMessageKey(error: unknown): MessageKey {
  return errorKeys[isAuthenticationError(error) ? error.code : "server"];
}
