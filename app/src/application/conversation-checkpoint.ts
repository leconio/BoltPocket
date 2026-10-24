import type {
  ChangeProposal,
  ChangeReceipt,
  ConversationCheckpoint,
  WorkspaceResource,
} from "../domain/models.ts";
import { createTextDiffLines } from "../domain/text-diff.ts";
import {
  InvalidProposalError,
  ProposalConflictError,
  type ResourceConflict,
} from "./change-workflow.ts";
import { PROJECT_WORKSPACE_ABSENT_VERSION } from "../domain/project-workspace.ts";
import { translateMessage } from "../i18n/messages.ts";
import type { AppLocale } from "../i18n/translate.ts";

function cloneResource(resource: WorkspaceResource): WorkspaceResource {
  return {
    ...resource,
    storage:
      resource.storage.kind === "project-workspace" && resource.storage.binary
        ? {
            ...resource.storage,
            binary: {
              ...resource.storage.binary,
              source: { ...resource.storage.binary.source },
            },
          }
        : { ...resource.storage },
  };
}

export function advanceConversationCheckpoint(input: {
  checkpoint?: ConversationCheckpoint;
  checkpointId: string;
  conversationId: string;
  projectId: string;
  createdAt: string;
  receipt: ChangeReceipt;
  beforeResources: Record<string, WorkspaceResource>;
  afterResources: Record<string, WorkspaceResource>;
}): ConversationCheckpoint {
  const {
    checkpoint,
    checkpointId,
    conversationId,
    projectId,
    createdAt,
    receipt,
    beforeResources,
    afterResources,
  } = input;
  if (
    receipt.conversationId !== conversationId ||
    (checkpoint &&
      (checkpoint.conversationId !== conversationId ||
        checkpoint.projectId !== projectId))
  ) {
    throw new InvalidProposalError("对话还原点与当前项目不匹配。");
  }

  const baselineResources = { ...(checkpoint?.baselineResources ?? {}) };
  const latestResources = { ...(checkpoint?.latestResources ?? {}) };
  const createdResourceIds = new Set(checkpoint?.createdResourceIds ?? []);
  const deletedResourceIds = new Set(checkpoint?.deletedResourceIds ?? []);
  for (const change of receipt.changes) {
    const before = beforeResources[change.resourceId];
    const after = afterResources[change.resourceId];
    if (change.operation === "create") {
      if (
        before ||
        change.before !== "" ||
        change.beforeVersion !== PROJECT_WORKSPACE_ABSENT_VERSION ||
        !after ||
        after.version !== change.afterVersion ||
        after.content !== change.after
      ) {
        throw new InvalidProposalError("新增文件结果无法绑定到对话还原点。");
      }
      if (deletedResourceIds.delete(change.resourceId)) {
        if (!baselineResources[change.resourceId]) {
          throw new InvalidProposalError("还原的已删除文件缺少基线内容。");
        }
      } else {
        createdResourceIds.add(change.resourceId);
      }
      latestResources[change.resourceId] = cloneResource(after);
      continue;
    }
    if (change.operation === "delete") {
      if (
        !before ||
        before.version !== change.beforeVersion ||
        before.content !== change.before ||
        after ||
        change.after !== "" ||
        change.afterVersion !== PROJECT_WORKSPACE_ABSENT_VERSION
      ) {
        throw new InvalidProposalError("删除文件的结果无法绑定到对话还原点。");
      }
      if (createdResourceIds.delete(change.resourceId)) {
        delete latestResources[change.resourceId];
        continue;
      }
      baselineResources[change.resourceId] ??= cloneResource(before);
      delete latestResources[change.resourceId];
      deletedResourceIds.add(change.resourceId);
      continue;
    }
    if (
      !before ||
      before.version !== change.beforeVersion ||
      before.content !== change.before ||
      !after ||
      after.version !== change.afterVersion ||
      after.content !== change.after
    ) {
      throw new InvalidProposalError("执行结果无法绑定到对话还原点。");
    }
    if (!createdResourceIds.has(change.resourceId)) {
      baselineResources[change.resourceId] ??= cloneResource(before);
    }
    deletedResourceIds.delete(change.resourceId);
    latestResources[change.resourceId] = cloneResource(after);
  }

  return {
    id: checkpoint?.id ?? checkpointId,
    conversationId,
    projectId,
    createdAt: checkpoint?.createdAt ?? createdAt,
    baselineResources,
    latestResources,
    ...(createdResourceIds.size
      ? { createdResourceIds: [...createdResourceIds].sort() }
      : {}),
    ...(deletedResourceIds.size
      ? { deletedResourceIds: [...deletedResourceIds].sort() }
      : {}),
  };
}

