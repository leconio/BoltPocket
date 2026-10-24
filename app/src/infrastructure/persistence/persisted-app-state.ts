import { Value } from "typebox/value";

import { INITIAL_CONVERSATION_ID, type AppState } from "@/domain/app-state";
import {
  isGeneratedMediaAttachment,
  type ChangeProposal,
  type ChangeReceipt,
  type ChatMessage,
  type ConversationCheckpoint,
  type MemoryItem,
  type Project,
  type RetryableAgentRun,
  type SkillItem,
  type WorkspaceResource,
} from "@/domain/models";
import {
  createProjectWorkspaceConnection,
  isProjectWorkspaceResource,
} from "@/domain/project-workspace";

import type { DurableDocumentStore } from "./document-store";
import {
  migratePersistedAppState,
  PREVIOUS_APP_STATE_KEY,
  PREVIOUS_APP_STATE_MIGRATION_KEY,
} from "./persisted-app-state-v4-migration";
import { persistedAppStateSchema } from "./persisted-app-state-schema";
import {
  PersistedAppStateError,
  validateSnapshotSemantics,
} from "./persisted-app-state-validation";

export { PersistedAppStateError } from "./persisted-app-state-validation";

const APP_STATE_KEY = "app-state:v2";
const APP_STATE_PRE_MIGRATION_RECOVERY_KEY = "app-state:v2:before-v4-recovery";
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_MESSAGES_PER_CONVERSATION = 2_000;

export type PersistedConversation = {
  id: string;
  projectId: string | null;
  modelProfileId?: string;
  messages: ChatMessage[];
};

export type PersistedCheckpoint = Omit<
  ConversationCheckpoint,
  "baselineResources" | "latestResources"
> & {
  baselineResources: WorkspaceResource[];
  latestResources: WorkspaceResource[];
};

type PersistedRun = {
  conversationId: string;
  content: string;
  hadAttachments: boolean;
  runId?: string;
};

export type PersistedAppState = {
  version: 5;
  updatedAt: string;
  pinnedProjectIds?: string[];
  recentProjectIds?: string[];
  recentConversationIds?: string[];
  selectedProjectId: string | null;
  activeConversationId: string;
  projects: Project[];
  workspaceResources: WorkspaceResource[];
  conversations: PersistedConversation[];
  projectConversations: { projectId: string; conversationId: string }[];
  /** App-wide Skill defaults inherited when a project has no override. */
  skillSettings: { skillId: string; enabled: boolean }[];
  globalMemoryEdits?: { memoryId: string; text: string }[];
  globalSkillEdits?: { skillId: string; content: string }[];
  customGlobalMemories?: MemoryItem[];
  customGlobalSkills?: SkillItem[];
  /** Sparse project overrides resolved before skillSettings. */
  projectSkillSettings?: {
    projectId: string;
    skillId: string;
    enabled: boolean;
  }[];
  projectResourcePackSettings?: {
    projectId: string;
    packId: import("@/domain/builtin-project-resources").BuiltInProjectResourcePackId;
    enabled: boolean;
  }[];
  proposals: ChangeProposal[];
  receipts: ChangeReceipt[];
  checkpoints: PersistedCheckpoint[];
  lastReceiptId: string | null;
  pendingRuns: PersistedRun[];
  retryableRuns: PersistedRun[];
};

function compareIds(left: { id: string }, right: { id: string }) {
  return left.id.localeCompare(right.id, "en");
}

function cloneMessageForStorage(message: ChatMessage): ChatMessage {
  const {
    attachments: _attachments,
    execution: _execution,
    thinking: _thinking,
    ...persisted
  } = message;
  const generatedAttachments = (message.attachments ?? [])
    .filter(isGeneratedMediaAttachment)
    .map((attachment) => ({ ...attachment }));
  const visibleExecutionActivity = (message.execution?.activity ?? []).filter(
    (item) => item.kind !== "thinking",
  );
  return {
    ...persisted,
    ...(generatedAttachments.length
      ? { attachments: generatedAttachments }
      : {}),
    ...(message.toolActivity
      ? { toolActivity: [...message.toolActivity] }
      : {}),
    ...(message.execution && visibleExecutionActivity.length
      ? {
          execution: {
            ...message.execution,
            activity: visibleExecutionActivity.map((item) => ({ ...item })),
          },
        }
      : {}),
    ...(message.collaboration
      ? {
          collaboration: message.collaboration.map((task) => ({
            ...task,
            ...(task.toolActivity
              ? { toolActivity: [...task.toolActivity] }
              : {}),
          })),
        }
      : {}),
    ...(message.context
      ? { context: message.context.map((reference) => ({ ...reference })) }
      : {}),
  };
}

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

