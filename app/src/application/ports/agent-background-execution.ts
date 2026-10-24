export interface AgentBackgroundExecution {
  syncActiveConversations(conversationIds: readonly string[]): Promise<void>;
  subscribeToExpiration(listener: () => void): () => void;
  stop(): Promise<void>;
}
