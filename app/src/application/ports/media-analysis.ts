import type { AgentInputImageAttachment } from "./agent-runtime.ts";

export type MediaAnalysisInput = Readonly<{
  taskId: string;
  parentRunId: string;
  conversationId: string;
  projectId: string | null;
  question: string;
  attachments: readonly AgentInputImageAttachment[];
  signal?: AbortSignal;
}>;

export type MediaAnalysisResult = Readonly<{
  content: string;
  modelRef: string;
}>;

/** A bounded, read-only specialist. It never receives project tools or secrets. */
export interface AgentMediaAnalysisPort {
  analyze(input: MediaAnalysisInput): Promise<MediaAnalysisResult>;
}
