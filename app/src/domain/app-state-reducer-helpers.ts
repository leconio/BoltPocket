import {
  builtInMemories,
  builtInSkills,
  localizeSkillCatalog,
} from "./library-catalog.ts";
import type { AppLocale } from "../i18n/translate.ts";
import type {
  ChatMessage,
  ConnectionItem,
  Project,
  RetryableAgentRun,
  WorkspaceResource,
} from "./models.ts";
import {
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  projectWorkspaceConnectionId,
} from "./project-workspace.ts";
import type { AppState } from "./app-state-model.ts";

const MAX_RECENT_ITEMS = 500;

export function promoteRecentId(ids: string[], id: string) {
  if (ids[0] === id) return ids;
  return [id, ...ids.filter((candidate) => candidate !== id)].slice(
    0,
    MAX_RECENT_ITEMS,
  );
}

export function appendConversationMessage(
  state: AppState,
  conversationId: string,
  message: ChatMessage,
) {
  const messages = [
    ...(state.messagesByConversation[conversationId] ?? []),
    message,
  ];
  return {
    messages:
      state.activeConversationId === conversationId ? messages : state.messages,
    messagesByConversation: {
      ...state.messagesByConversation,
      [conversationId]: messages,
    },
  };
}

export function hasSameStorageBinding(
  current: WorkspaceResource,
  refreshed: WorkspaceResource,
) {
  if (
    current.projectId !== refreshed.projectId ||
    current.connectionId !== refreshed.connectionId ||
    current.storage.kind !== refreshed.storage.kind
  ) {
    return false;
  }
  if (
    current.storage.kind === "native-file" &&
    refreshed.storage.kind === "native-file"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.access === refreshed.storage.access
    );
  }
  if (
    current.storage.kind === "google-doc" &&
    refreshed.storage.kind === "google-doc"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.documentId === refreshed.storage.documentId &&
      current.storage.accountId === refreshed.storage.accountId
    );
  }
  if (
    current.storage.kind === "google-sheet" &&
    refreshed.storage.kind === "google-sheet"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.spreadsheetId === refreshed.storage.spreadsheetId &&
      current.storage.sheetId === refreshed.storage.sheetId &&
      current.storage.accountId === refreshed.storage.accountId
    );
  }
  if (
    current.storage.kind === "google-slide" &&
    refreshed.storage.kind === "google-slide"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.presentationId === refreshed.storage.presentationId &&
      current.storage.accountId === refreshed.storage.accountId
    );
  }
  if (
    current.storage.kind === "notion-page" &&
    refreshed.storage.kind === "notion-page"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.pageId === refreshed.storage.pageId &&
      current.storage.accountId === refreshed.storage.accountId
    );
  }
  if (
    current.storage.kind === "source-file" &&
    refreshed.storage.kind === "source-file"
  ) {
    return (
      current.storage.locator === refreshed.storage.locator &&
      current.storage.snapshotId === refreshed.storage.snapshotId &&
      current.storage.sourceKind === refreshed.storage.sourceKind &&
      current.storage.sourceLabel === refreshed.storage.sourceLabel &&
      current.storage.revision === refreshed.storage.revision
    );
  }
  if (
    current.storage.kind === "project-workspace" &&
    refreshed.storage.kind === "project-workspace"
  ) {
    return (
      current.path === refreshed.path &&
      JSON.stringify(current.storage.binary ?? null) ===
        JSON.stringify(refreshed.storage.binary ?? null)
    );
  }
  return current.path === refreshed.path;
}

export function hasValidConnectionBundle(
  connection: ConnectionItem,
  resources: readonly WorkspaceResource[],
) {
  if (
    connection.resourceCount !== resources.length ||
    (connection.status === "attention" && resources.length !== 0) ||
    new Set(resources.map((resource) => resource.id)).size !== resources.length
  ) {
    return false;
  }
  return resources.every(
    (resource) =>
      resource.projectId === connection.projectId &&
      resource.connectionId === connection.id,
  );
}

export function hasValidProjectWorkspaceBundle(
  project: Project,
  connection: ConnectionItem,
  resources: readonly WorkspaceResource[],
) {
  try {
    const paths = new Set(resources.map((resource) => resource.path));
    return (
      connection.id === projectWorkspaceConnectionId(project.id) &&
      connection.projectId === project.id &&
      hasValidConnectionBundle(connection, resources) &&
      resources.every(
        (resource) =>
          isProjectWorkspaceResource(resource) &&
          isSafeProjectWorkspacePath(resource.path),
      ) &&
      paths.size === resources.length &&
      paths.has("AGENTS.md") &&
      paths.has("MEMORY.md") &&
      paths.has("NOTES.md") &&
      paths.has("memory/RECENT.md") &&
      paths.has("memory/SUMMARIES.md") &&
      paths.has("memory/EVIDENCE.md") &&
      [...paths].some((path) =>
        /^skills\/[a-z0-9][a-z0-9._-]{0,79}\/SKILL\.md$/u.test(path),
      )
    );
  } catch {
    return false;
  }
}

