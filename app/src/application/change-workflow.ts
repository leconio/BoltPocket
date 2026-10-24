import type {
  ChangeProposal,
  ChangeReceipt,
  WorkspaceResource,
} from "../domain/models.ts";
import {
  isBinaryProjectWorkspaceResource,
  isReadOnlyWorkspaceResource,
} from "../domain/models.ts";
import {
  createProjectWorkspaceFileResource,
  createVerifiedProjectWorkspaceBinaryFileResource,
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "../domain/project-workspace.ts";
import { getProposalDiffStats } from "../domain/text-diff.ts";
import {
  projectSkillPath,
  validateProjectSkillDocument,
} from "../domain/project-skill-document.ts";

export type ResourceConflict = {
  resourceId: string;
  target: string;
  expectedVersion: string;
  actualVersion: string | null;
};

export class ProposalConflictError extends Error {
  readonly conflicts: ResourceConflict[];

  constructor(conflicts: ResourceConflict[]) {
    super("目标内容已变化，请重新生成修改提案。");
    this.name = "ProposalConflictError";
    this.conflicts = conflicts;
  }
}

export class InvalidProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProposalError";
  }
}

type ApplyChangeProposalInput = {
  proposal: ChangeProposal;
  resources: Record<string, WorkspaceResource>;
  receiptId: string;
  conversationId: string;
  appliedAt: string;
};

export type ApplyChangeProposalResult = {
  resources: Record<string, WorkspaceResource>;
  receipt: ChangeReceipt;
};

function nextProjectedVersion(version: string) {
  const numeric = Number(version);
  return Number.isSafeInteger(numeric) && String(numeric) === version
    ? String(numeric + 1)
    : `${version}:pending`;
}

function projectWorkspacePathCollision(
  resources: Record<string, WorkspaceResource>,
  projectId: string,
  path: string,
) {
  return Object.values(resources).find(
    (resource) =>
      resource.projectId === projectId &&
      (resource.path === path ||
        resource.path.startsWith(`${path}/`) ||
        path.startsWith(`${resource.path}/`)) &&
      isProjectWorkspaceResource(resource),
  );
}

export function selectChangeProposalHunks(
  proposal: ChangeProposal,
  acceptedHunkIds: readonly string[],
): ChangeProposal {
  if (acceptedHunkIds.length === 0) {
    throw new InvalidProposalError("至少需要接受一项修改才能执行。");
  }

  const acceptedIds = new Set(acceptedHunkIds);
  if (acceptedIds.size !== acceptedHunkIds.length) {
    throw new InvalidProposalError("接受的修改项不能重复。");
  }

  const hunks = proposal.hunks.filter((hunk) => acceptedIds.has(hunk.id));
  if (hunks.length !== acceptedIds.size) {
    throw new InvalidProposalError("接受的修改项不属于当前提案。");
  }

  if (
    proposal.kind === "capability" &&
    acceptedIds.size !== proposal.hunks.length
  ) {
    throw new InvalidProposalError(
      "完整 Skill 包必须一次应用全部文件，不能只选择部分文件。",
    );
  }

  return { ...proposal, hunks };
}

