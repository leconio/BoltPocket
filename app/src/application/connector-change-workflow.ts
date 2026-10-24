import {
  sameResource,
  verifyApprovalBinding,
  type ApprovalGrant,
  type ApplyTextCreateResult,
  type ConnectorRegistry,
  type TextChangeProposal,
} from "@boltpocket/connector-core";
import {
  googleSpreadsheetResourceKey,
  googleSpreadsheetResourceUrl,
} from "@boltpocket/connector-google-sheets";
import { googlePresentationUrl } from "@boltpocket/connector-google-slides";

import {
  applyChangeProposal,
  InvalidProposalError,
  type ApplyChangeProposalResult,
} from "./change-workflow.ts";
import type { ChangeProposal, WorkspaceResource } from "../domain/models.ts";
import { projectWorkspaceConnectionId } from "../domain/project-workspace.ts";

type UnsignedTextChange = Omit<TextChangeProposal, "patchHash">;

export interface ChangeApprovalAuthority {
  authorize(change: UnsignedTextChange): Promise<{
    proposal: TextChangeProposal;
    approval: ApprovalGrant;
  }>;
}

export class ChangeApplyRolledBackError extends Error {
  constructor(options?: ErrorOptions) {
    super("修改未全部完成；已自动恢复先前目标，请重新生成提案。", options);
    this.name = "ChangeApplyRolledBackError";
  }
}

export class ChangeRollbackError extends Error {
  readonly rollbackFailures: unknown[];

  constructor(rollbackFailures: unknown[], options?: ErrorOptions) {
    super("修改未全部完成，且部分目标自动恢复失败，需要人工检查。", options);
    this.name = "ChangeRollbackError";
    this.rollbackFailures = rollbackFailures;
  }
}

type ApplyThroughConnectorsInput = {
  proposal: ChangeProposal;
  resources: Record<string, WorkspaceResource>;
  receiptId: string;
  conversationId: string;
  appliedAt: string;
  registry: ConnectorRegistry;
  approvalAuthority: ChangeApprovalAuthority;
};

function safeDocumentPath(
  title: string,
  extension: ".txt" | ".md" | ".csv" | ".slides.json",
) {
  const leaf = title
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .trim()
    .slice(0, 160);
  return `${leaf || "新建文档"}${extension}`;
}

function booleanMetadata(
  metadata: ApplyTextCreateResult["snapshot"]["metadata"],
  key: string,
  fallback: boolean,
) {
  return typeof metadata[key] === "boolean" ? metadata[key] : fallback;
}

