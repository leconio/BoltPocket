import type {
  NotionApiPort,
  NotionRecoveryStore,
} from "@boltpocket/connector-notion";

import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";

export type NotionConnectionBundle = {
  connection: ConnectionItem;
  resources: WorkspaceResource[];
  /** Exact resource selected by an explicit user link in this operation. */
  focusedResourceId?: string;
};

export interface NotionConnectionCryptoPort {
  sha256(value: string): Promise<string>;
  randomUUID(): string;
}

export interface NotionConnectionService
  extends NotionApiPort, NotionRecoveryStore {
  load(): Promise<NotionConnectionBundle[]>;
  connect(
    project: Project,
    pageUrl: string,
  ): Promise<NotionConnectionBundle | null>;
  refresh(resources: WorkspaceResource[]): Promise<WorkspaceResource[]>;
}
