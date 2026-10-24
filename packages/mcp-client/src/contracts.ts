import type {
  AuthProvider,
  FetchLike,
  OAuthClientProvider,
} from "@modelcontextprotocol/client";

export type McpToolAnnotations = Readonly<{
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}>;

export type McpRemoteTool = Readonly<{
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: McpToolAnnotations;
  /** Transport-private definition used for SDK validation and header mirroring. */
  definition?: unknown;
}>;

export type McpRemoteCallResult = Readonly<{
  content?: unknown;
  isError?: boolean;
  structuredContent?: unknown;
}>;

export type McpRemoteServerInfo = Readonly<{
  capabilities?: unknown;
  instructions?: string;
  protocolEra?: "legacy" | "modern";
  protocolVersion?: string;
  serverVersion?: unknown;
}>;

export interface McpRemoteClient {
  serverInfo(): McpRemoteServerInfo;
  setToolsChangedHandler(handler: () => void): void;
  listTools(options?: {
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<readonly McpRemoteTool[]>;
  callTool(
    tool: McpRemoteTool,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<McpRemoteCallResult>;
  ping(signal?: AbortSignal): Promise<unknown>;
  listPrompts(options?: {
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<unknown>;
  getPrompt(
    name: string,
    arguments_: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  listResources(options?: {
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<unknown>;
  listResourceTemplates(options?: {
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<unknown>;
  readResource(
    uri: string,
    options?: { refresh?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
  complete(
    ref: Readonly<
      | { type: "ref/prompt"; name: string }
      | { type: "ref/resource"; uri: string }
    >,
    argument: Readonly<{ name: string; value: string }>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export type McpToolRisk = "read" | "write" | "destructive" | "unknown";

export type McpToolApprovalRequest = Readonly<{
  approvalSessionId?: string;
  arguments: Readonly<Record<string, unknown>>;
  projectId: string;
  projectName?: string;
  risk: McpToolRisk;
  serverId: string;
  serverName: string;
  serverRevision: string;
  toolDescription?: string;
  /** Canonical schema/annotation revision, supplied only by the host proxy. */
  toolDefinitionRevision: string;
  toolName: string;
  toolTitle?: string;
}>;

export type McpToolApprovalDecision = Readonly<{
  approved: boolean;
  scope?: "once" | "session";
}>;

export interface McpToolApprovalPort {
  authorize(
    request: McpToolApprovalRequest,
    signal?: AbortSignal,
  ): Promise<McpToolApprovalDecision>;
}

export type McpExecutionContext = Readonly<{
  /** Host-owned identifier. It is never accepted from model arguments. */
  approvalSessionId?: string;
  projectName?: string;
}>;

export type McpServerRuntimeDefinition = Readonly<{
  id: string;
  name: string;
  url: string;
  /** Change this value whenever URL, auth, or policy configuration changes. */
  revision: string;
  authProvider?: AuthProvider | OAuthClientProvider;
  /** Host-owned interactive scope upgrade for broker-backed OAuth. */
  onInsufficientScope?: (requiredScope?: string) => Promise<void>;
  /** Dynamic non-bearer headers, resolved immediately before each request. */
  requestHeaders?: () => Promise<Readonly<Record<string, string>>>;
  /** Dynamic query credentials for providers whose official remote endpoint requires them. */
  requestQuery?: () => Promise<Readonly<Record<string, string>>>;
  fetch?: FetchLike;
  /** Optional authoritative local allow-list. */
  allowedToolNames?: readonly string[];
  /** Glob patterns that always require approval, in addition to all writes. */
  approveTools?: readonly string[];
  /** Local opt-in to use this server's annotations when classifying reads. */
  trustToolAnnotations?: boolean;
  /** Removes exact credentials from untrusted server errors or responses. */
  redact?: (value: string) => string;
}>;

export interface McpServerSource {
  listForProject(
    projectId: string,
  ): Promise<readonly McpServerRuntimeDefinition[]>;
}

export interface McpRemoteClientFactory {
  connect(
    server: McpServerRuntimeDefinition,
    signal?: AbortSignal,
  ): Promise<McpRemoteClient>;
}

export type McpProxyInput =
  | Readonly<{ action: "status" }>
  | Readonly<{
      action: "list";
      serverId?: string;
      limit?: number;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "search";
      query: string;
      serverId?: string;
      limit?: number;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "schema";
      serverId: string;
      toolName: string;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "call";
      serverId: string;
      toolName: string;
      arguments?: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{ action: "ping"; serverId: string }>
  | Readonly<{
      action: "prompts";
      serverId: string;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "get-prompt";
      serverId: string;
      promptName: string;
      arguments?: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      action: "resources";
      serverId: string;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "resource-templates";
      serverId: string;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "read-resource";
      serverId: string;
      uri: string;
      refresh?: boolean;
    }>
  | Readonly<{
      action: "complete";
      serverId: string;
      ref:
        | Readonly<{ type: "ref/prompt"; name: string }>
        | Readonly<{ type: "ref/resource"; uri: string }>;
      argument: Readonly<{ name: string; value: string }>;
    }>;

export type McpToolSummary = Readonly<{
  serverId: string;
  serverName: string;
  name: string;
  title?: string;
  description?: string;
  callable: boolean;
  callableReason?: "not-allowed";
  approvalRequired: boolean;
  risk: McpToolRisk;
}>;

export type McpProxyPort = Readonly<{
  execute(
    projectId: string,
    input: McpProxyInput,
    signal?: AbortSignal,
    context?: McpExecutionContext,
  ): Promise<unknown>;
}>;
