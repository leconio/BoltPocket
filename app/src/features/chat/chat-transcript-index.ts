import {
  getConversationTitleFromMessages,
  type AppState,
} from "@/domain/app-state";
import type { ChangeProposal, ChatMessage } from "@/domain/models";

const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);

type TranscriptIndex = Readonly<{
  byId: ReadonlyMap<string, ChatMessage>;
  ids: readonly string[];
  primaryMessageByProposalId: ReadonlyMap<string, string>;
  title: string;
}>;

const indexes = new WeakMap<readonly ChatMessage[], TranscriptIndex>();

export function conversationMessages(
  state: AppState,
  conversationId: string,
): readonly ChatMessage[] {
  return state.messagesByConversation[conversationId] ?? EMPTY_MESSAGES;
}

export function transcriptIndex(messages: readonly ChatMessage[]) {
  const cached = indexes.get(messages);
  if (cached) return cached;

  const byId = new Map<string, ChatMessage>();
  const primaryMessageByProposalId = new Map<string, string>();
  const ids = messages.map((message) => {
    byId.set(message.id, message);
    if (
      message.proposalId &&
      !primaryMessageByProposalId.has(message.proposalId)
    ) {
      primaryMessageByProposalId.set(message.proposalId, message.id);
    }
    return message.id;
  });
  const index: TranscriptIndex = Object.freeze({
    byId,
    ids: Object.freeze(ids),
    primaryMessageByProposalId,
    title: getConversationTitleFromMessages(messages),
  });
  indexes.set(messages, index);
  return index;
}

export type ChatMessageRowSelection = Readonly<{
  message: ChatMessage | null;
  proposal: ChangeProposal | undefined;
}>;

export function createChatMessageRowSelector(
  conversationId: string,
  messageId: string,
) {
  let selection: ChatMessageRowSelection | undefined;

  return (state: AppState): ChatMessageRowSelection => {
    const index = transcriptIndex(conversationMessages(state, conversationId));
    const message = index.byId.get(messageId) ?? null;
    const proposal =
      message?.proposalId &&
      index.primaryMessageByProposalId.get(message.proposalId) === messageId
        ? state.proposals[message.proposalId]
        : undefined;
    if (
      selection &&
      selection.message === message &&
      selection.proposal === proposal
    ) {
      return selection;
    }
    selection = Object.freeze({ message, proposal });
    return selection;
  };
}
