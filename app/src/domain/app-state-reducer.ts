import {
  isImageAttachment,
  isReadOnlyWorkspaceResource,
  isTextFileAttachment,
} from "./models.ts";
import { isBuiltInProjectResourcePackId } from "./builtin-project-resources.ts";
import {
  createProjectWorkspaceFileResource,
  createVerifiedProjectWorkspaceBinaryFileResource,
  isProjectWorkspaceConnectionId,
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  PROJECT_WORKSPACE_ABSENT_VERSION,
  projectWorkspaceConnectionId,
} from "./project-workspace.ts";
import {
  projectSkillPath,
  validateProjectSkillDocument,
} from "./project-skill-document.ts";
import {
  MAX_ACTIVE_CONVERSATION_RUNS,
  type AppAction,
  type AppState,
} from "./app-state-model.ts";
import {
  claimConversationState,
  deleteConversationState,
} from "./app-state-conversation-mutations.ts";
import { reduceLibraryAction } from "./app-state-library-mutations.ts";
import {
  activateProjectConversation,
  appendConversationMessage,
  conversationActivityProjection,
  conversationRunProjection,
  hasSameStorageBinding,
  hasValidConnectionBundle,
  hasValidProjectWorkspaceBundle,
  promoteRecentId,
} from "./app-state-reducer-helpers.ts";

export {
  getMemoryCatalog,
  getSkillCatalog,
} from "./app-state-reducer-helpers.ts";

function withoutRecordKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function withActiveConversationRun(state: AppState): AppState {
  return {
    ...state,
    ...conversationRunProjection(state, state.activeConversationId),
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "state/restore":
      return { ...action.state, isHydrating: false };
    case "state/hydration-complete":
      return state.isHydrating ? { ...state, isHydrating: false } : state;
    case "storage/fail":
      return { ...state, storageError: action.message };
    case "storage/ready":
      return state.storageError ? { ...state, storageError: null } : state;
    case "project/created": {
      if (
        state.projects[action.project.id] ||
        state.connections[action.connection.id] ||
        action.resources.some((resource) => state.resources[resource.id]) ||
        !hasValidProjectWorkspaceBundle(
          action.project,
          action.connection,
          action.resources,
        )
      ) {
        return state;
      }
      return {
        ...state,
        projects: {
          ...state.projects,
          [action.project.id]: action.project,
        },
        recentProjectIds: promoteRecentId(
          state.recentProjectIds,
          action.project.id,
        ),
        connections: {
          ...state.connections,
          [action.connection.id]: action.connection,
        },
        resources: {
          ...state.resources,
          ...Object.fromEntries(
            action.resources.map((resource) => [resource.id, resource]),
          ),
        },
        projectSkillEnabledByProjectId: {
          ...state.projectSkillEnabledByProjectId,
          [action.project.id]: {},
        },
        projectResourcePackEnabledByProjectId: {
          ...state.projectResourcePackEnabledByProjectId,
          [action.project.id]: {},
        },
      };
    }
    case "project/workspace-skill-created":
      return reduceLibraryAction(state, action);
    case "project/opened":
      return state;
    case "project/set-pinned": {
      if (!state.projects[action.projectId]) return state;
      const pinnedProjectIds = action.pinned
        ? promoteRecentId(state.pinnedProjectIds, action.projectId)
        : state.pinnedProjectIds.filter(
            (projectId) => projectId !== action.projectId,
          );
      if (
        pinnedProjectIds.length === state.pinnedProjectIds.length &&
        pinnedProjectIds.every(
          (projectId, index) => projectId === state.pinnedProjectIds[index],
        )
      ) {
        return state;
      }
      return { ...state, pinnedProjectIds };
    }
    case "project-resource/set-enabled": {
      if (
        !state.projects[action.projectId] ||
        !isBuiltInProjectResourcePackId(action.packId)
      ) {
        return state;
      }
      const current =
        state.projectResourcePackEnabledByProjectId[action.projectId]?.[
          action.packId
        ] ?? true;
      if (current === action.enabled) return state;
      return {
        ...state,
        projectResourcePackEnabledByProjectId: {
          ...state.projectResourcePackEnabledByProjectId,
          [action.projectId]: {
            ...state.projectResourcePackEnabledByProjectId[action.projectId],
            [action.packId]: action.enabled,
          },
        },
      };
    }
    case "chat/open-project": {
      if (!state.projects[action.projectId]) return state;
      const latestConversationId =
        state.conversationIdsByProject[action.projectId];
      const conversationId =
        latestConversationId &&
        state.conversationProjectIds[latestConversationId] === action.projectId
          ? latestConversationId
          : `conversation-${action.projectId}`;
      if (
        Object.hasOwn(state.conversationProjectIds, conversationId) &&
        state.conversationProjectIds[conversationId] !== action.projectId
      ) {
        return state;
      }
      const messages = state.messagesByConversation[conversationId] ?? [];
      return activateProjectConversation(
        state,
        action.projectId,
        conversationId,
        messages,
      );
    }
    case "chat/open-conversation": {
      const ownerProjectId =
        state.conversationProjectIds[action.conversationId];
      if (
        !Object.hasOwn(state.conversationProjectIds, action.conversationId) ||
        ownerProjectId !== action.projectId ||
        (action.projectId !== null && !state.projects[action.projectId]) ||
        !Object.hasOwn(state.messagesByConversation, action.conversationId)
      ) {
        return state;
      }
      return activateProjectConversation(
        state,
        action.projectId,
        action.conversationId,
        state.messagesByConversation[action.conversationId]!,
      );
    }
    case "chat/new":
      if (Object.hasOwn(state.conversationProjectIds, action.conversationId)) {
        return state;
      }
      return {
        ...state,
        selectedProjectId: null,
        activeConversationId: action.conversationId,
        conversationProjectIds: {
          ...state.conversationProjectIds,
          [action.conversationId]: null,
        },
        messages: [],
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.conversationId]: [],
        },
        draft: "",
        ...conversationRunProjection(state, action.conversationId),
        draftAttachments: [],
      };
    case "chat/new-project":
      if (
        !state.projects[action.projectId] ||
        Object.hasOwn(state.conversationProjectIds, action.conversationId)
      ) {
        return state;
      }
      return {
        ...state,
        selectedProjectId: action.projectId,
        activeConversationId: action.conversationId,
        conversationProjectIds: {
          ...state.conversationProjectIds,
          [action.conversationId]: action.projectId,
        },
        messages: [],
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.conversationId]: [],
        },
        draft: "",
        ...conversationRunProjection(state, action.conversationId),
        draftAttachments: [],
      };
    case "conversation/delete":
      return deleteConversationState(state, action);
    case "conversation/claim-project":
      return claimConversationState(state, action);
    case "conversation/set-model": {
      if (
        !Object.hasOwn(state.conversationProjectIds, action.conversationId) ||
        Object.hasOwn(state.activeRunsByConversation, action.conversationId)
      ) {
        return state;
      }
      if (action.modelProfileId === null) {
        if (!state.conversationModelProfileIds[action.conversationId]) {
          return state;
        }
        return {
          ...state,
          ...conversationActivityProjection(state, action.conversationId),
          conversationModelProfileIds: withoutRecordKey(
            state.conversationModelProfileIds,
            action.conversationId,
          ),
        };
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(action.modelProfileId) ||
        state.conversationModelProfileIds[action.conversationId] ===
          action.modelProfileId
      ) {
        return state;
      }
      return {
        ...state,
        ...conversationActivityProjection(state, action.conversationId),
        conversationModelProfileIds: {
          ...state.conversationModelProfileIds,
          [action.conversationId]: action.modelProfileId,
        },
      };
    }
    case "draft/change":
      return { ...state, draft: action.value };
    case "attachment/add":
      if (
        state.draftAttachments.some(
          (attachment) => attachment.id === action.attachment.id,
        )
      ) {
        return state;
      }
      return {
        ...state,
        draftAttachments: [...state.draftAttachments, action.attachment],
      };
    case "attachment/remove":
      return {
        ...state,
        draftAttachments: state.draftAttachments.filter(
          (attachment) => attachment.id !== action.attachmentId,
        ),
      };
    case "attachment/clear":
      return { ...state, draftAttachments: [] };
    case "run/start": {
      if (
        !Object.hasOwn(state.conversationProjectIds, action.conversationId) ||
        !Object.hasOwn(state.messagesByConversation, action.conversationId) ||
        Object.hasOwn(state.activeRunsByConversation, action.conversationId) ||
        Object.keys(state.activeRunsByConversation).length >=
          MAX_ACTIVE_CONVERSATION_RUNS ||
        (action.request &&
          action.request.conversationId !== action.conversationId)
      ) {
        return state;
      }
      const next = action.message
        ? appendConversationMessage(
            state,
            action.conversationId,
            action.message,
          )
        : {
            messages: state.messages,
            messagesByConversation: state.messagesByConversation,
          };
      const request =
        action.request ??
        (action.message
          ? {
              conversationId: action.conversationId,
              content: action.message.content,
              attachments: (action.message.attachments ?? []).filter(
                (attachment) =>
                  isImageAttachment(attachment) ||
                  isTextFileAttachment(attachment),
              ),
              requiresAttachmentReselection: false,
              retryReason: "failed" as const,
            }
          : null);
      const ownsVisibleDraft =
        state.activeConversationId === action.conversationId;
      return withActiveConversationRun({
        ...state,
        ...next,
        ...conversationActivityProjection(state, action.conversationId),
        draft: ownsVisibleDraft ? "" : state.draft,
        activeRunsByConversation: {
          ...state.activeRunsByConversation,
          [action.conversationId]: {
            runId: action.runId,
            conversationId: action.conversationId,
            request,
            status: "runtime.messaging.status.connecting",
          },
        },
        retryableRunsByConversation: withoutRecordKey(
          state.retryableRunsByConversation,
          action.conversationId,
        ),
        runErrorsByConversation: withoutRecordKey(
          state.runErrorsByConversation,
          action.conversationId,
        ),
        draftAttachments: ownsVisibleDraft ? [] : state.draftAttachments,
      });
    }
    case "run/status": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (run?.runId !== action.runId) return state;
      return withActiveConversationRun({
        ...state,
        activeRunsByConversation: {
          ...state.activeRunsByConversation,
          [action.conversationId]: { ...run, status: action.status },
        },
      });
    }
    case "run/steer-queued": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (run?.runId !== action.runId) return state;
      const ownsVisibleDraft =
        state.activeConversationId === action.conversationId;
      const next = appendConversationMessage(
        state,
        action.conversationId,
        action.message,
      );
      return withActiveConversationRun({
        ...state,
        ...next,
        draft: ownsVisibleDraft ? "" : state.draft,
        draftAttachments: ownsVisibleDraft ? [] : state.draftAttachments,
        activeRunsByConversation: {
          ...state.activeRunsByConversation,
          [action.conversationId]: {
            ...run,
            status: "runtime.messaging.steer.queued",
          },
        },
      });
    }
    case "run/complete": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (
        run?.runId !== action.runId ||
        !Object.hasOwn(state.conversationProjectIds, action.conversationId) ||
        !Object.hasOwn(state.messagesByConversation, action.conversationId) ||
        (action.proposal &&
          (action.proposal.conversationId !== action.conversationId ||
            state.conversationProjectIds[action.conversationId] !==
              action.proposal.projectId))
      ) {
        return state;
      }
      const next = appendConversationMessage(
        state,
        action.conversationId,
        action.message,
      );
      return withActiveConversationRun({
        ...state,
        ...next,
        activeRunsByConversation: withoutRecordKey(
          state.activeRunsByConversation,
          action.conversationId,
        ),
        retryableRunsByConversation: withoutRecordKey(
          state.retryableRunsByConversation,
          action.conversationId,
        ),
        runErrorsByConversation: withoutRecordKey(
          state.runErrorsByConversation,
          action.conversationId,
        ),
        proposals: action.proposal
          ? {
              ...state.proposals,
              [action.proposal.id]: action.proposal,
            }
          : state.proposals,
      });
    }
    case "run/fail": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (run?.runId !== action.runId) return state;
      const partial = action.partialMessage
        ? appendConversationMessage(
            state,
            action.conversationId,
            action.partialMessage,
          )
        : {};
      return withActiveConversationRun({
        ...state,
        ...partial,
        activeRunsByConversation: withoutRecordKey(
          state.activeRunsByConversation,
          action.conversationId,
        ),
        retryableRunsByConversation: run.request
          ? {
              ...state.retryableRunsByConversation,
              [action.conversationId]: {
                ...run.request,
                retryReason: "failed",
              },
            }
          : withoutRecordKey(
              state.retryableRunsByConversation,
              action.conversationId,
            ),
        runErrorsByConversation: {
          ...state.runErrorsByConversation,
          [action.conversationId]: action.message,
        },
      });
    }
    case "run/interrupted": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (run?.runId !== action.runId) return state;
      const partial = action.partialMessage
        ? appendConversationMessage(
            state,
            action.conversationId,
            action.partialMessage,
          )
        : {};
      const retryableRunsByConversation = run.request
        ? {
            ...state.retryableRunsByConversation,
            [action.conversationId]: {
              ...run.request,
              retryReason: "interrupted" as const,
            },
          }
        : withoutRecordKey(
            state.retryableRunsByConversation,
            action.conversationId,
          );
      const retryable = retryableRunsByConversation[action.conversationId];
      return withActiveConversationRun({
        ...state,
        ...partial,
        activeRunsByConversation: withoutRecordKey(
          state.activeRunsByConversation,
          action.conversationId,
        ),
        retryableRunsByConversation,
        runErrorsByConversation: retryable
          ? {
              ...state.runErrorsByConversation,
              [action.conversationId]: retryable.requiresAttachmentReselection
                ? "runtime.messaging.run.interruptedAttachments"
                : "runtime.messaging.run.interrupted",
            }
          : state.runErrorsByConversation,
      });
    }
    case "run/cancel": {
      const run = state.activeRunsByConversation[action.conversationId];
      if (run?.runId !== action.runId) return state;
      const partial = action.partialMessage
        ? appendConversationMessage(
            state,
            action.conversationId,
            action.partialMessage,
          )
        : {};
      return withActiveConversationRun({
        ...state,
        ...partial,
        activeRunsByConversation: withoutRecordKey(
          state.activeRunsByConversation,
          action.conversationId,
        ),
        retryableRunsByConversation: withoutRecordKey(
          state.retryableRunsByConversation,
          action.conversationId,
        ),
        runErrorsByConversation: withoutRecordKey(
          state.runErrorsByConversation,
          action.conversationId,
        ),
      });
    }
    case "run/retry-dismiss":
      return withActiveConversationRun({
        ...state,
        retryableRunsByConversation: withoutRecordKey(
          state.retryableRunsByConversation,
          action.conversationId,
        ),
        runErrorsByConversation: withoutRecordKey(
          state.runErrorsByConversation,
          action.conversationId,
        ),
      });
    case "run/capacity-rejected":
      if (!Object.hasOwn(state.conversationProjectIds, action.conversationId)) {
        return state;
      }
      return withActiveConversationRun({
        ...state,
        runErrorsByConversation: {
          ...state.runErrorsByConversation,
          [action.conversationId]: "runtime.messaging.run.capacity",
        },
      });
    case "run/rejected":
      if (!Object.hasOwn(state.conversationProjectIds, action.conversationId)) {
        return state;
      }
      return withActiveConversationRun({
        ...state,
        runErrorsByConversation: {
          ...state.runErrorsByConversation,
          [action.conversationId]: action.message,
        },
      });
    case "memory/create-global":
    case "skill/create-global":
    case "memory/update-global":
    case "skill/update-global":
    case "skill/set-enabled":
      return reduceLibraryAction(state, action);
    case "connection/upsert": {
      const existing = state.connections[action.connection.id];
      const retainedResources = Object.fromEntries(
        Object.entries(state.resources).filter(
          ([, resource]) => resource.connectionId !== action.connection.id,
        ),
      );
      if (
        !state.projects[action.connection.projectId] ||
        isProjectWorkspaceConnectionId(action.connection.id) ||
        action.resources.some(
          (resource) => resource.storage.kind === "project-workspace",
        ) ||
        !hasValidConnectionBundle(action.connection, action.resources) ||
        (existing && existing.projectId !== action.connection.projectId) ||
        action.resources.some((resource) =>
          Object.hasOwn(retainedResources, resource.id),
        )
      ) {
        return state;
      }
      return {
        ...state,
        connections: {
          ...state.connections,
          [action.connection.id]: action.connection,
        },
        resources: {
          ...retainedResources,
          ...Object.fromEntries(
            action.resources.map((resource) => [resource.id, resource]),
          ),
        },
      };
    }
    case "resources/refreshed":
      return {
        ...state,
        resources: {
          ...state.resources,
          ...Object.fromEntries(
            action.resources.flatMap((resource) => {
              const current = state.resources[resource.id];
              const connection = state.connections[resource.connectionId];
              return current &&
                connection?.status === "connected" &&
                hasSameStorageBinding(current, resource) &&
                (current.storage.kind !== "project-workspace" ||
                  (current.content === resource.content &&
                    current.version === resource.version))
                ? [[resource.id, resource] as const]
                : [];
            }),
          ),
        },
      };
    case "proposal/auto-apply-start": {
      const changeProposal = state.proposals[action.proposalId];
      if (!changeProposal || changeProposal.status !== "pending") return state;
      const autoApplyingProposalIds = state.autoApplyingProposalIds.includes(
        changeProposal.id,
      )
        ? state.autoApplyingProposalIds
        : [...state.autoApplyingProposalIds, changeProposal.id];
      return {
        ...state,
        autoApplyingProposalId: changeProposal.id,
        autoApplyingProposalIds,
      };
    }
    case "proposal/auto-apply-failed": {
      const changeProposal = state.proposals[action.proposalId];
      const conversationId = changeProposal?.conversationId;
      if (!changeProposal || !conversationId) return state;
      const autoApplyingProposalIds = state.autoApplyingProposalIds.filter(
        (proposalId) => proposalId !== changeProposal.id,
      );
      return withActiveConversationRun({
        ...state,
        autoApplyingProposalId: autoApplyingProposalIds.at(-1) ?? null,
        autoApplyingProposalIds,
        runErrorsByConversation: {
          ...state.runErrorsByConversation,
          [conversationId]: action.message,
        },
      });
    }
    case "proposal/applied": {
      const changeProposal = state.proposals[action.proposalId];
      if (!changeProposal || changeProposal.status !== "pending") return state;
      const conversationId = changeProposal.conversationId;
      if (
        !conversationId ||
        state.conversationProjectIds[conversationId] !==
          changeProposal.projectId ||
        action.receipt.proposalId !== changeProposal.id ||
        action.receipt.projectId !== changeProposal.projectId ||
        action.receipt.conversationId !== conversationId ||
        action.checkpoint.projectId !== changeProposal.projectId ||
        action.checkpoint.conversationId !== conversationId
      ) {
        return state;
      }
      const conversationMessages = [
        ...(state.messagesByConversation[conversationId] ?? []),
        action.message,
      ];
      const autoApplyingProposalIds = state.autoApplyingProposalIds.filter(
        (proposalId) => proposalId !== changeProposal.id,
      );
      const resources = { ...state.resources };
      let workspaceResourceDelta = 0;
      let workspaceSkillDelta = 0;
      const createdSkillIds: string[] = [];
      const deletedSkillIds: string[] = [];
      const externalConnectionDeltas = new Map<string, number>();
      let invalidLifecycleChange = false;
      for (const change of action.receipt.changes) {
        const current = state.resources[change.resourceId];
        const applied = action.resources[change.resourceId];
        if (change.operation === "create") {
          const hunk = changeProposal.hunks.find(
            (candidate) => candidate.id === change.hunkId,
          );
          if (hunk?.createTarget) {
            const target = hunk.createTarget;
            const providerMatches = applied
              ? {
                  "google-docs": "google-doc",
                  "google-sheets": "google-sheet",
                  "google-slides": "google-slide",
                  notion: "notion-page",
                }[target.provider] === applied.storage.kind &&
                (applied.storage.kind === "google-doc" ||
                  applied.storage.kind === "google-sheet" ||
                  applied.storage.kind === "google-slide" ||
                  applied.storage.kind === "notion-page") &&
                applied.storage.accountId === target.accountId
              : false;
            if (
              current ||
              !applied ||
              applied.projectId !== changeProposal.projectId ||
              applied.connectionId !== target.connectorId ||
              !providerMatches ||
              isReadOnlyWorkspaceResource(applied)
            ) {
              invalidLifecycleChange = true;
              continue;
            }
            resources[change.resourceId] = applied;
            externalConnectionDeltas.set(
              target.connectorId,
              (externalConnectionDeltas.get(target.connectorId) ?? 0) + 1,
            );
            continue;
          }
          if (
            current ||
            !applied ||
            applied.projectId !== changeProposal.projectId ||
            applied.path !== change.target ||
            !isProjectWorkspaceResource(applied) ||
            isReadOnlyWorkspaceResource(applied)
          ) {
            invalidLifecycleChange = true;
            continue;
          }
          resources[change.resourceId] = applied;
          workspaceResourceDelta += 1;
          const createdSkill = projectSkillPath(applied.path);
          if (
            createdSkill &&
            validateProjectSkillDocument(applied.path, applied.content).valid
          ) {
            workspaceSkillDelta += 1;
            createdSkillIds.push(createdSkill.slug);
          }
          continue;
        }
        if (change.operation === "delete") {
          if (
            !current ||
            applied ||
            current.projectId !== changeProposal.projectId ||
            current.path !== change.target ||
            !isProjectWorkspaceResource(current) ||
            isReadOnlyWorkspaceResource(current)
          ) {
            invalidLifecycleChange = true;
            continue;
          }
          delete resources[change.resourceId];
          workspaceResourceDelta -= 1;
          const deletedSkill = projectSkillPath(current.path);
          if (deletedSkill) {
            workspaceSkillDelta -= 1;
            deletedSkillIds.push(deletedSkill.slug);
          }
          continue;
        }
        const connection = applied
          ? state.connections[applied.connectionId]
          : undefined;
        if (
          current &&
          applied &&
          connection?.status === "connected" &&
          !isReadOnlyWorkspaceResource(current) &&
          !isReadOnlyWorkspaceResource(applied) &&
          hasSameStorageBinding(current, applied)
        ) {
          resources[change.resourceId] = applied;
        }
      }
      if (invalidLifecycleChange) return state;
      const workspaceConnectionId = projectWorkspaceConnectionId(
        changeProposal.projectId,
      );
      const workspaceConnection = state.connections[workspaceConnectionId];
      const project = state.projects[changeProposal.projectId];
      if (
        workspaceResourceDelta !== 0 &&
        (!workspaceConnection ||
          workspaceConnection.status !== "connected" ||
          !project ||
          workspaceConnection.resourceCount + workspaceResourceDelta < 0 ||
          project.resourceCount + workspaceResourceDelta < 0 ||
          project.skillCount + workspaceSkillDelta < 0)
      ) {
        return state;
      }
      for (const [connectionId, delta] of externalConnectionDeltas) {
        const connection = state.connections[connectionId];
        if (
          !connection ||
          connection.projectId !== changeProposal.projectId ||
          connection.status !== "connected" ||
          connection.resourceCount + delta < 0
        ) {
          return state;
        }
      }
      const nextConnections = { ...state.connections };
      if (workspaceResourceDelta !== 0) {
        nextConnections[workspaceConnection!.id] = {
          ...workspaceConnection!,
          resourceCount:
            workspaceConnection!.resourceCount + workspaceResourceDelta,
        };
      }
      for (const [connectionId, delta] of externalConnectionDeltas) {
        const connection = state.connections[connectionId]!;
        nextConnections[connectionId] = {
          ...connection,
          resourceCount: connection.resourceCount + delta,
        };
      }
      return withActiveConversationRun({
        ...state,
        messages:
          state.activeConversationId === conversationId
            ? conversationMessages
            : state.messages,
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: conversationMessages,
        },
        resources,
        projects:
          workspaceResourceDelta === 0
            ? state.projects
            : {
                ...state.projects,
                [project!.id]: {
                  ...project!,
                  resourceCount:
                    project!.resourceCount + workspaceResourceDelta,
                  skillCount: project!.skillCount + workspaceSkillDelta,
                },
              },
        projectSkillEnabledByProjectId:
          createdSkillIds.length === 0 && deletedSkillIds.length === 0
            ? state.projectSkillEnabledByProjectId
            : {
                ...state.projectSkillEnabledByProjectId,
                [changeProposal.projectId]: Object.fromEntries(
                  Object.entries({
                    ...state.projectSkillEnabledByProjectId[
                      changeProposal.projectId
                    ],
                    ...Object.fromEntries(
                      createdSkillIds.map((skillId) => [skillId, true]),
                    ),
                  }).filter(([skillId]) => !deletedSkillIds.includes(skillId)),
                ),
              },
        connections:
          workspaceResourceDelta === 0 && externalConnectionDeltas.size === 0
            ? state.connections
            : nextConnections,
        proposals: {
          ...state.proposals,
          [changeProposal.id]: {
            ...changeProposal,
            status: "applied",
            appliedReceiptId: action.receipt.id,
          },
        },
        receipts: {
          ...state.receipts,
          [action.receipt.id]: action.receipt,
        },
        conversationCheckpoints: {
          ...state.conversationCheckpoints,
          [action.checkpoint.conversationId]: action.checkpoint,
        },
        lastReceiptId: action.receipt.id,
        autoApplyingProposalId: autoApplyingProposalIds.at(-1) ?? null,
        autoApplyingProposalIds,
        runErrorsByConversation: withoutRecordKey(
          state.runErrorsByConversation,
          conversationId,
        ),
      });
    }
    case "proposal/restore-created": {
      const conversationId = action.proposal.conversationId;
      if (
        !conversationId ||
        state.conversationProjectIds[conversationId] !==
          action.proposal.projectId
      ) {
        return state;
      }
      return {
        ...state,
        proposals: {
          ...state.proposals,
          [action.proposal.id]: action.proposal,
        },
      };
    }
    case "proposal/capability-created": {
      const { proposal } = action;
      const install = proposal.capabilityInstall;
      const conversationId = proposal.conversationId;
      const project = state.projects[proposal.projectId];
      const workspaceConnectionId = project
        ? projectWorkspaceConnectionId(project.id)
        : null;
      const workspaceConnection = workspaceConnectionId
        ? state.connections[workspaceConnectionId]
        : undefined;
      const conversationExists = conversationId
        ? Object.hasOwn(state.conversationProjectIds, conversationId)
        : false;
      const targets = new Set<string>();
      const resourceIds = new Set<string>();
      let totalBytes = 0;
      let skillDocumentCount = 0;
      const filesValid = Boolean(
        install &&
        proposal.hunks.length === install.fileCount &&
        proposal.hunks.every((hunk) => {
          if (
            hunk.operation !== "create" ||
            hunk.createTarget ||
            hunk.baseVersion !== PROJECT_WORKSPACE_ABSENT_VERSION ||
            hunk.before !== "" ||
            targets.has(hunk.target) ||
            resourceIds.has(hunk.resourceId) ||
            !isSafeProjectWorkspacePath(hunk.target) ||
            !hunk.target.startsWith(`skills/${install.skillId}/`) ||
            Object.values(state.resources).some(
              (resource) =>
                resource.projectId === proposal.projectId &&
                resource.path === hunk.target,
            )
          ) {
            return false;
          }
          const sourcePath = hunk.target.slice(
            `skills/${install.skillId}/`.length,
          );
          const expected = createProjectWorkspaceFileResource({
            projectId: proposal.projectId,
            path: hunk.target,
            content: "",
            version: PROJECT_WORKSPACE_ABSENT_VERSION,
          });
          if (hunk.resourceId !== expected.id || !sourcePath) return false;
          if (hunk.binaryFile) {
            if (
              hunk.binaryFile.source.kind !== "third-party-skill" ||
              hunk.binaryFile.source.skillId !== install.skillId ||
              hunk.binaryFile.source.bundleSha256 !== install.bundleSha256 ||
              hunk.binaryFile.source.path !== sourcePath
            ) {
              return false;
            }
            try {
              createVerifiedProjectWorkspaceBinaryFileResource({
                binary: hunk.binaryFile,
                contentBase64: hunk.after,
                path: hunk.target,
                projectId: proposal.projectId,
                version: PROJECT_WORKSPACE_ABSENT_VERSION,
              });
            } catch {
              return false;
            }
            totalBytes += hunk.binaryFile.byteLength;
          } else {
            if (hunk.after.includes("\0") || hunk.after.length > 100_000) {
              return false;
            }
            totalBytes += new TextEncoder().encode(hunk.after).byteLength;
          }
          if (sourcePath === "SKILL.md") {
            if (
              hunk.binaryFile ||
              !validateProjectSkillDocument(hunk.target, hunk.after).valid
            ) {
              return false;
            }
            skillDocumentCount += 1;
          }
          targets.add(hunk.target);
          resourceIds.add(hunk.resourceId);
          return true;
        }),
      );
      if (
        proposal.kind !== "capability" ||
        proposal.status !== "pending" ||
        !install ||
        install.kind !== "skill" ||
        !/^[a-f0-9]{64}$/u.test(install.bundleSha256) ||
        !project ||
        workspaceConnection?.status !== "connected" ||
        proposal.connectorId !== workspaceConnectionId ||
        !isProjectWorkspaceConnectionId(proposal.connectorId) ||
        !conversationId ||
        (conversationExists &&
          state.conversationProjectIds[conversationId] !==
            proposal.projectId) ||
        Boolean(state.proposals[proposal.id]) ||
        !filesValid ||
        skillDocumentCount !== 1 ||
        totalBytes !== install.totalBytes
      ) {
        return state;
      }
      return {
        ...state,
        conversationIdsByProject: conversationExists
          ? state.conversationIdsByProject
          : {
              ...state.conversationIdsByProject,
              [proposal.projectId]: conversationId,
            },
        conversationProjectIds: conversationExists
          ? state.conversationProjectIds
          : {
              ...state.conversationProjectIds,
              [conversationId]: proposal.projectId,
            },
        messagesByConversation: conversationExists
          ? state.messagesByConversation
          : {
              ...state.messagesByConversation,
              [conversationId]: [],
            },
        proposals: {
          ...state.proposals,
          [proposal.id]: proposal,
        },
      };
    }
    case "proposal/manual-created": {
      const { proposal } = action;
      const conversationId = proposal.conversationId;
      const hunk = proposal.hunks[0];
      const resource = hunk ? state.resources[hunk.resourceId] : undefined;
      const project = state.projects[proposal.projectId];
      const workspaceConnectionId = project
        ? projectWorkspaceConnectionId(project.id)
        : null;
      const workspaceConnection = workspaceConnectionId
        ? state.connections[workspaceConnectionId]
        : undefined;
      const duplicateCreateTarget = hunk
        ? Object.values(state.resources).some(
            (candidate) =>
              candidate.projectId === proposal.projectId &&
              candidate.path === hunk.target,
          )
        : false;
      let expectedCreatedResourceId: string | null = null;
      if (
        hunk &&
        project &&
        isSafeProjectWorkspacePath(hunk.target) &&
        !hunk.after.includes("\0") &&
        hunk.after.length <= 100_000
      ) {
        expectedCreatedResourceId = createProjectWorkspaceFileResource({
          projectId: project.id,
          path: hunk.target,
          content: "",
          version: PROJECT_WORKSPACE_ABSENT_VERSION,
        }).id;
      }
      const creatingProjectFile = Boolean(
        hunk &&
        project &&
        workspaceConnection?.status === "connected" &&
        hunk.operation === "create" &&
        !hunk.createTarget &&
        !hunk.binaryFile &&
        !resource &&
        !duplicateCreateTarget &&
        proposal.connectorId === workspaceConnectionId &&
        hunk.resourceId === expectedCreatedResourceId &&
        hunk.baseVersion === PROJECT_WORKSPACE_ABSENT_VERSION &&
        hunk.before === "" &&
        hunk.after !== "" &&
        isProjectWorkspaceConnectionId(proposal.connectorId) &&
        (!projectSkillPath(hunk.target) ||
          validateProjectSkillDocument(hunk.target, hunk.after).valid),
      );
      const editingProjectFile = Boolean(
        hunk &&
        resource &&
        !hunk.operation &&
        !isReadOnlyWorkspaceResource(resource) &&
        resource.projectId === proposal.projectId &&
        resource.connectionId === proposal.connectorId &&
        resource.path === hunk.target &&
        resource.version === hunk.baseVersion &&
        resource.content === hunk.before &&
        hunk.after !== hunk.before,
      );
      const conversationExists = conversationId
        ? Object.hasOwn(state.conversationProjectIds, conversationId)
        : false;
      if (
        proposal.kind !== "manual" ||
        proposal.status !== "pending" ||
        !conversationId ||
        (conversationExists &&
          state.conversationProjectIds[conversationId] !==
            proposal.projectId) ||
        Boolean(state.proposals[proposal.id]) ||
        proposal.hunks.length !== 1 ||
        !hunk ||
        (!creatingProjectFile && !editingProjectFile)
      ) {
        return state;
      }
      return {
        ...state,
        conversationIdsByProject: conversationExists
          ? state.conversationIdsByProject
          : {
              ...state.conversationIdsByProject,
              [proposal.projectId]: conversationId,
            },
        conversationProjectIds: conversationExists
          ? state.conversationProjectIds
          : {
              ...state.conversationProjectIds,
              [conversationId]: proposal.projectId,
            },
        messagesByConversation: conversationExists
          ? state.messagesByConversation
          : {
              ...state.messagesByConversation,
              [conversationId]: [],
            },
        proposals: {
          ...state.proposals,
          [proposal.id]: proposal,
        },
      };
    }
  }
}
