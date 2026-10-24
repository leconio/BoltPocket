import type {
  SkillCapability,
  SkillUrlResolverPort,
} from "@/application/ports/capability-catalog";
import type { CapabilitySource } from "@/application/ports/capability-sources";
import type { DistributionRegion } from "@/config/distribution";
import { loadFirstPartyApiConfig } from "@/config/first-party-api";
import { CapabilityCatalogClient } from "./capability-catalog-client";
import { BOLTPOCKET_MARKET_SOURCE, SkillMarketClient } from "./skill-market-client";

const SKILLS_SH: CapabilitySource = Object.freeze({
  id: "skills-sh",
  kind: "skills-sh",
  name: "Skills.sh",
});

export function createAppCapabilityCatalog(
  region: DistributionRegion,
  fetchImplementation: typeof fetch = fetch,
): SkillUrlResolverPort {
  const resolver = new CapabilityCatalogClient(
    loadFirstPartyApiConfig(undefined, region),
    {
      fetch: fetchImplementation,
    },
  );
  const market = new SkillMarketClient(
    loadFirstPartyApiConfig(undefined, region),
    { fetch: fetchImplementation },
  );
  return {
    async resolveSkill(
      sourceId,
      entryId,
      region,
      signal,
    ): Promise<SkillCapability> {
      if (sourceId === BOLTPOCKET_MARKET_SOURCE.id) {
        return market.downloadSkill(entryId, region, signal);
      }
      if (sourceId === SKILLS_SH.id) {
        return resolver.resolveSkill(entryId, region, SKILLS_SH, signal);
      }
      throw new Error("This installed Skill does not support tracked updates.");
    },
  };
}
