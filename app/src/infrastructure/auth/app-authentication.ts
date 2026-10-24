import { loadAuthenticationConfig } from "@/config/authentication";
import { LOCAL_INFERENCE } from "@/config/local-inference";

class LocalAuthentication {
  onSessionExpired(_listener: () => void) { return () => undefined; }
  async restore() { return null; }
  async signIn() { return null; }
  async refreshProfile(): Promise<never> { throw new Error("此本地版本未启用账号服务。"); }
  async accessToken(): Promise<never> { throw new Error("此本地版本未启用账号服务。"); }
  async signOut() {}
  async completeAccountDeletion() {}
}
import type { DistributionRegion } from "@/config/distribution";
import { CasdoorAuthenticationService } from "@/infrastructure/auth/casdoor-authentication";
import { ExpoAuthenticationSessionStore } from "@/infrastructure/auth/expo-authentication-session-store";

export function createAppAuthentication(
  region: DistributionRegion,
  fetchImplementation: typeof fetch = fetch,
) {
  if (LOCAL_INFERENCE) return new LocalAuthentication();
  return new CasdoorAuthenticationService(
    loadAuthenticationConfig(undefined, undefined, region),
    new ExpoAuthenticationSessionStore(region),
    { fetch: fetchImplementation },
  );
}
