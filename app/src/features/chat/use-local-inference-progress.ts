import { useCallback, useSyncExternalStore } from "react";
import { agentSessionIdForConversation } from "@/application/agent-session";
import { nativeInferenceProgress } from "@/infrastructure/agent/native-inference-progress";

export function useLocalInferenceProgress(conversationId: string) {
  const sessionId = agentSessionIdForConversation(conversationId);
  const subscribe = useCallback(
    (listener: () => void) =>
      nativeInferenceProgress.subscribe(sessionId, listener),
    [sessionId],
  );
  const snapshot = useCallback(
    () => nativeInferenceProgress.get(sessionId),
    [sessionId],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
