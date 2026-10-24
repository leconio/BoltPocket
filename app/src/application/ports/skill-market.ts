import type { SkillCapability } from "@/application/ports/capability-catalog";
import type {
  McpCatalogLocalizedText,
  McpCatalogRegion,
} from "@/infrastructure/mcp/mcp-catalog-client";

export type SkillMarketCategory =
  | "engineering"
  | "operations"
  | "privacy"
  | "productivity"
  | "research"
  | "writing";

export type SkillMarketLicense = "Apache-2.0" | "CC0-1.0" | "MIT";

export type SkillMarketSummary = Readonly<{
  ageRating: "16+";
  category: SkillMarketCategory;
  contentDescriptors: readonly ["user-generated-content", "agent-automation"];
  description: McpCatalogLocalizedText;
  featured: boolean;
  id: string;
  license: SkillMarketLicense;
  name: McpCatalogLocalizedText;
  provider: McpCatalogLocalizedText;
  publisherId: string;
  publishedAt: number;
  revision: string;
  risk: "read" | "propose";
  sha256: string;
  tags: readonly string[];
  universalLink: string;
  verified: boolean;
}>;

export type SkillMarketExecutionStatus = Readonly<{
  allowed: boolean;
  reason: "active" | "not_found" | "revoked" | "version_mismatch";
}>;

export type SkillMarketCatalog = Readonly<{
  catalogVersion: string;
  entries: readonly SkillMarketSummary[];
  region: McpCatalogRegion;
}>;

export type SkillMarketDetail = Readonly<{
  readmeDocument: string;
  summary: SkillMarketSummary;
}>;

export interface SkillMarketPort {
  loadCatalog(
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketCatalog>;
  loadDetail(
    entryId: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketDetail>;
  downloadSkill(
    entryId: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillCapability>;
  checkExecution(
    entryId: string,
    revision: string,
    sha256: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillMarketExecutionStatus>;
}