function cloneProposal(proposal: ChangeProposal): ChangeProposal {
  return {
    ...proposal,
    ...(proposal.titleMessage
      ? {
          titleMessage: {
            ...proposal.titleMessage,
            ...(proposal.titleMessage.values
              ? { values: { ...proposal.titleMessage.values } }
              : {}),
          },
        }
      : {}),
    hunks: proposal.hunks.map((hunk) => ({
      ...hunk,
      ...(hunk.summaryMessage
        ? {
            summaryMessage: {
              ...hunk.summaryMessage,
              ...(hunk.summaryMessage.values
                ? { values: { ...hunk.summaryMessage.values } }
                : {}),
            },
          }
        : {}),
      lines: hunk.lines.map((line) => ({ ...line })),
    })),
  };
}

function cloneReceipt(receipt: ChangeReceipt): ChangeReceipt {
  return {
    ...receipt,
    changes: receipt.changes.map((change) => ({ ...change })),
  };
}

function persistedRun(
  run: RetryableAgentRun | null,
  metadata?: { runId?: string | null },
): PersistedRun | undefined {
  return run
    ? {
        conversationId: run.conversationId,
        content: run.content,
        hadAttachments:
          run.attachments.length > 0 || run.requiresAttachmentReselection,
        ...(metadata?.runId ? { runId: metadata.runId } : {}),
      }
    : undefined;
}