export function createConversationRestoreProposal(input: {
  checkpoint: ConversationCheckpoint;
  resources: Record<string, WorkspaceResource>;
  proposalId: string;
  createdAt: string;
  locale?: AppLocale;
}): ChangeProposal {
  const { checkpoint, resources, proposalId, createdAt } = input;
  const locale = input.locale ?? "zh-CN";
  const conflicts: ResourceConflict[] = [];
  const changedResources: (
    | { kind: "delete-created"; current: WorkspaceResource }
    | { kind: "recreate-deleted"; baseline: WorkspaceResource }
    | {
        kind: "restore-content";
        baseline: WorkspaceResource;
        current: WorkspaceResource;
      }
  )[] = [];

  const createdResourceIds = new Set(checkpoint.createdResourceIds ?? []);
  for (const resourceId of createdResourceIds) {
    const latest = checkpoint.latestResources[resourceId];
    if (!latest) {
      throw new InvalidProposalError("对话还原点缺少新增文件的最新内容。");
    }
    const current = resources[resourceId];
    if (!current) continue;
    if (
      current.projectId !== checkpoint.projectId ||
      current.version !== latest.version ||
      current.content !== latest.content
    ) {
      conflicts.push({
        resourceId,
        target: latest.path,
        expectedVersion: latest.version,
        actualVersion: current.version,
      });
      continue;
    }
    changedResources.push({ kind: "delete-created", current });
  }

  const deletedResourceIds = new Set(checkpoint.deletedResourceIds ?? []);
  for (const resourceId of deletedResourceIds) {
    const baseline = checkpoint.baselineResources[resourceId];
    if (!baseline || checkpoint.latestResources[resourceId]) {
      throw new InvalidProposalError("对话还原点缺少已删除文件的基线内容。");
    }
    const current = resources[resourceId];
    if (current?.content === baseline.content) continue;
    if (current) {
      conflicts.push({
        resourceId,
        target: baseline.path,
        expectedVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        actualVersion: current.version,
      });
      continue;
    }
    changedResources.push({ kind: "recreate-deleted", baseline });
  }

  for (const [resourceId, latest] of Object.entries(
    checkpoint.latestResources,
  )) {
    if (
      createdResourceIds.has(resourceId) ||
      deletedResourceIds.has(resourceId)
    ) {
      continue;
    }
    const baseline = checkpoint.baselineResources[resourceId];
    if (!baseline) {
      throw new InvalidProposalError("对话还原点缺少目标的基线内容。");
    }
    const current = resources[resourceId];
    if (current?.content === baseline.content) continue;
    if (
      !current ||
      current.projectId !== checkpoint.projectId ||
      current.version !== latest.version ||
      current.content !== latest.content
    ) {
      conflicts.push({
        resourceId,
        target: baseline.path,
        expectedVersion: latest.version,
        actualVersion: current?.version ?? null,
      });
      continue;
    }
    changedResources.push({ kind: "restore-content", baseline, current });
  }

  if (conflicts.length > 0) throw new ProposalConflictError(conflicts);
  if (changedResources.length === 0) {
    throw new InvalidProposalError("本次对话当前没有需要恢复的修改。");
  }

  return {
    id: proposalId,
    projectId: checkpoint.projectId,
    conversationId: checkpoint.conversationId,
    title: translateMessage("changes.generated.restoreTitle", locale),
    titleMessage: { key: "changes.generated.restoreTitle" },
    kind: "restore",
    status: "pending",
    connectorId:
      changedResources[0]!.kind === "recreate-deleted"
        ? changedResources[0]!.baseline.connectionId
        : changedResources[0]!.current.connectionId,
    connector: "Project connectors",
    createdAt,
    hunks: changedResources.map((change, index) => {
      const resource =
        change.kind === "recreate-deleted" ? change.baseline : change.current;
      const operation =
        change.kind === "delete-created"
          ? ("delete" as const)
          : change.kind === "recreate-deleted"
            ? ("create" as const)
            : undefined;
      const before = change.kind === "recreate-deleted" ? "" : resource.content;
      const after =
        change.kind === "delete-created" ? "" : change.baseline.content;
      const summaryKey =
        change.kind === "delete-created"
          ? "changes.generated.restoreDeleteSummary"
          : "changes.generated.restoreContentSummary";
      const binary =
        change.kind === "recreate-deleted" &&
        resource.storage.kind === "project-workspace"
          ? resource.storage.binary
          : undefined;
      return {
        id: `${proposalId}-${resource.id}-${index}`,
        resourceId: resource.id,
        target: resource.path,
        ...(operation ? { operation } : {}),
        ...(binary
          ? { binaryFile: { ...binary, source: { ...binary.source } } }
          : {}),
        baseVersion:
          change.kind === "recreate-deleted"
            ? PROJECT_WORKSPACE_ABSENT_VERSION
            : resource.version,
        before,
        after,
        summary: translateMessage(summaryKey, locale),
        summaryMessage: { key: summaryKey },
        lines: binary
          ? binaryRestoreDiffLines(
              resource.path,
              binary.mimeType,
              binary.byteLength,
              binary.sha256,
            )
          : createTextDiffLines(resource.path, before, after),
      };
    }),
  };
}

function binaryRestoreDiffLines(
  target: string,
  mimeType: string,
  byteLength: number,
  sha256: string,
) {
  return [
    { kind: "meta" as const, text: `--- before/${target}` },
    { kind: "meta" as const, text: `+++ after/${target}` },
    { kind: "meta" as const, text: "@@ binary project file @@" },
    {
      kind: "addition" as const,
      text: `+${mimeType} · ${byteLength} bytes · sha256 ${sha256}`,
    },
  ];
}