export function retryErrorForConversation(
  retryableRun: RetryableAgentRun | null,
  conversationId: string,
) {
  if (retryableRun?.conversationId !== conversationId) return null;
  if (retryableRun.retryReason === "interrupted") {
    return retryableRun.requiresAttachmentReselection
      ? "runtime.messaging.retry.interruptedAttachments"
      : "runtime.messaging.retry.interrupted";
  }
  return retryableRun.requiresAttachmentReselection
    ? "runtime.messaging.retry.failedAttachments"
    : "runtime.messaging.retry.failed";
}

export function conversationRunProjection(
  state: Pick<
    AppState,
    | "activeRunsByConversation"
    | "retryableRunsByConversation"
    | "runErrorsByConversation"
  >,
  conversationId: string,
) {
  const activeRun = state.activeRunsByConversation[conversationId] ?? null;
  const retryableRun =
    state.retryableRunsByConversation[conversationId] ?? null;
  return {
    isRunning: activeRun !== null,
    activeRunId: activeRun?.runId ?? null,
    activeRunConversationId: activeRun?.conversationId ?? null,
    activeRunRequest: activeRun?.request ?? null,
    retryableRun,
    runStatus: activeRun?.status ?? "",
    runError:
      state.runErrorsByConversation[conversationId] ??
      retryErrorForConversation(retryableRun, conversationId),
  };
}

export function conversationActivityProjection(
  state: AppState,
  conversationId: string,
) {
  const projectId = state.conversationProjectIds[conversationId] ?? null;
  return {
    conversationIdsByProject:
      projectId && state.conversationIdsByProject[projectId] !== conversationId
        ? {
            ...state.conversationIdsByProject,
            [projectId]: conversationId,
          }
        : state.conversationIdsByProject,
    recentProjectIds: projectId
      ? promoteRecentId(state.recentProjectIds, projectId)
      : state.recentProjectIds,
    recentConversationIds: promoteRecentId(
      state.recentConversationIds,
      conversationId,
    ),
  };
}

export function hasProjectSkill(
  state: AppState,
  projectId: string,
  skillId: string,
) {
  if (
    state.projects[projectId] &&
    getSkillCatalog(state).some(
      (skill) => skill.id === skillId && skill.scope === "global",
    )
  ) {
    return true;
  }
  return Object.values(state.resources).some((resource) => {
    if (
      resource.projectId !== projectId ||
      !isProjectWorkspaceResource(resource)
    ) {
      return false;
    }
    const match =
      /^(?:skills|\.agents\/skills)\/([a-z0-9][a-z0-9._-]{0,79})(?:\/[^/]+)?\/SKILL\.md$/u.exec(
        resource.path,
      );
    return match?.[1] === skillId;
  });
}

export function getMemoryCatalog(
  state: Pick<AppState, "customGlobalMemories" | "globalMemoryTextById">,
) {
  return [
    ...builtInMemories.map((memory) =>
      memory.scope === "global" &&
      Object.hasOwn(state.globalMemoryTextById, memory.id)
        ? { ...memory, text: state.globalMemoryTextById[memory.id]! }
        : memory,
    ),
    ...Object.values(state.customGlobalMemories),
  ];
}

export function getSkillCatalog(
  state: Pick<AppState, "customGlobalSkills" | "globalSkillContentById">,
  locale?: AppLocale,
) {
  const catalog = [
    ...builtInSkills.map((skill) =>
      skill.scope === "global" &&
      Object.hasOwn(state.globalSkillContentById, skill.id)
        ? { ...skill, content: state.globalSkillContentById[skill.id]! }
        : skill,
    ),
    ...Object.values(state.customGlobalSkills),
  ];
  return locale ? localizeSkillCatalog(catalog, locale) : catalog;
}

export function activateProjectConversation(
  state: AppState,
  projectId: string | null,
  conversationId: string,
  messages: ChatMessage[],
) {
  const conversationProjectIds = Object.is(
    state.conversationProjectIds[conversationId],
    projectId,
  )
    ? state.conversationProjectIds
    : {
        ...state.conversationProjectIds,
        [conversationId]: projectId,
      };
  const messagesByConversation =
    state.messagesByConversation[conversationId] === messages
      ? state.messagesByConversation
      : {
          ...state.messagesByConversation,
          [conversationId]: messages,
        };
  return {
    ...state,
    selectedProjectId: projectId,
    activeConversationId: conversationId,
    conversationProjectIds,
    messages,
    messagesByConversation,
    draft: "",
    ...conversationRunProjection(state, conversationId),
    draftAttachments: [],
  };
}
