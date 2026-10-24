import type { McpToolApprovalRequest, McpToolRisk } from "@boltpocket/mcp-client";

export type PendingMcpToolApproval = Readonly<{
  argumentsPreview: string;
  patch: string;
  patchHash: string;
  request: McpToolApprovalRequest;
  requestId: string;
  requestedAt: string;
  risk: McpToolRisk;
}>;
