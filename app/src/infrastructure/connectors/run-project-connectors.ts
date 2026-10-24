import { ConnectorRegistry } from "@boltpocket/connector-core";
import type {
  GoogleDocsApiPort,
  GoogleDocsRecoveryStore,
} from "@boltpocket/connector-google-docs";
import type {
  GoogleSheetsApiPort,
  GoogleSheetsRecoveryStore,
} from "@boltpocket/connector-google-sheets";
import type {
  GoogleSlidesApiPort,
  GoogleSlidesRecoveryStore,
} from "@boltpocket/connector-google-slides";
import type {
  NotionApiPort,
  NotionRecoveryStore,
} from "@boltpocket/connector-notion";

import type { AgentRunInput } from "@/application/ports/agent-runtime";
import { WorkspaceConnectorSession } from "@/infrastructure/connectors/workspace-connector-session";

export function createRunConnectorRegistry(
  input: AgentRunInput,
  googleDocs?: GoogleDocsApiPort & GoogleDocsRecoveryStore,
  googleSheets?: GoogleSheetsApiPort & GoogleSheetsRecoveryStore,
  googleSlides?: GoogleSlidesApiPort & GoogleSlidesRecoveryStore,
  notion?: NotionApiPort & NotionRecoveryStore,
) {
  if (!input.project) return new ConnectorRegistry();
  return new WorkspaceConnectorSession({
    project: input.project,
    resources: input.resources,
    connections: input.connections,
    // The Agent only stages edits in its in-memory project overlay. Exposing
    // writable capabilities here lets it choose edit/document_create; provider
    // writes remain reachable only through the host's hashed Diff workflow.
    readOnly: false,
    googleDocs,
    googleSheets,
    googleSlides,
    notion,
  }).registry;
}
