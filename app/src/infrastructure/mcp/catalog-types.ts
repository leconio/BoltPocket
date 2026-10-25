export type McpCatalogRegion = "china-mainland" | "global";
export type McpCatalogSupport = "available" | "phase-one";
export type McpCatalogLocalizedText = Readonly<{ en: string; zhCN: string }>;

export type McpCatalogAuthentication =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "oauth" }>
  | Readonly<{
      credentialLabel: McpCatalogLocalizedText;
      kind: "token";
      parameterName?: string;
      placement: "bearer" | "header" | "query";
    }>;

export type McpCatalogEntry = Readonly<{
  configuration: Readonly<{
    authentication: McpCatalogAuthentication;
    serverUrl: string;
  }>;
  description: McpCatalogLocalizedText;
  documentationUrl: string;
  id: string;
  name: McpCatalogLocalizedText;
  provider: McpCatalogLocalizedText;
  support: McpCatalogSupport;
}>;

export type McpCatalog = Readonly<{
  catalogVersion: string;
  region: McpCatalogRegion;
  services: readonly McpCatalogEntry[];
}>;