function createdDocumentResource(
  hunk: ChangeProposal["hunks"][number],
  result: ApplyTextCreateResult,
): WorkspaceResource {
  const target = hunk.createTarget;
  if (
    !target ||
    result.ref.connectorId !== target.connectorId ||
    result.ref.accountId !== target.accountId ||
    result.ref.resourceId !== hunk.resourceId ||
    result.snapshot.ref.resourceId !== result.ref.resourceId ||
    result.snapshot.ref.connectorId !== result.ref.connectorId ||
    result.snapshot.ref.projectId !== result.ref.projectId ||
    result.snapshot.text !== hunk.after ||
    result.snapshot.version !== result.version
  ) {
    throw new InvalidProposalError(
      "连接器新建结果与已授权的文档 Diff 不一致。",
    );
  }
  const title =
    typeof result.snapshot.metadata.title === "string"
      ? result.snapshot.metadata.title
      : result.ref.displayName;
  if (target.provider === "google-docs") {
    const documentId = result.snapshot.metadata.documentId;
    if (
      typeof documentId !== "string" ||
      !/^[A-Za-z0-9_-]{20,200}$/u.test(documentId) ||
      result.ref.kind !== "google-doc"
    ) {
      throw new InvalidProposalError("Google 文档新建结果缺少有效文档 ID。");
    }
    return {
      id: hunk.resourceId,
      projectId: result.ref.projectId,
      connectionId: target.connectorId,
      path: safeDocumentPath(title, ".txt"),
      content: result.snapshot.text,
      version: result.version,
      storage: {
        kind: "google-doc",
        locator: result.ref.locator,
        documentId,
        accountId: target.accountId,
        accountLabel: target.accountLabel,
        writable: booleanMetadata(result.snapshot.metadata, "writable", true),
        trashable: booleanMetadata(result.snapshot.metadata, "trashable", true),
        restorable: booleanMetadata(
          result.snapshot.metadata,
          "restorable",
          false,
        ),
        trashed: booleanMetadata(result.snapshot.metadata, "trashed", false),
        access: "persistent",
      },
    };
  }
  if (target.provider === "google-sheets") {
    const spreadsheetId = result.snapshot.metadata.spreadsheetId;
    const sheetId = result.snapshot.metadata.sheetId;
    if (
      typeof spreadsheetId !== "string" ||
      !/^[A-Za-z0-9_-]{20,200}$/u.test(spreadsheetId) ||
      typeof sheetId !== "number" ||
      !Number.isSafeInteger(sheetId) ||
      sheetId < 0 ||
      result.ref.kind !== "google-sheet"
    ) {
      throw new InvalidProposalError("Google 表格新建结果缺少有效工作表 ID。");
    }
    const providerResourceId = googleSpreadsheetResourceKey(
      spreadsheetId,
      sheetId,
    );
    if (
      result.ref.locator !== googleSpreadsheetResourceUrl(providerResourceId)
    ) {
      throw new InvalidProposalError("Google 表格新建结果绑定无效。");
    }
    return {
      id: hunk.resourceId,
      projectId: result.ref.projectId,
      connectionId: target.connectorId,
      path: safeDocumentPath(title, ".csv"),
      content: result.snapshot.text,
      version: result.version,
      storage: {
        kind: "google-sheet",
        locator: result.ref.locator,
        spreadsheetId,
        sheetId,
        accountId: target.accountId,
        accountLabel: target.accountLabel,
        writable: booleanMetadata(result.snapshot.metadata, "writable", true),
        trashable: booleanMetadata(result.snapshot.metadata, "trashable", true),
        restorable: booleanMetadata(
          result.snapshot.metadata,
          "restorable",
          false,
        ),
        trashed: booleanMetadata(result.snapshot.metadata, "trashed", false),
        access: "persistent",
      },
    };
  }
  if (target.provider === "google-slides") {
    const presentationId = result.snapshot.metadata.presentationId;
    if (
      typeof presentationId !== "string" ||
      !/^[A-Za-z0-9_-]{20,200}$/u.test(presentationId) ||
      result.ref.kind !== "google-slide" ||
      result.ref.locator !== googlePresentationUrl(presentationId)
    ) {
      throw new InvalidProposalError(
        "Google 幻灯片新建结果缺少有效演示文稿 ID。",
      );
    }
    return {
      id: hunk.resourceId,
      projectId: result.ref.projectId,
      connectionId: target.connectorId,
      path: safeDocumentPath(title, ".slides.json"),
      content: result.snapshot.text,
      version: result.version,
      storage: {
        kind: "google-slide",
        locator: result.ref.locator,
        presentationId,
        accountId: target.accountId,
        accountLabel: target.accountLabel,
        writable: booleanMetadata(result.snapshot.metadata, "writable", true),
        trashable: booleanMetadata(result.snapshot.metadata, "trashable", true),
        restorable: booleanMetadata(
          result.snapshot.metadata,
          "restorable",
          false,
        ),
        trashed: booleanMetadata(result.snapshot.metadata, "trashed", false),
        access: "persistent",
      },
    };
  }
  const pageId = result.snapshot.metadata.pageId;
  if (
    typeof pageId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      pageId,
    ) ||
    result.ref.kind !== "notion-page"
  ) {
    throw new InvalidProposalError("Notion 新建结果缺少有效页面 ID。");
  }
  return {
    id: hunk.resourceId,
    projectId: result.ref.projectId,
    connectionId: target.connectorId,
    path: safeDocumentPath(title, ".md"),
    content: result.snapshot.text,
    version: result.version,
    storage: {
      kind: "notion-page",
      locator: result.ref.locator,
      pageId,
      accountId: target.accountId,
      accountLabel: target.accountLabel,
      writable: booleanMetadata(result.snapshot.metadata, "writable", true),
      trashable: booleanMetadata(result.snapshot.metadata, "trashable", true),
      restorable: booleanMetadata(
        result.snapshot.metadata,
        "restorable",
        false,
      ),
      trashed: booleanMetadata(result.snapshot.metadata, "trashed", false),
      access: "persistent",
    },
  };
}

