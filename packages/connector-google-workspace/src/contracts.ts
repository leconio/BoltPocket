import type { JsonValue } from "@boltpocket/connector-core";

export type GoogleWorkspaceTextSnapshot = {
  resourceId: string;
  title: string;
  text: string;
  version: string;
  writable: boolean;
  trashable?: boolean;
  restorable?: boolean;
  trashed?: boolean;
  metadata?: Record<string, JsonValue>;
};

export type GoogleWorkspaceRecoverySnapshot = GoogleWorkspaceTextSnapshot & {
  accountId: string;
};

export type GoogleWorkspaceStoredRecoveryPoint = {
  storageRef: string;
  version: string;
};

export interface GoogleWorkspaceTextApiPort {
  readResource(
    accountId: string,
    resourceId: string,
  ): Promise<GoogleWorkspaceTextSnapshot>;
  replaceResource(input: {
    accountId: string;
    resourceId: string;
    expectedVersion: string;
    text: string;
  }): Promise<GoogleWorkspaceTextSnapshot>;
  createResource?(input: {
    accountId: string;
    title: string;
    text: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }): Promise<GoogleWorkspaceTextSnapshot>;
  setResourceTrashed?(input: {
    accountId: string;
    resourceId: string;
    trashed: boolean;
  }): Promise<GoogleWorkspaceTextSnapshot>;
}

export interface GoogleWorkspaceRecoveryStore {
  createRecoveryPoint(
    snapshot: GoogleWorkspaceRecoverySnapshot,
  ): Promise<GoogleWorkspaceStoredRecoveryPoint>;
  createCreationRecoveryPoint?(input: {
    accountId: string;
    operationId: string;
    projectId: string;
    title: string;
  }): Promise<GoogleWorkspaceStoredRecoveryPoint>;
}
