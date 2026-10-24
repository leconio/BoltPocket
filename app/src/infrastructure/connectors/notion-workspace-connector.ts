import { ConnectorError } from "@boltpocket/connector-core";
import {
  NotionConnector,
  parseNotionPageId,
  type NotionApiPort,
  type NotionRecoveryStore,
} from "@boltpocket/connector-notion";

import type { WorkspaceResource } from "@/domain/models";

export type NotionWorkspaceBackend = NotionApiPort & NotionRecoveryStore;

export function createNotionWorkspaceConnector(input: {
  connectionId: string;
  resources: WorkspaceResource[];
  readOnly: boolean;
  backend: NotionWorkspaceBackend;
}) {
  if (input.resources.length === 0) {
    throw new ConnectorError("unsupported", "Notion 连接器至少需要一个页面。");
  }
  const notionResources = input.resources.map((resource) => {
    if (resource.storage.kind !== "notion-page") {
      throw new ConnectorError("unsupported", "一个连接不能混合不同资源类型。");
    }
    if (
      parseNotionPageId(resource.storage.locator) !== resource.storage.pageId
    ) {
      throw new ConnectorError("permission_denied", "Notion 页面绑定无效。");
    }
    return { resource, storage: resource.storage };
  });
  const accountIds = new Set(
    notionResources.map(({ storage }) => storage.accountId),
  );
  const accountLabels = new Set(
    notionResources.map(({ storage }) => storage.accountLabel),
  );
  if (accountIds.size !== 1 || accountLabels.size !== 1) {
    throw new ConnectorError(
      "permission_denied",
      "一个 Notion 连接不能混合工作区。",
    );
  }
  return new NotionConnector({
    id: input.connectionId,
    label: "Notion",
    accountId: notionResources[0]!.storage.accountId,
    accountLabel: notionResources[0]!.storage.accountLabel,
    resources: notionResources.map(({ resource, storage }) => ({
      id: resource.id,
      projectId: resource.projectId,
      pageId: storage.pageId,
      displayName: resource.path,
      locator: storage.locator,
      writable: storage.writable && !storage.trashed,
    })),
    api: input.backend,
    recovery: input.backend,
    readOnly:
      input.readOnly ||
      notionResources.every(
        ({ storage }) => !storage.writable || storage.trashed,
      ),
  });
}
