import type {
  AgentActivityItem,
  ChangeProposal,
  ChatMessage,
  CollaborationTask,
  ConnectionItem,
  ContextReference,
  MemoryItem,
  GeneratedMediaAttachment,
  ImageAttachment,
  Project,
  SkillItem,
  WorkspaceResource,
} from "../../domain/models.ts";
import type {
  BuiltInProjectResourcePackId,
  BuiltInProjectResourceSkillId,
} from "../../domain/builtin-project-resources.ts";

export type AgentProjectResourcePack = Readonly<{
  id: BuiltInProjectResourcePackId;
  skillId: BuiltInProjectResourceSkillId;
  name: string;
  description: string;
  version: string;
  license: string;
  fileCount: number;
}>;

export type AgentInputImageAttachment = ImageAttachment & {
  base64: string;
};

export type AgentRunInput = {
  runId: string;
  conversationId: string;
  /** A conversation-local main model override; absent follows the global default. */
  modelProfileId?: string;
  prompt: string;
  project: Project | null;
  memories: MemoryItem[];
  skills: SkillItem[];
  /** Skill IDs whose decrypted instructions must never enter durable session history. */
  protectedSkillIds?: readonly string[];
  resources: WorkspaceResource[];
  resourcePacks?: readonly AgentProjectResourcePack[];
  connections?: ConnectionItem[];
  attachments: AgentInputImageAttachment[];
};

export type AgentRunOutput = {
  content: string;
  /** Chronological tool and context-maintenance steps before the final answer. */
  activity?: AgentActivityItem[];
  toolActivity?: string[];
  collaboration?: CollaborationTask[];
  context: ContextReference[];
  attachments?: GeneratedMediaAttachment[];
  proposal?: ChangeProposal;
};

export type AgentRunEvent =
  | { type: "model-activity" }
  /** Bounded, user-facing narration. This is public model text, never reasoning. */
  | { type: "assistant-text"; content: string }
  | { type: "status"; label: string }
  | {
      type: "context-maintenance";
      operation: "automatic_compaction" | "overflow_recovery";
      phase: "started" | "completed" | "failed";
      label: string;
      tokensBefore?: number;
      tokensAfter?: number;
    }
  | { type: "collaboration-updated"; task: CollaborationTask }
  | { type: "tool-started"; toolCallId: string; label: string }
  | {
      type: "tool-completed";
      toolCallId: string;
      label: string;
      outcome: "completed" | "failed" | "staged";
      failureReason?: string;
    };

export type AgentRunObserver = (event: AgentRunEvent) => void;

export type AgentContextUsage = {
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  compactionThresholdTokens: number;
  /** True only while the persisted Pi session has not been opened this run. */
  estimated: boolean;
};

export type AgentContextUsageInput = {
  modelProfileId?: string;
  estimatedUsedTokens: number;
};

export interface AgentRuntime {
  run(
    input: AgentRunInput,
    signal: AbortSignal,
    onEvent?: AgentRunObserver,
  ): Promise<AgentRunOutput>;
  steer(
    conversationId: string,
    content: string,
    attachments?: AgentInputImageAttachment[],
  ): Promise<void>;
  contextUsage(
    conversationId: string,
    input: AgentContextUsageInput,
  ): Promise<AgentContextUsage>;
  /** Permanently removes the encrypted model-session tree for a conversation. */
  deleteConversation(conversationId: string): Promise<void>;
}

export function toAssistantMessage(
  runId: string,
  output: AgentRunOutput,
  execution?: {
    status: "completed" | "failed" | "cancelled" | "interrupted";
    durationMs: number;
  },
): ChatMessage {
  const visibleActivity = (output.activity ?? []).filter(
    (item) => item.kind !== "thinking",
  );
  const hasStructuredActivity = Boolean(execution && visibleActivity.length);
  return {
    id: `assistant-${runId}`,
    role: "assistant",
    content: output.content,
    ...(!hasStructuredActivity && output.toolActivity?.length
      ? { toolActivity: [...output.toolActivity] }
      : {}),
    ...(execution && visibleActivity.length
      ? {
          execution: {
            ...execution,
            activity: visibleActivity.map((item) => ({ ...item })),
          },
        }
      : {}),
    ...(output.collaboration?.length
      ? {
          collaboration: output.collaboration.map((task) => ({
            ...task,
            ...(task.toolActivity
              ? { toolActivity: [...task.toolActivity] }
              : {}),
          })),
        }
      : {}),
    context: output.context,
    ...(output.attachments?.length
      ? {
          attachments: output.attachments.map((attachment) => ({
            ...attachment,
          })),
        }
      : {}),
    proposalId: output.proposal?.id,
  };
}