export function applyChangeProposal({
  proposal,
  resources,
  receiptId,
  conversationId,
  appliedAt,
}: ApplyChangeProposalInput): ApplyChangeProposalResult {
  if (proposal.status !== "pending") {
    throw new InvalidProposalError("这个修改提案已经执行过。");
  }

  if (proposal.hunks.length === 0) {
    throw new InvalidProposalError("修改提案没有可执行的内容。");
  }

  const resourceIds = new Set<string>();
  let capabilityBytes = 0;
  let capabilitySkillDocuments = 0;
  for (const hunk of proposal.hunks) {
    if (resourceIds.has(hunk.resourceId)) {
      throw new InvalidProposalError("同一目标不能在一次提案中重复修改。");
    }
    resourceIds.add(hunk.resourceId);
    if (hunk.operation === "create") {
      if (hunk.createTarget) {
        if (
          hunk.binaryFile ||
          hunk.createTarget.connectorId !== proposal.connectorId ||
          !hunk.createTarget.accountId ||
          !hunk.createTarget.accountLabel ||
          hunk.baseVersion !== PROJECT_WORKSPACE_ABSENT_VERSION ||
          hunk.before !== "" ||
          !hunk.target.trim() ||
          hunk.target.length > 1_000 ||
          /[\u0000-\u001f\u007f]/u.test(hunk.target) ||
          hunk.after.includes("\0") ||
          hunk.after.length > 100_000
        ) {
          throw new InvalidProposalError("外部文档新增修改项无效。");
        }
        continue;
      }
      if (!isSafeProjectWorkspacePath(hunk.target)) {
        throw new InvalidProposalError("新增文件路径无效。");
      }
      const expected = createProjectWorkspaceFileResource({
        projectId: proposal.projectId,
        path: hunk.target,
        content: "",
        version: PROJECT_WORKSPACE_ABSENT_VERSION,
      });
      if (
        hunk.resourceId !== expected.id ||
        hunk.baseVersion !== PROJECT_WORKSPACE_ABSENT_VERSION ||
        hunk.before !== "" ||
        hunk.after.includes("\0") ||
        (!hunk.binaryFile && hunk.after.length > 100_000) ||
        (hunk.binaryFile ? hunk.binaryFile.encoding !== "base64" : false)
      ) {
        throw new InvalidProposalError("新增文件修改项无效。");
      }
      if (
        proposal.hunks.some(
          (candidate) =>
            candidate !== hunk &&
            candidate.operation === "create" &&
            !candidate.createTarget &&
            (candidate.target.startsWith(`${hunk.target}/`) ||
              hunk.target.startsWith(`${candidate.target}/`)),
        )
      ) {
        throw new InvalidProposalError("一次提案不能创建相互嵌套的文件路径。");
      }
      capabilityBytes += hunk.binaryFile
        ? hunk.binaryFile.byteLength
        : new TextEncoder().encode(hunk.after).byteLength;
      if (
        proposal.capabilityInstall &&
        hunk.target === `skills/${proposal.capabilityInstall.skillId}/SKILL.md`
      ) {
        capabilitySkillDocuments += 1;
      }
      if (hunk.binaryFile) {
        try {
          createVerifiedProjectWorkspaceBinaryFileResource({
            projectId: proposal.projectId,
            path: hunk.target,
            contentBase64: hunk.after,
            binary: hunk.binaryFile,
            version: PROJECT_WORKSPACE_ABSENT_VERSION,
          });
        } catch {
          throw new InvalidProposalError("二进制项目资源副本无效。");
        }
      }
      if (
        !hunk.binaryFile &&
        projectSkillPath(hunk.target) &&
        !validateProjectSkillDocument(hunk.target, hunk.after).valid
      ) {
        throw new InvalidProposalError("新增 Skill 文档无效。");
      }
      continue;
    }
    if (hunk.binaryFile) {
      throw new InvalidProposalError("二进制项目资源只能通过新建复制。");
    }
    const resource = resources[hunk.resourceId];
    if (!resource) continue;
    if (
      resource.projectId !== proposal.projectId ||
      resource.path !== hunk.target
    ) {
      throw new InvalidProposalError("修改项不属于提案声明的项目资源。");
    }
    if (isReadOnlyWorkspaceResource(resource)) {
      throw new InvalidProposalError("只读项目资源不能执行修改提案。");
    }
    if (
      isBinaryProjectWorkspaceResource(resource) &&
      hunk.operation !== "delete"
    ) {
      throw new InvalidProposalError("二进制项目资源不能作为文本修改。");
    }
    if (hunk.operation === "delete") {
      if (
        !["manual", "restore"].includes(proposal.kind) ||
        hunk.after !== "" ||
        !isProjectWorkspaceResource(resource)
      ) {
        throw new InvalidProposalError(
          "只有资源管理或还原操作可以移除项目文件。",
        );
      }
    } else if (
      projectSkillPath(resource.path) &&
      !validateProjectSkillDocument(resource.path, hunk.after).valid
    ) {
      throw new InvalidProposalError("修改后的 Skill 文档无效。");
    }
  }

  if (proposal.kind === "capability") {
    const install = proposal.capabilityInstall;
    if (
      !install ||
      install.kind !== "skill" ||
      proposal.hunks.length !== install.fileCount ||
      capabilityBytes !== install.totalBytes ||
      capabilitySkillDocuments !== 1 ||
      proposal.hunks.some((hunk) => {
        const prefix = `skills/${install.skillId}/`;
        if (
          hunk.operation !== "create" ||
          hunk.createTarget ||
          !hunk.target.startsWith(prefix)
        ) {
          return true;
        }
        return Boolean(
          hunk.binaryFile &&
          (hunk.binaryFile.source.kind !== "third-party-skill" ||
            hunk.binaryFile.source.skillId !== install.skillId ||
            hunk.binaryFile.source.bundleSha256 !== install.bundleSha256 ||
            hunk.binaryFile.source.path !== hunk.target.slice(prefix.length)),
        );
      })
    ) {
      throw new InvalidProposalError("完整 Skill 包修改提案无效。");
    }
  } else if (proposal.capabilityInstall) {
    throw new InvalidProposalError("非能力安装提案不能携带 Skill 包元数据。");
  }

  const conflicts = proposal.hunks.flatMap<ResourceConflict>((hunk) => {
    const resource =
      hunk.operation === "create"
        ? hunk.createTarget
          ? resources[hunk.resourceId]
          : (resources[hunk.resourceId] ??
            projectWorkspacePathCollision(
              resources,
              proposal.projectId,
              hunk.target,
            ))
        : resources[hunk.resourceId];
    if (hunk.operation === "create" && !resource) return [];
    if (
      resource &&
      resource.version === hunk.baseVersion &&
      resource.content === hunk.before
    ) {
      return [];
    }

    return [
      {
        resourceId: hunk.resourceId,
        target: hunk.target,
        expectedVersion: hunk.baseVersion,
        actualVersion: resource?.version ?? null,
      },
    ];
  });
  if (conflicts.length > 0) throw new ProposalConflictError(conflicts);

  const nextResources = { ...resources };
  const changes = proposal.hunks.map((hunk) => {
    if (hunk.operation === "create") {
      if (hunk.createTarget) {
        return {
          hunkId: hunk.id,
          resourceId: hunk.resourceId,
          target: hunk.target,
          operation: "create" as const,
          before: "",
          after: hunk.after,
          beforeVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
          afterVersion: `${PROJECT_WORKSPACE_ABSENT_VERSION}:pending`,
        };
      }
      const created = hunk.binaryFile
        ? createVerifiedProjectWorkspaceBinaryFileResource({
            projectId: proposal.projectId,
            path: hunk.target,
            contentBase64: hunk.after,
            binary: hunk.binaryFile,
          })
        : createProjectWorkspaceFileResource({
            projectId: proposal.projectId,
            path: hunk.target,
            content: hunk.after,
          });
      nextResources[created.id] = created;
      return {
        hunkId: hunk.id,
        resourceId: created.id,
        target: created.path,
        operation: "create" as const,
        before: "",
        after: created.content,
        beforeVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        afterVersion: created.version,
      };
    }
    const resource = resources[hunk.resourceId]!;
    if (hunk.operation === "delete") {
      delete nextResources[hunk.resourceId];
      return {
        hunkId: hunk.id,
        resourceId: hunk.resourceId,
        target: hunk.target,
        operation: "delete" as const,
        before: resource.content,
        after: "",
        beforeVersion: resource.version,
        afterVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
      };
    }
    const afterVersion = nextProjectedVersion(resource.version);
    nextResources[hunk.resourceId] = {
      ...resource,
      content: hunk.after,
      version: afterVersion,
    };
    return {
      hunkId: hunk.id,
      resourceId: hunk.resourceId,
      target: hunk.target,
      before: resource.content,
      after: hunk.after,
      beforeVersion: resource.version,
      afterVersion,
    };
  });
  const stats = getProposalDiffStats(proposal.hunks);

  return {
    resources: nextResources,
    receipt: {
      id: receiptId,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      projectId: proposal.projectId,
      conversationId,
      connectorId: proposal.connectorId,
      connector: proposal.connector,
      appliedAt,
      changes,
      additions: stats.additions,
      deletions: stats.deletions,
    },
  };
}
