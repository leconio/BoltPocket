import { ConnectorError } from "@boltpocket/connector-core";
import {
  GoogleDocsConnector,
  type GoogleDocsApiPort,
  type GoogleDocsRecoveryStore,
} from "@boltpocket/connector-google-docs";

import type { WorkspaceResource } from "@/domain/models";

import { googleDocumentUrl } from "./google-docs-document";

export type GoogleDocsWorkspaceBackend = GoogleDocsApiPort &
  GoogleDocsRecoveryStore;

export function createGoogleDocsWorkspaceConnector(input: {
  connectionId: string;
  resources: WorkspaceResource[];
  readOnly: boolean;
  backend: GoogleDocsWorkspaceBackend;
  projectId?: string;
  accountId?: string;
  accountLabel?: string;
}) {
  if (
    input.resources.length === 0 &&
    (!input.projectId || !input.accountId || !input.accountLabel)
  ) {
    throw new ConnectorError(
      "unsupported",
      "An empty Google Docs connector needs a project and account binding.",
    );
  }
  const googleResources = input.resources.map((resource) => {
    if (resource.storage.kind !== "google-doc") {
      throw new ConnectorError(
        "unsupported",
        "One connector cannot mix different storage resource types.",
      );
    }
    if (
      resource.storage.locator !==
      googleDocumentUrl(resource.storage.documentId)
    ) {
      throw new ConnectorError(
        "permission_denied",
        "Google document binding is invalid.",
      );
    }
    return { resource, storage: resource.storage };
  });
  const accountIds = new Set(
    googleResources.map(({ storage }) => storage.accountId),
  );
  const accountLabels = new Set(
    googleResources.map(({ storage }) => storage.accountLabel),
  );
  if (
    accountIds.size > 1 ||
    accountLabels.size > 1 ||
    (input.accountId &&
      accountIds.size > 0 &&
      !accountIds.has(input.accountId)) ||
    (input.accountLabel &&
      accountLabels.size > 0 &&
      !accountLabels.has(input.accountLabel))
  ) {
    throw new ConnectorError(
      "permission_denied",
      "One Google Docs connector cannot mix Google accounts.",
    );
  }
  return new GoogleDocsConnector({
    id: input.connectionId,
    label: "Google 文档",
    accountId: input.accountId ?? googleResources[0]!.storage.accountId,
    accountLabel:
      input.accountLabel ?? googleResources[0]!.storage.accountLabel,
    projectIds: input.projectId ? [input.projectId] : undefined,
    resources: googleResources.map(({ resource, storage }) => ({
      id: resource.id,
      projectId: resource.projectId,
      documentId: storage.documentId,
      displayName: resource.path,
      locator: storage.locator,
      writable: storage.writable,
    })),
    api: input.backend,
    recovery: input.backend,
    readOnly:
      input.readOnly ||
      (googleResources.length > 0 &&
        googleResources.every(({ storage }) => !storage.writable)),
  });
}
