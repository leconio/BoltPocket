import { ConnectorError } from "@boltpocket/connector-core";
import {
  GoogleSlidesConnector,
  googlePresentationUrl,
  type GoogleSlidesApiPort,
  type GoogleSlidesRecoveryStore,
} from "@boltpocket/connector-google-slides";

import type { WorkspaceResource } from "@/domain/models";

export type GoogleSlidesWorkspaceBackend = GoogleSlidesApiPort &
  GoogleSlidesRecoveryStore;

export function createGoogleSlidesWorkspaceConnector(input: {
  connectionId: string;
  resources: WorkspaceResource[];
  readOnly: boolean;
  backend: GoogleSlidesWorkspaceBackend;
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
      "空的 Google 幻灯片连接器需要项目和账号绑定。",
    );
  }
  const googleResources = input.resources.map((resource) => {
    if (resource.storage.kind !== "google-slide") {
      throw new ConnectorError("unsupported", "一个连接不能混合不同资源类型。");
    }
    if (
      resource.storage.locator !==
      googlePresentationUrl(resource.storage.presentationId)
    ) {
      throw new ConnectorError("permission_denied", "Google 幻灯片绑定无效。");
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
      "一个 Google 幻灯片连接不能混合 Google 账号。",
    );
  }
  return new GoogleSlidesConnector({
    id: input.connectionId,
    label: "Google 幻灯片",
    accountId: input.accountId ?? googleResources[0]!.storage.accountId,
    accountLabel:
      input.accountLabel ?? googleResources[0]!.storage.accountLabel,
    projectIds: input.projectId ? [input.projectId] : undefined,
    resources: googleResources.map(({ resource, storage }) => ({
      id: resource.id,
      projectId: resource.projectId,
      presentationId: storage.presentationId,
      displayName: resource.path,
      locator: storage.locator,
      writable: storage.writable && !storage.trashed,
    })),
    api: input.backend,
    recovery: input.backend,
    readOnly:
      input.readOnly ||
      (googleResources.length > 0 &&
        googleResources.every(
          ({ storage }) => !storage.writable || storage.trashed,
        )),
  });
}
