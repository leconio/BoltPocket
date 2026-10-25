import { ConnectorRegistry } from "@boltpocket/connector-core";
import type { AgentRunInput } from "@/application/ports/agent-runtime";
import { WorkspaceConnectorSession } from "./workspace-connector-session";

export function createRunConnectorRegistry(input: AgentRunInput) {
  if (!input.project) return new ConnectorRegistry();
  return new WorkspaceConnectorSession({
    project: input.project,
    resources: input.resources,
    connections: input.connections,
    readOnly: false,
  }).registry;
}
