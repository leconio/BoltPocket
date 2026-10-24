import { PersistedAppStateError } from "./persisted-app-state-validation";

export const PREVIOUS_APP_STATE_KEY = "app-state:v1";
export const PREVIOUS_APP_STATE_MIGRATION_KEY = "app-state:v1:migrated-to-v2";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migratePersistedAppState(
  value: string,
  maxSnapshotBytes: number,
) {
  if (new TextEncoder().encode(value).byteLength > maxSnapshotBytes) {
    throw new PersistedAppStateError("Saved app state exceeds its size limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PersistedAppStateError("Saved app state is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.version !== "number" ||
    ![1, 2, 3, 4, 5].includes(parsed.version)
  ) {
    const foundVersion =
      isRecord(parsed) &&
      (typeof parsed.version === "number" || typeof parsed.version === "string")
        ? String(parsed.version).slice(0, 16)
        : "unknown";
    throw new PersistedAppStateError(
      `Saved app state version ${foundVersion} is not supported.`,
    );
  }
  if (parsed.version === 5) {
    return { fromVersion: 5, migrated: false, payload: parsed } as const;
  }

  const fromVersion = parsed.version;
  const payload: JsonRecord = { ...parsed, version: 5 };
  if (
    Object.hasOwn(payload, "projectArtifacts") &&
    !Array.isArray(payload.projectArtifacts)
  ) {
    throw new PersistedAppStateError(
      `Saved version ${fromVersion} state has invalid project artifacts.`,
    );
  }
  delete payload.projectArtifacts;

  if (fromVersion === 1) delete payload.workflows;
  if (!Array.isArray(payload.conversations)) {
    throw new PersistedAppStateError(
      `Saved version ${fromVersion} state has invalid conversations.`,
    );
  }
  const conversations = payload.conversations.map((conversation) => {
    if (!isRecord(conversation)) return conversation;
    const {
      mode: _legacyMode,
      workflowId: _legacyWorkflowId,
      ...currentConversation
    } = conversation;
    if (!Array.isArray(currentConversation.messages)) {
      return currentConversation;
    }
    return {
      ...currentConversation,
      messages: currentConversation.messages.map((message) => {
        if (!isRecord(message)) return message;
        const { workflowId: _messageWorkflowId, ...currentMessage } = message;
        return currentMessage;
      }),
    };
  });
  payload.conversations = conversations;

  const hasCompleteProjectStorage =
    Array.isArray(payload.projects) &&
    Array.isArray(payload.workspaceResources) &&
    (payload.projects.length === 0 || payload.workspaceResources.length > 0);
  if (!hasCompleteProjectStorage) {
    payload.projects = [];
    payload.workspaceResources = [];
    payload.selectedProjectId = null;
    payload.pinnedProjectIds = [];
    payload.recentProjectIds = [];
    payload.projectConversations = [];
    payload.projectSkillSettings = [];
    payload.projectResourcePackSettings = [];
    payload.proposals = [];
    payload.receipts = [];
    payload.checkpoints = [];
    payload.lastReceiptId = null;
    payload.conversations = conversations.map((conversation) =>
      isRecord(conversation)
        ? { ...conversation, projectId: null }
        : conversation,
    );
  }

  for (const key of [
    "projects",
    "workspaceResources",
    "projectConversations",
    "skillSettings",
    "proposals",
    "receipts",
    "checkpoints",
    "pendingRuns",
    "retryableRuns",
  ]) {
    if (!Object.hasOwn(payload, key)) payload[key] = [];
  }
  if (!Object.hasOwn(payload, "lastReceiptId")) payload.lastReceiptId = null;

  return {
    fromVersion,
    migrated: true,
    payload,
  } as const;
}
