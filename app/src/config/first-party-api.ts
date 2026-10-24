import {
  activeDistributionRegion,
  distributionProfile,
  type DistributionRegion,
} from "./distribution";

export type FirstPartyApiConfig = Readonly<{ baseUrl: string }>;

export function loadFirstPartyApiConfig(
  value?: string,
  region: DistributionRegion = activeDistributionRegion(),
): FirstPartyApiConfig {
  const normalized = (
    value?.trim() || distributionProfile(region).firstPartyApiUrl
  ).replace(/\/+$/u, "");
  const url = new URL(normalized);
  const development = typeof __DEV__ !== "undefined" && __DEV__;
  const localDevelopment =
    development &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("BoltPocket第一方 API 地址必须是 HTTPS origin。");
  }
  return { baseUrl: url.origin };
}
