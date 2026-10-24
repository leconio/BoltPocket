import type {
  McpCatalogLocalizedText,
  McpCatalogRegion,
} from "@/infrastructure/mcp/mcp-catalog-client";
import type { CapabilitySourceKind } from "@/application/ports/capability-sources";

export type CapabilitySourceReference = Readonly<{
  entryId: string;
  id: string;
  kind: CapabilitySourceKind;
  name: string;
}>;

export type OpenSkillProvenance = Readonly<{
  archived: boolean;
  audit: "pass" | "warn" | "fail" | "unavailable";
  commitSha: string;
  compatibility: string | null;
  installs: number;
  kind: "skills-sh";
  license: string | null;
  repositoryUrl: string;
  sourceId: string;
  supportingFileCount: number;
}>;

export type CapabilityRequirement =
  | Readonly<{
      id: string;
      kind: "host-tool";
      label: McpCatalogLocalizedText;
      required: boolean;
    }>
  | Readonly<{
      id: string;
      kind: "mcp-server";
      label: McpCatalogLocalizedText;
      required: boolean;
      serverUrl: string;
    }>;

export type SkillBundleFile = Readonly<{
  byteLength: number;
  content: string;
  encoding: "utf8" | "base64";
  executable: boolean;
  mimeType: string;
  path: string;
  sha256: string;
}>;

export type SkillBundle = Readonly<{
  complete: true;
  files: readonly SkillBundleFile[];
  sha256: string;
  totalBytes: number;
}>;

export type SkillCapability = Readonly<{
  bundle: SkillBundle;
  description: McpCatalogLocalizedText;
  documentationUrl: string;
  id: string;
  kind: "skill";
  name: McpCatalogLocalizedText;
  provider: McpCatalogLocalizedText;
  requirements: readonly CapabilityRequirement[];
  revision: string;
  risk: "read" | "propose";
  sha256: string;
  skillDocument: string;
  provenance?: OpenSkillProvenance;
  source: CapabilitySourceReference;
}>;

export interface SkillUrlResolverPort {
  resolveSkill(
    sourceId: string,
    entryId: string,
    region: McpCatalogRegion,
    signal?: AbortSignal,
  ): Promise<SkillCapability>;
}
