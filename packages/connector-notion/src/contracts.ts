export type NotionPageSnapshot = {
  pageId: string;
  title: string;
  markdown: string;
  version: string;
  locator: string;
  writable: boolean;
  trashable: boolean;
  restorable: boolean;
  trashed: boolean;
};

export type NotionRecoverySnapshot = NotionPageSnapshot & {
  accountId: string;
};

export type NotionStoredRecoveryPoint = {
  storageRef: string;
  version: string;
};

export interface NotionApiPort {
  readPage(accountId: string, pageId: string): Promise<NotionPageSnapshot>;
  replacePage(input: {
    accountId: string;
    pageId: string;
    expectedVersion: string;
    markdown: string;
  }): Promise<NotionPageSnapshot>;
  createPage?(input: {
    accountId: string;
    title: string;
    markdown: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }): Promise<NotionPageSnapshot>;
  setPageTrashed?(input: {
    accountId: string;
    pageId: string;
    trashed: boolean;
  }): Promise<NotionPageSnapshot>;
}

export interface NotionRecoveryStore {
  createRecoveryPoint(
    snapshot: NotionRecoverySnapshot,
  ): Promise<NotionStoredRecoveryPoint>;
  createCreationRecoveryPoint?(input: {
    accountId: string;
    operationId: string;
    projectId: string;
    title: string;
  }): Promise<NotionStoredRecoveryPoint>;
}
