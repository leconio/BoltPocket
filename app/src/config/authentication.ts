import {
  activeDistributionRegion,
  distributionProfile,
  type DistributionRegion,
} from "./distribution";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]{8,128}$/u;

export type AuthenticationConfig = Readonly<{
  serverUrl: string;
  clientId: string;
  scope: string;
  redirectUri: string;
}>;

export function loadAuthenticationConfig(
  serverValue?: string,
  clientIdValue?: string,
  region: DistributionRegion = activeDistributionRegion(),
): AuthenticationConfig {
  const profile = distributionProfile(region);
  const serverUrl = (serverValue?.trim() || profile.authenticationUrl).replace(
    /\/+$/u,
    "",
  );
  const parsed = new URL(serverUrl);
  const development = typeof __DEV__ !== "undefined" && __DEV__;
  const localDevelopment =
    development &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  const originOnly =
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.username === "" &&
    parsed.password === "";
  if ((parsed.protocol !== "https:" && !localDevelopment) || !originOnly) {
    throw new Error("Authentication server must be an HTTPS origin.");
  }

  const clientId = clientIdValue?.trim() || profile.authenticationClientId;
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("Authentication client ID is invalid.");
  }

  return {
    serverUrl,
    clientId,
    scope: "openid profile email",
    redirectUri: "boltpocket://auth/callback",
  };
}