export async function applyChangeProposalThroughConnectors({
  proposal,
  resources,
  receiptId,
  conversationId,
  appliedAt,
  registry,
  approvalAuthority,
}: ApplyThroughConnectorsInput): Promise<ApplyChangeProposalResult> {
  const externalCreates = proposal.hunks.filter(
    (hunk) => hunk.operation === "create" && hunk.createTarget,
  );
  if (externalCreates.length > 0 && proposal.hunks.length !== 1) {
    throw new InvalidProposalError(
      "外部文档新建必须使用独立提案，以便安全处理未知结果。",
    );
  }
  // Pure planning first validates every hunk before any connector can
  // create a recovery point or write external state.
  const projected = applyChangeProposal({
    proposal,
    resources,
    receiptId,
    conversationId,
    appliedAt,
  });
  const refs = await registry.listResources(proposal.projectId);
  const refsByResourceId = new Map<string, (typeof refs)[number]>();
  for (const ref of refs) {
    if (ref.projectId !== proposal.projectId) {
      throw new InvalidProposalError("连接器返回了不属于当前提案项目的资源。");
    }
    if (refsByResourceId.has(ref.resourceId)) {
      throw new InvalidProposalError("连接器返回了重复的项目资源 ID。");
    }
    refsByResourceId.set(ref.resourceId, ref);
  }
  const authorized = await Promise.all(
    proposal.hunks.map(async (hunk) => {
      const externalCreate =
        hunk.operation === "create" && Boolean(hunk.createTarget);
      const lifecycle = Boolean(hunk.operation) && !externalCreate;
      const ref =
        hunk.operation === "create"
          ? hunk.createTarget
            ? {
                connectorId: hunk.createTarget.connectorId,
                accountId: hunk.createTarget.accountId,
                resourceId: hunk.resourceId,
                projectId: proposal.projectId,
                kind: {
                  "google-docs": "google-doc",
                  "google-sheets": "google-sheet",
                  "google-slides": "google-slide",
                  notion: "notion-page",
                }[hunk.createTarget.provider],
                displayName: hunk.target,
                locator: `boltpocket:create:${hunk.resourceId}`,
              }
            : {
                connectorId: projectWorkspaceConnectionId(proposal.projectId),
                accountId: `project-${proposal.projectId}`,
                resourceId: hunk.resourceId,
                projectId: proposal.projectId,
                kind: "text",
                displayName: hunk.target,
                locator: hunk.target,
              }
          : refsByResourceId.get(hunk.resourceId);
      if (!ref) throw new Error(`找不到目标连接器资源：${hunk.resourceId}`);
      const unsigned = {
        id: `${proposal.id}:${hunk.id}`,
        ref,
        baseVersion: String(hunk.baseVersion),
        before: hunk.before,
        after: hunk.after,
        summary: hunk.summary,
      };
      const binding = await approvalAuthority.authorize({
        ...unsigned,
      });
      if (lifecycle || externalCreate) {
        const connector = registry.required(ref.connectorId);
        if (
          binding.proposal.id !== unsigned.id ||
          !sameResource(binding.proposal.ref, unsigned.ref) ||
          binding.proposal.baseVersion !== unsigned.baseVersion ||
          binding.proposal.before !== unsigned.before ||
          binding.proposal.after !== unsigned.after ||
          binding.proposal.summary !== unsigned.summary
        ) {
          throw new InvalidProposalError(
            "资源生命周期授权与原始 Diff 不一致。",
          );
        }
        verifyApprovalBinding(binding.approval, binding.proposal);
        if (externalCreate) {
          if (!connector.validateTextCreate || !connector.applyTextCreate) {
            throw new InvalidProposalError("目标连接器不支持新建文档。");
          }
          await connector.validateTextCreate(binding.proposal);
        }
        return { binding, lifecycle, externalCreate, hunk };
      }
      await registry
        .required(ref.connectorId)
        .validateTextChange(binding.proposal);
      return { binding, lifecycle, externalCreate, hunk };
    }),
  );

  const applied: {
    binding: (typeof authorized)[number]["binding"];
    version: string;
  }[] = [];
  const created: {
    hunk: ChangeProposal["hunks"][number];
    result: ApplyTextCreateResult;
  }[] = [];
  try {
    for (const authorizedChange of authorized) {
      if (authorizedChange.lifecycle) continue;
      const { binding } = authorizedChange;
      if (authorizedChange.externalCreate) {
        const connector = registry.required(binding.proposal.ref.connectorId);
        const result = await connector.applyTextCreate!(
          binding.proposal,
          binding.approval,
        );
        created.push({ hunk: authorizedChange.hunk, result });
        continue;
      }
      const result = await registry
        .required(binding.proposal.ref.connectorId)
        .applyTextChange(binding.proposal, binding.approval);
      applied.push({ binding, version: result.version });
    }
  } catch (error) {
    if (applied.length === 0) throw error;
    const rollbackFailures: unknown[] = [];
    for (const completed of [...applied].reverse()) {
      try {
        const reverse = await approvalAuthority.authorize({
          id: `${completed.binding.proposal.id}:rollback`,
          ref: completed.binding.proposal.ref,
          baseVersion: completed.version,
          before: completed.binding.proposal.after,
          after: completed.binding.proposal.before,
          summary: "自动恢复未完整执行的多目标修改",
        });
        const connector = registry.required(reverse.proposal.ref.connectorId);
        await connector.validateTextChange(reverse.proposal);
        await connector.applyTextChange(reverse.proposal, reverse.approval);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new ChangeRollbackError(rollbackFailures, { cause: error });
    }
    throw new ChangeApplyRolledBackError({ cause: error });
  }
  const appliedVersions = new Map([
    ...applied.map(
      ({ binding, version }) =>
        [binding.proposal.ref.resourceId, version] as const,
    ),
    ...created.map(
      ({ hunk, result }) => [hunk.resourceId, result.version] as const,
    ),
  ]);
  const actualResources = { ...projected.resources };
  for (const item of created) {
    actualResources[item.hunk.resourceId] = createdDocumentResource(
      item.hunk,
      item.result,
    );
  }
  for (const [resourceId, version] of appliedVersions) {
    const resource = actualResources[resourceId];
    if (!resource) {
      throw new Error("连接器写入了不在提案结果中的资源，需要人工检查。");
    }
    actualResources[resourceId] = { ...resource, version };
  }
  return {
    resources: actualResources,
    receipt: {
      ...projected.receipt,
      changes: projected.receipt.changes.map((change) => ({
        ...change,
        afterVersion:
          appliedVersions.get(change.resourceId) ?? change.afterVersion,
      })),
    },
  };
}
