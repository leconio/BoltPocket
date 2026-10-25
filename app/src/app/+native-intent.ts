import { redirectOAuthSystemPath } from "@/infrastructure/connectors/oauth-callback-routing";
import { redirectMiniAppSystemPath } from "@/infrastructure/capabilities/mini-app-link-routing";
import { redirectLocalBenchmarkSystemPath } from "@/infrastructure/navigation/local-benchmark-link-routing";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  const oauthPath = redirectOAuthSystemPath(path);
  return oauthPath === null
    ? null
    : redirectMiniAppSystemPath(redirectLocalBenchmarkSystemPath(oauthPath));
}
