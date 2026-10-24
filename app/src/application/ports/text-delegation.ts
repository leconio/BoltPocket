import type {
  RuntimeSessionResources,
  RuntimeTool,
} from "@boltpocket/agent-runtime";

export const TEXT_SUBAGENT_ROLES = ["scout", "planner", "reviewer"] as const;

export type TextSubagentRole = (typeof TEXT_SUBAGENT_ROLES)[number];

export type TextDelegationInput = Readonly<{
  taskId: string;
  parentRunId: string;
  conversationId: string;
  projectId: string | null;
  role: TextSubagentRole;
  instruction: string;
  tools: readonly RuntimeTool[];
  resources?: RuntimeSessionResources;
  signal?: AbortSignal;
}>;

export type TextDelegationResult = Readonly<{
  content: string;
  modelRef: string;
  toolActivity: readonly string[];
}>;

/**
 * One fresh Pi child session for one self-contained task. The mobile host
 * supplies an explicit, role-narrowed tool set; parent history and secrets are
 * never inherited.
 */
export interface AgentTextDelegationPort {
  execute(input: TextDelegationInput): Promise<TextDelegationResult>;
}
