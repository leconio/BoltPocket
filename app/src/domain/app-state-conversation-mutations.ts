import type { AppAction, AppState } from "./app-state-model.ts";
import {
  conversationRunProjection,
  promoteRecentId,
} from "./app-state-reducer-helpers.ts";

type DeleteConversationAction = Extract<
  AppAction,
  { type: "conversation/delete" }
>;
type ClaimConversationAction = Extract<
  AppAction,
  { type: "conversation/claim-project" }
>;

function withoutRecordKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export function deleteConversationState(
  state: AppState,
  action: DeleteConversationAction,
): AppState {
  if (
    !Object.hasOwn(state.conversationProjectIds, action.conversationId) ||
    !action.replacementConversationId ||
    Object.hasOwn(
      state.conversationProjectIds,
      action.replacementConversationId,
    ) ||
    state.autoApplyingProposalIds.some(
      (proposalId) =>
        state.proposals[proposalId]?.conversationId === action.conversationId,
    )
  ) {
    return state;
  }
  const ownerProjectId =
    state.conversationProjectIds[action.conversationId] ?? null;
  const remainingConversationIds = Object.keys(
    state.conversationProjectIds,
  ).filter((conversationId) => conversationId !== action.conversationId);
  const recentConversationIds = state.recentConversationIds.filter(
    (conversationId) => conversationId !== action.conversationId,
  );
  const fallbackConversationId =
    recentConversationIds.find((conversationId) =>
      remainingConversationIds.includes(conversationId),
    ) ??
    remainingConversationIds[0] ??
    action.replacementConversationId;
  const createsReplacement = remainingConversationIds.length === 0;
  const conversationProjectIds = withoutRecordKey(
    state.conversationProjectIds,
    action.conversationId,
  );
  const messagesByConversation = withoutRecordKey(
    state.messagesByConversation,
    action.conversationId,
  );
  if (createsReplacement) {
    conversationProjectIds[fallbackConversationId] = null;
    messagesByConversation[fallbackConversationId] = [];
  }
  const conversationIdsByProject = { ...state.conversationIdsByProject };
  if (
    ownerProjectId &&
    conversationIdsByProject[ownerProjectId] === action.conversationId
  ) {
    const nextProjectConversation = [
      ...recentConversationIds,
      ...remainingConversationIds,
    ].find(
      (conversationId) =>
        conversationProjectIds[conversationId] === ownerProjectId,
    );
    if (nextProjectConversation) {
      conversationIdsByProject[ownerProjectId] = nextProjectConversation;
    } else {
      delete conversationIdsByProject[ownerProjectId];
    }
  }
  const removedProposalIds = new Set(
    Object.values(state.proposals)
      .filter((proposal) => proposal.conversationId === action.conversationId)
      .map((proposal) => proposal.id),
  );
  const proposals = Object.fromEntries(
    Object.entries(state.proposals).filter(
      ([proposalId]) => !removedProposalIds.has(proposalId),
    ),
  );
  const receipts = Object.fromEntries(
    Object.entries(state.receipts).filter(
      ([, receipt]) => !removedProposalIds.has(receipt.proposalId),
    ),
  );
  const nextActiveConversationId =
    state.activeConversationId === action.conversationId
      ? fallbackConversationId
      : state.activeConversationId;
  const next: AppState = {
    ...state,
    conversationIdsByProject,
    conversationProjectIds,
    conversationModelProfileIds: withoutRecordKey(
      state.conversationModelProfileIds,
      action.conversationId,
    ),
    messagesByConversation,
    recentConversationIds: createsReplacement
      ? [fallbackConversationId]
      : recentConversationIds,
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
    proposals,
    receipts,
    conversationCheckpoints: withoutRecordKey(
      state.conversationCheckpoints,
      action.conversationId,
    ),
    lastReceiptId:
      state.lastReceiptId && receipts[state.lastReceiptId]
        ? state.lastReceiptId
        : null,
    activeConversationId: nextActiveConversationId,
  };
  if (state.activeConversationId !== action.conversationId) return next;
  return {
    ...next,
    selectedProjectId: conversationProjectIds[nextActiveConversationId] ?? null,
    messages: messagesByConversation[nextActiveConversationId] ?? [],
    draft: "",
    ...conversationRunProjection(next, nextActiveConversationId),
    draftAttachments: [],
  };
}

export function claimConversationState(
  state: AppState,
  action: ClaimConversationAction,
): AppState {
  if (
    !state.projects[action.projectId] ||
    state.conversationProjectIds[action.conversationId] !== null ||
    Object.hasOwn(state.activeRunsByConversation, action.conversationId) ||
    Object.hasOwn(state.retryableRunsByConversation, action.conversationId) ||
    Object.values(state.proposals).some(
      (proposal) => proposal.conversationId === action.conversationId,
    )
  ) {
    return state;
  }
  const ownsActiveConversation =
    state.activeConversationId === action.conversationId;
  return {
    ...state,
    conversationProjectIds: {
      ...state.conversationProjectIds,
      [action.conversationId]: action.projectId,
    },
    conversationIdsByProject: {
      ...state.conversationIdsByProject,
      [action.projectId]: action.conversationId,
    },
    selectedProjectId: ownsActiveConversation
      ? action.projectId
      : state.selectedProjectId,
    recentProjectIds: promoteRecentId(state.recentProjectIds, action.projectId),
    recentConversationIds: promoteRecentId(
      state.recentConversationIds,
      action.conversationId,
    ),
  };
}
