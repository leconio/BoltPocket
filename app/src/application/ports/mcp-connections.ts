export type McpConnectionAuthentication =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "vault-token";
      /** One credential for Bearer/query auth, or up to eight custom headers. */
      credentialIds: readonly string[];
      /** Kept separate from the endpoint so the secret never enters persisted URLs. */
      queryParameterName?: string;
    }>
  | Readonly<{ kind: "oauth"; authorizationId: string }>;

/** Stable cache/approval scope used by every app-global MCP service. */
export const GLOBAL_MCP_SCOPE_ID = "boltpocket-global-mcp";

export type McpConnection = Readonly<{
  id: string;
  /** MCP services are app-global. Kept as null for storage compatibility. */
  projectId: null;
  name: string;
  serverUrl: string;
  authentication: McpConnectionAuthentication;
  enabled: boolean;
  /** Omit to allow all remotely annotated read-only tools. */
  allowedToolNames?: readonly string[];
  /** Glob patterns that always pause for approval; writes always pause. */
  approveTools?: readonly string[];
  /** Whether this locally configured connection may use server read hints. */
  trustToolAnnotations: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type McpConnectionInput = Readonly<{
  /** MCP services are app-global. Callers must persist a null scope. */
  projectId: null;
  name: string;
  serverUrl: string;
  authentication: McpConnectionAuthentication;
  enabled: boolean;
  allowedToolNames?: readonly string[];
  approveTools?: readonly string[];
  trustToolAnnotations?: boolean;
}>;

export interface McpConnectionRepositoryPort {
  /** The optional legacy argument is ignored; MCP inventory is app-global. */
  list(legacyProjectId?: string): Promise<readonly McpConnection[]>;
  create(input: McpConnectionInput): Promise<McpConnection>;
  update(
    connectionId: string,
    input: McpConnectionInput,
  ): Promise<McpConnection>;
  remove(connectionId: string): Promise<void>;
}
