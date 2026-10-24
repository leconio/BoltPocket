import {
  activeDistributionRegion,
  distributionProfile,
  type DistributionRegion,
} from "./distribution";

export type OAuthBrokerConfig = {
  baseUrl: string;
  returnUrl: string;
};

export function loadOAuthBrokerConfig(
  value?: string,
  region: DistributionRegion = activeDistributionRegion(),
): OAuthBrokerConfig {
  const baseUrl = (
    value?.trim() || distributionProfile(region).oauthBrokerUrl
  ).replace(/\/+$/u, "");
  const parsed = new URL(baseUrl);
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
    throw new Error("OAuth Broker 地址必须是 HTTPS origin。");
  }
  return { baseUrl, returnUrl: "boltpocket://oauth/complete" };
}
