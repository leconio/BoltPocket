export function agentSessionIdForConversation(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) throw new Error("Agent conversation ID is required.");
  return `conversation:${normalized}`;
}