export function createPersistedAppState(
  state: AppState,
  updatedAt = new Date().toISOString(),
): PersistedAppState {
  const knownConversationIds = new Set([
    state.activeConversationId,
    ...Object.keys(state.messagesByConversation),
    ...Object.keys(state.conversationProjectIds),
    ...Object.keys(state.conversationModelProfileIds),
    ...Object.values(state.conversationIdsByProject),
    ...Object.keys(state.activeRunsByConversation),
    ...Object.keys(state.retryableRunsByConversation),
    ...Object.keys(state.runErrorsByConversation),
    ...Object.keys(state.conversationCheckpoints),
    ...Object.values(state.proposals).flatMap((proposal) =>
      proposal.conversationId ? [proposal.conversationId] : [],
    ),
  ]);
  const activityConversationIds = new Set(state.recentConversationIds);
  for (const [conversationId, messages] of Object.entries(
    state.messagesByConversation,
  )) {
    if (messages.length > 0) activityConversationIds.add(conversationId);
  }
  for (const conversationId of [
    ...Object.keys(state.conversationModelProfileIds),
    ...Object.keys(state.activeRunsByConversation),
    ...Object.keys(state.retryableRunsByConversation),
    ...Object.keys(state.runErrorsByConversation),
    ...Object.keys(state.conversationCheckpoints),
    ...Object.values(state.proposals).flatMap((proposal) =>
      proposal.conversationId ? [proposal.conversationId] : [],
    ),
  ]) {
    activityConversationIds.add(conversationId);
  }
  const durableConversationIds = [...knownConversationIds].filter(
    (conversationId) =>
      activityConversationIds.has(conversationId) &&
      Object.hasOwn(state.conversationProjectIds, conversationId) &&
      Object.hasOwn(state.messagesByConversation, conversationId),
  );
  const fallbackConversationId = knownConversationIds.has(
    INITIAL_CONVERSATION_ID,
  )
    ? INITIAL_CONVERSATION_ID
    : state.activeConversationId;
  const conversationIds = new Set(
    durableConversationIds.length > 0
      ? durableConversationIds
      : [fallbackConversationId],
  );
  const activeConversationId =
    state.recentConversationIds.find((conversationId) =>
      conversationIds.has(conversationId),
    ) ??
    Object.values(state.conversationIdsByProject).find((conversationId) =>
      conversationIds.has(conversationId),
    ) ??
    (conversationIds.has(state.activeConversationId)
      ? state.activeConversationId
      : [...conversationIds][0]!);
  const selectedProjectId =
    state.conversationProjectIds[activeConversationId] ?? null;
  const conversations = [...conversationIds]
    .map<PersistedConversation>((id) => ({
      id,
      projectId: state.conversationProjectIds[id] ?? null,
      ...(state.conversationModelProfileIds[id]
        ? { modelProfileId: state.conversationModelProfileIds[id] }
        : {}),
      messages: (state.messagesByConversation[id] ?? [])
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
        .map(cloneMessageForStorage),
    }))
    .sort(compareIds);
  const pendingRuns = Object.values(state.activeRunsByConversation)
    .flatMap((run) => {
      const persisted = persistedRun(run.request, { runId: run.runId });
      return persisted ? [persisted] : [];
    })
    .sort((left, right) =>
      left.conversationId.localeCompare(right.conversationId, "en"),
    );
  const retryableRuns = Object.values(state.retryableRunsByConversation)
    .flatMap((run) => {
      const persisted = persistedRun(run);
      return persisted ? [persisted] : [];
    })
    .filter(
      (run) =>
        !Object.hasOwn(state.activeRunsByConversation, run.conversationId),
    )
    .sort((left, right) =>
      left.conversationId.localeCompare(right.conversationId, "en"),
    );

  return {
    version: 5,
    updatedAt,
    pinnedProjectIds: state.pinnedProjectIds.filter((projectId) =>
      Object.hasOwn(state.projects, projectId),
    ),
    recentProjectIds: state.recentProjectIds.filter((projectId) =>
      Object.hasOwn(state.projects, projectId),
    ),
    recentConversationIds: state.recentConversationIds.filter(
      (conversationId) => conversationIds.has(conversationId),
    ),
    selectedProjectId,
    activeConversationId,
    projects: Object.values(state.projects)
      .map((project) => ({ ...project }))
      .sort(compareIds),
    workspaceResources: Object.values(state.resources)
      .filter(isProjectWorkspaceResource)
      .map(cloneResource)
      .sort(compareIds),
    conversations,
    projectConversations: Object.entries(state.conversationIdsByProject)
      .filter(([, conversationId]) => conversationIds.has(conversationId))
      .map(([projectId, conversationId]) => ({ projectId, conversationId }))
      .sort((left, right) =>
        left.projectId.localeCompare(right.projectId, "en"),
      ),
    skillSettings: Object.entries(state.skillEnabledById)
      .map(([skillId, enabled]) => ({ skillId, enabled }))
      .sort((left, right) => left.skillId.localeCompare(right.skillId, "en")),
    globalMemoryEdits: Object.entries(state.globalMemoryTextById)
      .map(([memoryId, text]) => ({ memoryId, text }))
      .sort((left, right) => left.memoryId.localeCompare(right.memoryId, "en")),
    globalSkillEdits: Object.entries(state.globalSkillContentById)
      .map(([skillId, content]) => ({ skillId, content }))
      .sort((left, right) => left.skillId.localeCompare(right.skillId, "en")),
    customGlobalMemories: Object.values(state.customGlobalMemories)
      .map((memory) => ({
        ...memory,
        ...(memory.sourceMessage
          ? {
              sourceMessage: {
                ...memory.sourceMessage,
                ...(memory.sourceMessage.values
                  ? { values: { ...memory.sourceMessage.values } }
                  : {}),
              },
            }
          : {}),
        ...(memory.projectIds ? { projectIds: [...memory.projectIds] } : {}),
      }))
      .sort(compareIds),
    customGlobalSkills: Object.values(state.customGlobalSkills)
      .map((skill) => ({ ...skill, projectIds: [...skill.projectIds] }))
      .sort(compareIds),
    projectSkillSettings: Object.entries(state.projectSkillEnabledByProjectId)
      .flatMap(([projectId, settings]) =>
        Object.entries(settings).map(([skillId, enabled]) => ({
          projectId,
          skillId,
          enabled,
        })),
      )
      .sort((left, right) =>
        `${left.projectId}\0${left.skillId}`.localeCompare(
          `${right.projectId}\0${right.skillId}`,
          "en",
        ),
      ),
    projectResourcePackSettings: Object.entries(
      state.projectResourcePackEnabledByProjectId,
    )
      .flatMap(([projectId, settings]) =>
        Object.entries(settings).map(([packId, enabled]) => ({
          projectId,
          packId:
            packId as import("@/domain/builtin-project-resources").BuiltInProjectResourcePackId,
          enabled: Boolean(enabled),
        })),
      )
      .sort((left, right) =>
        `${left.projectId}\0${left.packId}`.localeCompare(
          `${right.projectId}\0${right.packId}`,
          "en",
        ),
      ),
    proposals: Object.values(state.proposals)
      .map(cloneProposal)
      .sort(compareIds),
    receipts: Object.values(state.receipts).map(cloneReceipt).sort(compareIds),
    checkpoints: Object.values(state.conversationCheckpoints)
      .map((checkpoint) => ({
        id: checkpoint.id,
        conversationId: checkpoint.conversationId,
        projectId: checkpoint.projectId,
        createdAt: checkpoint.createdAt,
        baselineResources: Object.values(checkpoint.baselineResources)
          .map(cloneResource)
          .sort(compareIds),
        latestResources: Object.values(checkpoint.latestResources)
          .map(cloneResource)
          .sort(compareIds),
        ...(checkpoint.createdResourceIds?.length
          ? { createdResourceIds: [...checkpoint.createdResourceIds].sort() }
          : {}),
        ...(checkpoint.deletedResourceIds?.length
          ? { deletedResourceIds: [...checkpoint.deletedResourceIds].sort() }
          : {}),
      }))
      .sort(compareIds),
    lastReceiptId: state.lastReceiptId,
    pendingRuns,
    retryableRuns,
  };
}

