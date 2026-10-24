export type CapabilitySourceKind =
  "boltpocket" | "skills-sh" | "mcp-registry" | "catalog-json";

export type CapabilitySource = Readonly<{
  id: string;
  kind: CapabilitySourceKind;
  name: string;
}>;
