import type {
  GoogleDocsApiPort,
  GoogleDocsRecoveryStore,
} from "@boltpocket/connector-google-docs";

import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";

export type GoogleDocsConnectionBundle = {
  connection: ConnectionItem;
  resources: WorkspaceResource[];
  /** Exact resource selected by an explicit user link in this operation. */
  focusedResourceId?: string;
};

export type GoogleDocsAuthorizedAccount = {
  id: string;
  label: string;
};

export type GoogleDocsAccessSession = {
  account: GoogleDocsAuthorizedAccount;
  accessToken: string;
};

export interface GoogleDocsConnectionCryptoPort {
  sha256(value: string): Promise<string>;
  randomUUID(): string;
}

export interface GoogleDocsAuthorizationPort {
  connect(force?: boolean): Promise<GoogleDocsAccessSession | null>;
  restore(): Promise<GoogleDocsAccessSession | null>;
  accessTokenFor(accountId: string): Promise<string>;
  clearAccessToken(accessToken: string): Promise<void>;
}

export interface GoogleDocsConnectionService
  extends GoogleDocsApiPort, GoogleDocsRecoveryStore {
  load(): Promise<GoogleDocsConnectionBundle[]>;
  connectAccount(
    project: Project,
    account: GoogleDocsAuthorizedAccount,
  ): Promise<GoogleDocsConnectionBundle>;
  connect(
    project: Project,
    documentUrl: string,
  ): Promise<GoogleDocsConnectionBundle | null>;
  refresh(resources: WorkspaceResource[]): Promise<WorkspaceResource[]>;
}