export function decodePersistedAppState(value: string): PersistedAppState {
  const { payload: parsed } = migratePersistedAppState(
    value,
    MAX_SNAPSHOT_BYTES,
  );
  if (!Value.Check(persistedAppStateSchema, parsed)) {
    throw new PersistedAppStateError("Saved app state has an invalid shape.");
  }
  const parsedSnapshot = parsed as PersistedAppState & {
    projectArtifacts?: unknown[];
  };
  const { projectArtifacts: _legacyProjectArtifacts, ...current } =
    parsedSnapshot;
  const snapshot = current as PersistedAppState;
  validateSnapshotSemantics(snapshot);
  return snapshot;
}

function hasDurableUserContent(snapshot: PersistedAppState) {
  return (
    snapshot.projects.length > 0 ||
    snapshot.workspaceResources.length > 0 ||
    snapshot.conversations.some(
      (conversation) =>
        conversation.projectId !== null ||
        conversation.modelProfileId !== undefined ||
        conversation.messages.length > 0,
    ) ||
    (snapshot.globalMemoryEdits?.length ?? 0) > 0 ||
    (snapshot.globalSkillEdits?.length ?? 0) > 0 ||
    (snapshot.customGlobalMemories?.length ?? 0) > 0 ||
    (snapshot.customGlobalSkills?.length ?? 0) > 0 ||
    snapshot.proposals.length > 0 ||
    snapshot.receipts.length > 0 ||
    snapshot.checkpoints.length > 0 ||
    snapshot.pendingRuns.length > 0 ||
    snapshot.retryableRuns.length > 0
  );
}

function mergeByKey<T>(
  previous: readonly T[],
  current: readonly T[],
  key: (value: T) => string,
) {
  const values = new Map(previous.map((value) => [key(value), value] as const));
  for (const value of current) values.set(key(value), value);
  return [...values.values()].sort((left, right) =>
    key(left).localeCompare(key(right), "en"),
  );
}

function mergeOrderedIds(
  current: readonly string[] | undefined,
  previous: readonly string[] | undefined,
  validIds: ReadonlySet<string>,
) {
  return [...new Set([...(current ?? []), ...(previous ?? [])])].filter((id) =>
    validIds.has(id),
  );
}

