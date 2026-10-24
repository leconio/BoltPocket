import type { AppState } from "./app-state-model.ts";
import type { ChatMessage } from "./models.ts";

function orderedKnownIds(
  preferred: readonly string[],
  fallback: readonly string[],
  exists: (id: string) => boolean,
) {
  const seen = new Set<string>();
  return [...preferred, ...fallback].filter((id) => {
    if (seen.has(id) || !exists(id)) return false;
    seen.add(id);
    return true;
  });
}

export function getPinnedProjects(
  state: Pick<AppState, "pinnedProjectIds" | "projects">,
) {
  return orderedKnownIds(state.pinnedProjectIds, [], (projectId) =>
    Boolean(state.projects[projectId]),
  ).map((projectId) => state.projects[projectId]!);
}

export function getRecentProjects(
  state: Pick<AppState, "recentProjectIds" | "projects">,
) {
  return orderedKnownIds(
    state.recentProjectIds,
    Object.keys(state.projects).reverse(),
    (projectId) => Boolean(state.projects[projectId]),
  ).map((projectId) => state.projects[projectId]!);
}

export function getRecentConversationIds(
  state: Pick<
    AppState,
    | "conversationProjectIds"
    | "messagesByConversation"
    | "recentConversationIds"
  >,
) {
  const explicitlyRecent = new Set(state.recentConversationIds);
  return orderedKnownIds(
    state.recentConversationIds,
    Object.keys(state.messagesByConversation).reverse(),
    (conversationId) =>
      Object.hasOwn(state.conversationProjectIds, conversationId) &&
      Object.hasOwn(state.messagesByConversation, conversationId) &&
      (explicitlyRecent.has(conversationId) ||
        (state.messagesByConversation[conversationId]?.length ?? 0) > 0),
  );
}

function hasDurableConversationActivity(
  state: AppState,
  conversationId: string,
) {
  if (
    !Object.hasOwn(state.conversationProjectIds, conversationId) ||
    !Object.hasOwn(state.messagesByConversation, conversationId)
  ) {
    return false;
  }
  return (
    state.recentConversationIds.includes(conversationId) ||
    (state.messagesByConversation[conversationId]?.length ?? 0) > 0 ||
    Object.hasOwn(state.conversationModelProfileIds, conversationId) ||
    Object.hasOwn(state.activeRunsByConversation, conversationId) ||
    Object.hasOwn(state.retryableRunsByConversation, conversationId) ||
    Object.hasOwn(state.runErrorsByConversation, conversationId) ||
    Object.hasOwn(state.conversationCheckpoints, conversationId) ||
    Object.values(state.proposals).some(
      (proposal) => proposal.conversationId === conversationId,
    )
  );
}

export function isUntouchedConversation(
  state: AppState,
  conversationId: string,
) {
  if (
    !Object.hasOwn(state.conversationProjectIds, conversationId) ||
    hasDurableConversationActivity(state, conversationId)
  ) {
    return false;
  }
  if (state.activeConversationId !== conversationId) return true;
  return state.draft.length === 0 && state.draftAttachments.length === 0;
}

export function getLatestProposalForProject(
  state: Pick<AppState, "proposals">,
  projectId: string,
) {
  return Object.values(state.proposals)
    .filter((item) => item.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function summarizeConversationText(value: string, maximum: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = [...normalized];
  if (characters.length <= maximum) return normalized;
  return `${characters.slice(0, maximum - 1).join("")}…`;
}

export function getProjectConversationIds(
  state: Pick<
    AppState,
    | "conversationIdsByProject"
    | "conversationProjectIds"
    | "messagesByConversation"
    | "recentConversationIds"
  >,
  projectId: string,
) {
  const latest = state.conversationIdsByProject[projectId];
  const explicitlyRecent = new Set(state.recentConversationIds);
  return orderedKnownIds(
    [...state.recentConversationIds, ...(latest ? [latest] : [])],
    Object.keys(state.conversationProjectIds).reverse(),
    (conversationId) =>
      state.conversationProjectIds[conversationId] === projectId &&
      Object.hasOwn(state.messagesByConversation, conversationId) &&
      (explicitlyRecent.has(conversationId) ||
        (state.messagesByConversation[conversationId]?.length ?? 0) > 0),
  );
}

export function getConversationTitle(
  state: Pick<AppState, "messagesByConversation">,
  conversationId: string,
) {
  return getConversationTitleFromMessages(
    state.messagesByConversation[conversationId] ?? [],
  );
}

export function getConversationTitleFromMessages(
  messages: readonly ChatMessage[],
) {
  const seed =
    messages.find(
      (message) => message.role === "user" && message.content.trim(),
    ) ?? messages.find((message) => message.content.trim());
  return seed ? summarizeConversationText(seed.content, 36) : "";
}

export function getConversationPreview(
  state: Pick<AppState, "messagesByConversation">,
  conversationId: string,
) {
  const messages = state.messagesByConversation[conversationId] ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.content.trim()) {
      return summarizeConversationText(message.content, 72);
    }
  }
  return "";
}
