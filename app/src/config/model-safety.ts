import {
  activeDistributionRegion,
  distributionProfile,
  type DistributionRegion,
} from "./distribution";
import {
  loadFirstPartyApiConfig,
  type FirstPartyApiConfig,
} from "./first-party-api";

export function loadModelSafetyConfig(
  value?: string,
  region: DistributionRegion = activeDistributionRegion(),
): FirstPartyApiConfig {
  return loadFirstPartyApiConfig(
    value?.trim() || distributionProfile(region).modelSafetyUrl,
    region,
  );
}
