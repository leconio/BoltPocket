export type GoogleDocsDocumentSnapshot = {
  documentId: string;
  title: string;
  text: string;
  revisionId: string;
  writable: boolean;
  trashable?: boolean;
  restorable?: boolean;
  trashed?: boolean;
};

export type GoogleDocsRecoverySnapshot = GoogleDocsDocumentSnapshot & {
  accountId: string;
};

export type GoogleDocsStoredRecoveryPoint = {
  storageRef: string;
  version: string;
};

export interface GoogleDocsApiPort {
  readDocument(
    accountId: string,
    documentId: string,
  ): Promise<GoogleDocsDocumentSnapshot>;
  replaceDocument(input: {
    accountId: string;
    documentId: string;
    expectedRevisionId: string;
    text: string;
  }): Promise<GoogleDocsDocumentSnapshot>;
  createDocument?(input: {
    accountId: string;
    title: string;
    text: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }): Promise<GoogleDocsDocumentSnapshot>;
  setDocumentTrashed?(input: {
    accountId: string;
    documentId: string;
    trashed: boolean;
  }): Promise<GoogleDocsDocumentSnapshot>;
}

export interface GoogleDocsRecoveryStore {
  createRecoveryPoint(
    snapshot: GoogleDocsRecoverySnapshot,
  ): Promise<GoogleDocsStoredRecoveryPoint>;
  createCreationRecoveryPoint?(input: {
    accountId: string;
    operationId: string;
    projectId: string;
    title: string;
  }): Promise<GoogleDocsStoredRecoveryPoint>;
}
