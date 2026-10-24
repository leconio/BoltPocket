import type {
  GoogleWorkspaceRecoveryStore,
  GoogleWorkspaceTextApiPort,
  GoogleWorkspaceTextSnapshot,
} from "@boltpocket/connector-google-workspace";

import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";

import type {
  GoogleDocsAuthorizedAccount,
  GoogleDocsAuthorizationPort,
  GoogleDocsConnectionCryptoPort,
} from "./google-docs-connections";

export type GoogleWorkspaceConnectionBundle = {
  connection: ConnectionItem;
  resources: WorkspaceResource[];
  /** Exact resource selected by an explicit user link in this operation. */
  focusedResourceId?: string;
};

export interface GoogleWorkspaceConnectionApi extends GoogleWorkspaceTextApiPort {
  resolveResource(
    accountId: string,
    value: string,
  ): Promise<GoogleWorkspaceTextSnapshot>;
}

export type GoogleWorkspaceConnectionKind = "sheets" | "slides";

export interface GoogleWorkspaceResourceConnectionService
  extends GoogleWorkspaceTextApiPort, GoogleWorkspaceRecoveryStore {
  load(): Promise<GoogleWorkspaceConnectionBundle[]>;
  connectAccount(
    project: Project,
    account: GoogleDocsAuthorizedAccount,
  ): Promise<GoogleWorkspaceConnectionBundle>;
  connect(
    project: Project,
    resourceUrl: string,
  ): Promise<GoogleWorkspaceConnectionBundle | null>;
  refresh(resources: WorkspaceResource[]): Promise<WorkspaceResource[]>;
}

export type GoogleWorkspaceConnectionDependencies = {
  authorization: GoogleDocsAuthorizationPort;
  crypto: GoogleDocsConnectionCryptoPort;
};