function mergeConversationMessages(
  previous: readonly ChatMessage[],
  current: readonly ChatMessage[],
) {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const previousIds = new Set(previous.map((message) => message.id));
  return [
    ...previous.map((message) => currentById.get(message.id) ?? message),
    ...current.filter((message) => !previousIds.has(message.id)),
  ].slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function mergeRecoveredSnapshot(
  previous: PersistedAppState,
  current: PersistedAppState,
): PersistedAppState {
  const projects = mergeByKey(
    previous.projects,
    current.projects,
    ({ id }) => id,
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = mergeByKey(
    previous.conversations,
    current.conversations,
    ({ id }) => id,
  ).map((conversation) => {
    const oldConversation = previous.conversations.find(
      (candidate) => candidate.id === conversation.id,
    );
    const newConversation = current.conversations.find(
      (candidate) => candidate.id === conversation.id,
    );
    if (!oldConversation || !newConversation) return conversation;
    return {
      ...conversation,
      projectId: newConversation.projectId ?? oldConversation.projectId,
      modelProfileId:
        newConversation.modelProfileId ?? oldConversation.modelProfileId,
      messages: mergeConversationMessages(
        oldConversation.messages,
        newConversation.messages,
      ),
    };
  });
  const conversationIds = new Set(
    conversations.map((conversation) => conversation.id),
  );
  const receipts = mergeByKey(
    previous.receipts,
    current.receipts,
    ({ id }) => id,
  );
  const receiptIds = new Set(receipts.map((receipt) => receipt.id));
  const activeConversationId = conversationIds.has(current.activeConversationId)
    ? current.activeConversationId
    : previous.activeConversationId;
  const selectedProjectId =
    conversations.find(
      (conversation) => conversation.id === activeConversationId,
    )?.projectId ?? null;
  return {
    ...previous,
    version: 5,
    updatedAt:
      Date.parse(current.updatedAt) >= Date.parse(previous.updatedAt)
        ? current.updatedAt
        : previous.updatedAt,
    pinnedProjectIds: mergeOrderedIds(
      current.pinnedProjectIds,
      previous.pinnedProjectIds,
      projectIds,
    ),
    recentProjectIds: mergeOrderedIds(
      current.recentProjectIds,
      previous.recentProjectIds,
      projectIds,
    ),
    recentConversationIds: mergeOrderedIds(
      current.recentConversationIds,
      previous.recentConversationIds,
      conversationIds,
    ),
    selectedProjectId,
    activeConversationId,
    projects,
    workspaceResources: mergeByKey(
      previous.workspaceResources,
      current.workspaceResources,
      ({ id }) => id,
    ),
    conversations,
    projectConversations: mergeByKey(
      previous.projectConversations,
      current.projectConversations,
      ({ projectId }) => projectId,
    ),
    skillSettings: mergeByKey(
      previous.skillSettings,
      current.skillSettings,
      ({ skillId }) => skillId,
    ),
    globalMemoryEdits: mergeByKey(
      previous.globalMemoryEdits ?? [],
      current.globalMemoryEdits ?? [],
      ({ memoryId }) => memoryId,
    ),
    globalSkillEdits: mergeByKey(
      previous.globalSkillEdits ?? [],
      current.globalSkillEdits ?? [],
      ({ skillId }) => skillId,
    ),
    customGlobalMemories: mergeByKey(
      previous.customGlobalMemories ?? [],
      current.customGlobalMemories ?? [],
      ({ id }) => id,
    ),
    customGlobalSkills: mergeByKey(
      previous.customGlobalSkills ?? [],
      current.customGlobalSkills ?? [],
      ({ id }) => id,
    ),
    projectSkillSettings: mergeByKey(
      previous.projectSkillSettings ?? [],
      current.projectSkillSettings ?? [],
      ({ projectId, skillId }) => `${projectId}\0${skillId}`,
    ),
    projectResourcePackSettings: mergeByKey(
      previous.projectResourcePackSettings ?? [],
      current.projectResourcePackSettings ?? [],
      ({ projectId, packId }) => `${projectId}\0${packId}`,
    ),
    proposals: mergeByKey(
      previous.proposals,
      current.proposals,
      ({ id }) => id,
    ),
    receipts,
    checkpoints: mergeByKey(
      previous.checkpoints,
      current.checkpoints,
      ({ conversationId }) => conversationId,
    ),
    lastReceiptId:
      current.lastReceiptId && receiptIds.has(current.lastReceiptId)
        ? current.lastReceiptId
        : previous.lastReceiptId,
    pendingRuns: mergeByKey(
      previous.pendingRuns,
      current.pendingRuns,
      ({ conversationId }) => conversationId,
    ),
    retryableRuns: mergeByKey(
      previous.retryableRuns,
      current.retryableRuns,
      ({ conversationId }) => conversationId,
    ),
  };
}

function recordById<T extends { id: string }>(items: readonly T[]) {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<
    string,
    T
  >;
}

function restoreRetryableRun(
  run: PersistedRun,
  retryReason: RetryableAgentRun["retryReason"],
): RetryableAgentRun {
  return {
    conversationId: run.conversationId,
    content: run.content,
    attachments: [],
    requiresAttachmentReselection: run.hadAttachments,
    retryReason,
  };
}

export function restorePersistedAppState(
  base: AppState,
  snapshot: PersistedAppState,
  _now = new Date().toISOString(),
): AppState {
  validateSnapshotSemantics(snapshot);
  const messagesByConversation = Object.fromEntries(
    snapshot.conversations.map((conversation) => [
      conversation.id,
      conversation.messages.map(cloneMessageForStorage),
    ]),
  );
  const conversationProjectIds = Object.fromEntries(
    snapshot.conversations.map((conversation) => [
      conversation.id,
      conversation.projectId,
    ]),
  );
  const conversationModelProfileIds = Object.fromEntries(
    snapshot.conversations.flatMap((conversation) =>
      conversation.modelProfileId
        ? [[conversation.id, conversation.modelProfileId] as const]
        : [],
    ),
  );
  const conversationIdsByProject = Object.fromEntries(
    snapshot.projectConversations.map((mapping) => [
      mapping.projectId,
      mapping.conversationId,
    ]),
  );
  const retryableRunsByConversation: Record<string, RetryableAgentRun> =
    Object.fromEntries([
      ...snapshot.retryableRuns.map((run) => [
        run.conversationId,
        restoreRetryableRun(run, "failed"),
      ]),
      ...snapshot.pendingRuns.map((run) => [
        run.conversationId,
        restoreRetryableRun(run, "interrupted"),
      ]),
    ]);
  const runErrorsByConversation = Object.fromEntries(
    Object.values(retryableRunsByConversation).map((run) => [
      run.conversationId,
      run.retryReason === "interrupted"
        ? run.requiresAttachmentReselection
          ? "runtime.messaging.retry.interruptedAttachments"
          : "runtime.messaging.retry.interrupted"
        : run.requiresAttachmentReselection
          ? "runtime.messaging.retry.failedAttachments"
          : "runtime.messaging.retry.failed",
    ]),
  );
  const activeConversationId = snapshot.activeConversationId;
  const retryableRun =
    retryableRunsByConversation[activeConversationId] ?? null;
  const restoredProjectList = snapshot.projects.map((project) => ({
    ...project,
  }));
  const restoredWorkspaceResourceList =
    snapshot.workspaceResources.map(cloneResource);
  const restoredProjects = recordById(restoredProjectList);
  const restoredWorkspaceResources = recordById(restoredWorkspaceResourceList);
  const customGlobalMemories = recordById(
    (snapshot.customGlobalMemories ?? []).map((memory) => ({
      ...memory,
      ...(memory.sourceMessage
        ? {
            sourceMessage: {
              ...memory.sourceMessage,
              ...(memory.sourceMessage.values
                ? { values: { ...memory.sourceMessage.values } }
                : {}),
            },
          }
        : {}),
      ...(memory.projectIds ? { projectIds: [...memory.projectIds] } : {}),
    })),
  );
  const customGlobalSkills = recordById(
    (snapshot.customGlobalSkills ?? []).map((skill) => ({
      ...skill,
      projectIds: [...skill.projectIds],
    })),
  );
  const resources = { ...restoredWorkspaceResources };
  const connections = {
    ...Object.fromEntries(
      Object.values(restoredProjects).map((project) => {
        const resourceCount = Object.values(restoredWorkspaceResources).filter(
          (resource) => resource.projectId === project.id,
        ).length;
        const connection = createProjectWorkspaceConnection(
          project,
          resourceCount,
        );
        return [connection.id, connection];
      }),
    ),
  };
  const skillEnabledById = {
    ...base.skillEnabledById,
    ...Object.fromEntries(
      Object.values(customGlobalSkills).map((skill) => [
        skill.id,
        skill.enabled,
      ]),
    ),
    ...Object.fromEntries(
      snapshot.skillSettings
        .filter(
          (setting) =>
            Object.hasOwn(base.skillEnabledById, setting.skillId) ||
            Object.hasOwn(customGlobalSkills, setting.skillId),
        )
        .map((setting) => [setting.skillId, setting.enabled]),
    ),
  };
  const projectSkillEnabledByProjectId = Object.fromEntries(
    Object.keys(restoredProjects).map((projectId) => [
      projectId,
      { ...base.projectSkillEnabledByProjectId[projectId] },
    ]),
  );
  for (const setting of snapshot.skillSettings) {
    if (Object.hasOwn(base.skillEnabledById, setting.skillId)) continue;
    for (const projectId of Object.keys(restoredProjects)) {
      if (
        Object.hasOwn(
          projectSkillEnabledByProjectId[projectId] ?? {},
          setting.skillId,
        )
      ) {
        projectSkillEnabledByProjectId[projectId]![setting.skillId] =
          setting.enabled;
      }
    }
  }
  for (const setting of snapshot.projectSkillSettings ?? []) {
    projectSkillEnabledByProjectId[setting.projectId]![setting.skillId] =
      setting.enabled;
  }
  const projectResourcePackEnabledByProjectId = Object.fromEntries(
    Object.keys(restoredProjects).map((projectId) => [
      projectId,
      { ...base.projectResourcePackEnabledByProjectId[projectId] },
    ]),
  );
  for (const setting of snapshot.projectResourcePackSettings ?? []) {
    projectResourcePackEnabledByProjectId[setting.projectId]![setting.packId] =
      setting.enabled;
  }

  return {
    ...base,
    projects: restoredProjects,
    pinnedProjectIds: [...(snapshot.pinnedProjectIds ?? [])],
    recentProjectIds: [
      ...(snapshot.recentProjectIds ??
        (snapshot.selectedProjectId ? [snapshot.selectedProjectId] : [])),
    ],
    recentConversationIds: [
      ...(snapshot.recentConversationIds ?? [activeConversationId]),
    ],
    selectedProjectId: snapshot.selectedProjectId,
    activeConversationId,
    conversationIdsByProject,
    conversationProjectIds,
    conversationModelProfileIds,
    messages: messagesByConversation[activeConversationId] ?? [],
    messagesByConversation,
    draft: "",
    isRunning: false,
    activeRunId: null,
    activeRunConversationId: null,
    activeRunRequest: null,
    retryableRun,
    runStatus: "",
    runError: runErrorsByConversation[activeConversationId] ?? null,
    activeRunsByConversation: {},
    retryableRunsByConversation,
    runErrorsByConversation,
    draftAttachments: [],
    resources,
    connections,
    proposals: recordById(snapshot.proposals.map(cloneProposal)),
    skillEnabledById,
    globalMemoryTextById: Object.fromEntries(
      (snapshot.globalMemoryEdits ?? []).map((edit) => [
        edit.memoryId,
        edit.text,
      ]),
    ),
    globalSkillContentById: Object.fromEntries(
      (snapshot.globalSkillEdits ?? []).map((edit) => [
        edit.skillId,
        edit.content,
      ]),
    ),
    customGlobalMemories,
    customGlobalSkills,
    projectSkillEnabledByProjectId,
    projectResourcePackEnabledByProjectId,
    receipts: recordById(snapshot.receipts.map(cloneReceipt)),
    conversationCheckpoints: Object.fromEntries(
      snapshot.checkpoints.map((checkpoint) => [
        checkpoint.conversationId,
        {
          id: checkpoint.id,
          conversationId: checkpoint.conversationId,
          projectId: checkpoint.projectId,
          createdAt: checkpoint.createdAt,
          baselineResources: recordById(
            checkpoint.baselineResources.map(cloneResource),
          ),
          latestResources: recordById(
            checkpoint.latestResources.map(cloneResource),
          ),
          ...(checkpoint.createdResourceIds?.length
            ? { createdResourceIds: [...checkpoint.createdResourceIds] }
            : {}),
          ...(checkpoint.deletedResourceIds?.length
            ? { deletedResourceIds: [...checkpoint.deletedResourceIds] }
            : {}),
        } satisfies ConversationCheckpoint,
      ]),
    ),
    lastReceiptId: snapshot.lastReceiptId,
    storageError: null,
  };
}

export class PersistedAppStateRepository {
  constructor(readonly store: DurableDocumentStore) {}

  async load() {
    const value = await this.store.read(APP_STATE_KEY);
    let current: PersistedAppState | undefined;
    let currentError: unknown;
    let currentMigrationRequired = false;
    if (value !== undefined) {
      try {
        const migration = migratePersistedAppState(value, MAX_SNAPSHOT_BYTES);
        currentMigrationRequired = migration.migrated;
        current = decodePersistedAppState(JSON.stringify(migration.payload));
      } catch (error) {
        currentError = error;
      }
    }
    if (
      current &&
      (await this.store.read(PREVIOUS_APP_STATE_MIGRATION_KEY)) !== undefined
    ) {
      return current;
    }

    const previousValue = await this.store.read(PREVIOUS_APP_STATE_KEY);
    if (previousValue === undefined) {
      if (current) {
        if (currentMigrationRequired && value !== undefined) {
          await this.store.write(APP_STATE_PRE_MIGRATION_RECOVERY_KEY, value);
          await this.store.write(APP_STATE_KEY, JSON.stringify(current));
        }
        return current;
      }
      if (currentError) throw currentError;
      return undefined;
    }
    let migrated: ReturnType<typeof migratePersistedAppState>;
    try {
      migrated = migratePersistedAppState(previousValue, MAX_SNAPSHOT_BYTES);
    } catch (error) {
      if (current) return current;
      if (
        currentError instanceof PersistedAppStateError &&
        error instanceof PersistedAppStateError
      ) {
        throw new PersistedAppStateError(
          `Current saved state is unreadable (${currentError.message}); its recovery state is also unavailable (${error.message}).`,
        );
      }
      throw error;
    }
    const encoded = JSON.stringify(migrated.payload);
    const previous = decodePersistedAppState(encoded);
    let snapshot = previous;
    if (current && !hasDurableUserContent(previous)) {
      snapshot = current;
    } else if (
      current &&
      hasDurableUserContent(current) &&
      hasDurableUserContent(previous)
    ) {
      try {
        snapshot = decodePersistedAppState(
          JSON.stringify(mergeRecoveredSnapshot(previous, current)),
        );
      } catch {
        // The previous snapshot remains the authoritative recovery point if a
        // rare identifier collision cannot be merged without weakening schema
        // or cross-project validation.
        snapshot = previous;
      }
    }
    if (snapshot === current && !currentMigrationRequired) return current;

    if (
      current &&
      value !== undefined &&
      (currentMigrationRequired || hasDurableUserContent(current))
    ) {
      await this.store.write(APP_STATE_PRE_MIGRATION_RECOVERY_KEY, value);
    }
    await this.store.write(APP_STATE_KEY, JSON.stringify(snapshot));
    await this.store.write(
      PREVIOUS_APP_STATE_MIGRATION_KEY,
      previous.updatedAt,
    );
    return snapshot;
  }

  async save(state: AppState, updatedAt = new Date().toISOString()) {
    const value = JSON.stringify(createPersistedAppState(state, updatedAt));
    decodePersistedAppState(value);
    await this.store.write(APP_STATE_KEY, value);
  }

  flush() {
    return this.store.flush();
  }
}
