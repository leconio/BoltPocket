import { useStore } from "zustand";

import type { LiveAgentOutputSnapshot } from "@/application/live-agent-output";
import { useAppServices } from "@/providers/runtime-services-provider";

function useLiveAgentOutputField<T>(
  conversationId: string,
  select: (snapshot: LiveAgentOutputSnapshot) => T,
) {
  const { liveAgentOutput } = useAppServices();
  return useStore(liveAgentOutput.store(conversationId), select);
}

const selectStatus = (snapshot: LiveAgentOutputSnapshot) => snapshot.status;
const selectStartedAt = (snapshot: LiveAgentOutputSnapshot) =>
  snapshot.startedAt;
const selectCollaboration = (snapshot: LiveAgentOutputSnapshot) =>
  snapshot.collaboration;
const selectActivity = (snapshot: LiveAgentOutputSnapshot) => snapshot.activity;

export function useLiveAgentStatus(conversationId: string) {
  return useLiveAgentOutputField(conversationId, selectStatus);
}

export function useLiveAgentStartedAt(conversationId: string) {
  return useLiveAgentOutputField(conversationId, selectStartedAt);
}

export function useLiveAgentCollaboration(conversationId: string) {
  return useLiveAgentOutputField(conversationId, selectCollaboration);
}

export function useLiveAgentActivity(conversationId: string) {
  return useLiveAgentOutputField(conversationId, selectActivity);
}
