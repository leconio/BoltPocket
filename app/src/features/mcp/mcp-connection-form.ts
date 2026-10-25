import type { McpConnection } from "@/application/ports/mcp-connections";

export type McpAuthenticationChoice = "none" | "token";
export type McpToolPolicyPreset = "ask-all" | "custom" | "standard";

const GENERIC_HOST_LABELS = new Set([
  "api",
  "mcp",
  "remote",
  "server",
  "services",
  "www",
]);

export function mcpAuthenticationChoice(
  connection: McpConnection | null,
): McpAuthenticationChoice {
  if (!connection) return "token";
  if (connection.authentication.kind === "vault-token") return "token";
  return "none";
}

export function mcpToolPolicyPreset(
  connection: McpConnection | null,
): McpToolPolicyPreset {
  if (!connection) return "standard";
  if (
    connection.approveTools?.includes("*") &&
    !connection.allowedToolNames?.length
  ) {
    return "ask-all";
  }
  if (
    connection.trustToolAnnotations &&
    !connection.approveTools?.length &&
    !connection.allowedToolNames?.length
  ) {
    return "standard";
  }
  return "custom";
}

export function suggestedMcpConnectionName(serverUrl: string) {
  try {
    const labels = new URL(serverUrl).hostname
      .toLowerCase()
      .split(".")
      .filter(Boolean);
    const meaningful = labels.find((label) => !GENERIC_HOST_LABELS.has(label));
    if (!meaningful) return "MCP";
    return meaningful
      .split(/[-_]/u)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "MCP";
  }
}
