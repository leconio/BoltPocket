import type {
  ConnectorRegistry,
  ConnectorResourceRef,
} from "@boltpocket/connector-core";

import type {
  AgentRunInput,
  AgentRunObserver,
} from "@/application/ports/agent-runtime";
import type { ResourceReadBudget } from "@/application/resource-read-budget";
import {
  isReadOnlyWorkspaceResource,
  type ChangeProposal,
  type GeneratedMediaAttachment,
  type WorkspaceResource,
} from "@/domain/models";
import type { WorkspacePiCodingTools } from "@/infrastructure/agent/workspace-pi-coding-tools";

export type ActiveRunContext = {
  input: AgentRunInput;
  signal: AbortSignal;
  registry: ConnectorRegistry;
  readBudget: ResourceReadBudget;
  resourceSnapshots: Map<string, WorkspaceResource>;
  toolEnvironment?: Promise<WorkspacePiCodingTools>;
  proposal?: ChangeProposal;
  onEvent?: AgentRunObserver;
  sensitiveAccessApproved?: boolean;
  /** Direct children launched by the current parent run; capped by the host. */
  subagentCalls?: number;
  /** Host-saved image results produced during this parent run. */
  generatedMedia?: GeneratedMediaAttachment[];
};

function workspaceResourceForRef(
  active: ActiveRunContext,
  ref: ConnectorResourceRef,
) {
  const projectId = active.input.project?.id;
  if (!projectId || ref.projectId !== projectId) return undefined;
  return active.input.resources.find(
    (resource) =>
      resource.projectId === projectId &&
      resource.id === ref.resourceId &&
      resource.connectionId === ref.connectorId,
  );
}

function refreshedExternalStorage(
  resource: WorkspaceResource,
  metadata: Record<string, unknown>,
): WorkspaceResource["storage"] {
  const storage = resource.storage;
  if (
    storage.kind !== "google-doc" &&
    storage.kind !== "google-sheet" &&
    storage.kind !== "google-slide" &&
    storage.kind !== "notion-page"
  ) {
    return storage;
  }
  const access = {
    writable:
      typeof metadata.writable === "boolean"
        ? metadata.writable
        : storage.writable,
    trashable:
      typeof metadata.trashable === "boolean"
        ? metadata.trashable
        : storage.trashable,
    restorable:
      typeof metadata.restorable === "boolean"
        ? metadata.restorable
        : storage.restorable,
    trashed:
      typeof metadata.trashed === "boolean"
        ? metadata.trashed
        : storage.trashed,
  };
  return { ...storage, ...access };
}

export function projectResourceRefsById(
  projectId: string,
  refs: readonly ConnectorResourceRef[],
) {
  const refsById = new Map<string, ConnectorResourceRef>();
  for (const ref of refs) {
    if (ref.projectId !== projectId) {
      throw new Error(`连接器返回了其他项目的资源：${ref.resourceId}`);
    }
    if (refsById.has(ref.resourceId)) {
      throw new Error(`项目资源 ID 冲突：${ref.resourceId}`);
    }
    refsById.set(ref.resourceId, ref);
  }
  return refsById;
}

export async function readCurrentWorkspaceResource(
  active: ActiveRunContext,
  ref: ConnectorResourceRef,
) {
  const template = workspaceResourceForRef(active, ref);
  if (!template) {
    throw new Error(`资源不在当前项目授权范围：${ref.resourceId}`);
  }
  const snapshot = await active.registry.read(ref);
  if (
    snapshot.ref.resourceId !== ref.resourceId ||
    snapshot.ref.connectorId !== ref.connectorId ||
    snapshot.ref.projectId !== ref.projectId
  ) {
    throw new Error(`连接器返回了不匹配的资源快照：${ref.resourceId}`);
  }
  const resource: WorkspaceResource = {
    ...template,
    content: snapshot.text,
    version: snapshot.version,
    storage: refreshedExternalStorage(template, snapshot.metadata),
  };
  active.resourceSnapshots.set(resource.id, resource);
  return resource;
}

export async function assertProposalTargetsCurrent(
  active: ActiveRunContext,
  changes: readonly { resourceId: string }[],
) {
  if (!active.input.project) {
    throw new Error("当前对话没有绑定项目，不能创建项目修改提案。");
  }
  const refs = await active.registry.listResources(active.input.project.id);
  const refsById = projectResourceRefsById(active.input.project.id, refs);
  const currentResources: WorkspaceResource[] = [];
  for (const change of changes) {
    if (!active.readBudget.has(change.resourceId)) {
      throw new Error(`创建提案前必须读取目标资源：${change.resourceId}`);
    }
    const ref = refsById.get(change.resourceId);
    if (!ref) {
      throw new Error(`资源不在当前项目连接器范围：${change.resourceId}`);
    }
    const resource = active.resourceSnapshots.get(change.resourceId);
    if (!resource) {
      throw new Error(`创建提案前必须读取目标资源：${change.resourceId}`);
    }
    if (isReadOnlyWorkspaceResource(resource)) {
      throw new Error(`项目来源快照是只读资源：${change.resourceId}`);
    }
    const current = await readCurrentWorkspaceResource(active, ref);
    if (
      resource.projectId !== active.input.project.id ||
      resource.connectionId !== ref.connectorId ||
      current.content !== resource.content ||
      current.version !== resource.version
    ) {
      throw new Error(`资源版本已变化：${change.resourceId}`);
    }
    currentResources.push(current);
  }
  return currentResources;
}
