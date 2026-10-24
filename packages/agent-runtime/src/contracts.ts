import type { Static, TSchema } from "typebox";

export type ToolRisk = "read" | "propose" | "write" | "dangerous";

export type RuntimeImageInput = {
  data: string;
  mimeType: string;
};

export type RuntimeQueuedMessage = {
  text: string;
  images?: RuntimeImageInput[];
};

export type RuntimeSkill = {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation?: boolean;
};

export type RuntimePromptTemplate = {
  name: string;
  description?: string;
  content: string;
};

export type RuntimeSessionResources = {
  skills?: RuntimeSkill[];
  promptTemplates?: RuntimePromptTemplate[];
};

/**
 * App-owned encrypted persistence boundary for the upstream Pi Session tree.
 * Values are opaque, versioned JSON produced and validated by agent-runtime.
 */
export interface RuntimeSessionPersistencePort {
  load(sessionId: string): Promise<string | undefined>;
  save(sessionId: string, value: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

/**
 * A validated, text-only transcript entry that can seed a new model session.
 * Tool calls, tool results, proposal metadata, and executable actions are not
 * representable through this boundary.
 */
export type RuntimeInitialTextMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type RuntimeToolResult<TDetails = unknown> = {
  content: string;
  details: TDetails;
};

export type RuntimeToolContext = {
  sessionId: string;
  toolCallId: string;
  signal?: AbortSignal;
  update: (content: string, details?: unknown) => void;
};

export type RuntimeTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> = {
  name: string;
  label: string;
  description: string;
  risk: ToolRisk;
  parameters: TParameters;
  /** Upstream-compatible argument normalization before TypeBox validation. */
  prepareArguments?: (arguments_: unknown) => Static<TParameters>;
  executionMode?: "sequential" | "parallel";
  execute: (
    parameters: Static<TParameters>,
    context: RuntimeToolContext,
  ) => Promise<RuntimeToolResult<TDetails>>;
};

export type CreateSessionInput = {
  id: string;
  systemPrompt: string;
  tools: RuntimeTool[];
  /**
   * Initial subset of exposed tools available to the model. The full tool
   * registry remains session-owned so a host can switch profiles between
   * turns without rebuilding the session.
   */
  activeToolNames?: string[];
  /**
   * Tools that are always active when no explicit `activeToolNames` override
   * is supplied. They are also unioned into a compatible persisted profile.
   */
  baseActiveToolNames?: string[];
  /**
   * Current host allow-list for names restored from durable active-tool state.
   * Omit to allow every currently registered tool name.
   */
  restorableActiveToolNames?: string[];
  initialMessages?: RuntimeInitialTextMessage[];
  resources?: RuntimeSessionResources;
  thinkingLevel?:
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  authorizeToolCall?: (input: {
    sessionId: string;
    tool: RuntimeTool;
    toolCallId: string;
    arguments: unknown;
  }) => Promise<{ allow: boolean; reason?: string } | undefined>;
  /**
   * Upstream `context` hook adapter. The host may replace sensitive markers
   * immediately before a provider request without changing the durable Pi
   * Session tree.
   */
  transformContextText?: (text: string) => string;
  /** Exact text redaction applied before the upstream Session tree is saved. */
  redactDurableText?: (text: string) => string;
};

export type AgentSessionHandle = {
  id: string;
  /** Actual model-visible profile after compatible durable state is restored. */
  activeToolNames?: string[];
};

export type AgentContextUsage = {
  /** Configured provider context window for the active model. */
  contextWindow: number;
  /** Best available token count for the current model-visible context. */
  usedTokens: number;
  /** Tokens available before the provider's hard context-window limit. */
  remainingTokens: number;
  /** Usage level that triggers host-managed automatic compaction. */
  compactionThresholdTokens: number;
};

export type RuntimeToolExecution = {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  result?: unknown;
  isError?: boolean;
};

export type AgentRuntimeEvent =
  | { type: "run_started"; sessionId: string }
  | { type: "turn_started"; sessionId: string }
  | { type: "text_delta"; sessionId: string; delta: string }
  /** Content-free heartbeat for provider reasoning that must never leave Pi. */
  | { type: "model_activity"; sessionId: string }
  | {
      type: "queue_updated";
      sessionId: string;
      steering: number;
      followUp: number;
      nextTurn: number;
    }
  | {
      type: "tool_started";
      sessionId: string;
      execution: RuntimeToolExecution;
    }
  | {
      type: "tool_updated";
      sessionId: string;
      toolCallId: string;
      update: unknown;
    }
  | {
      type: "tool_completed";
      sessionId: string;
      execution: RuntimeToolExecution;
    }
  | {
      type: "context_maintenance";
      sessionId: string;
      operation: "automatic_compaction" | "overflow_recovery";
      phase: "started" | "completed" | "failed";
      tokensBefore?: number;
      tokensAfter?: number;
      error?: string;
    }
  | {
      type: "retry_status";
      sessionId: string;
      operation: "turn" | "compaction" | "branch_summary";
      phase: "scheduled" | "attempt_started" | "finished";
      attempt?: number;
      maxAttempts?: number;
      delayMs?: number;
      success?: boolean;
      error?: string;
    }
  | {
      type: "run_completed";
      sessionId: string;
      result: AgentRunResult;
    };

export type AgentRunResult = {
  status: "completed" | "cancelled" | "failed";
  text: string;
  toolExecutions: RuntimeToolExecution[];
  error?: string;
};

export type SendOptions = {
  signal?: AbortSignal;
  images?: RuntimeImageInput[];
  /** Hidden per-turn instruction merged into the system prompt, not history. */
  turnSystemPrompt?: string;
};

export interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<AgentSessionHandle>;
  send(
    sessionId: string,
    message: string,
    options?: SendOptions,
  ): Promise<AgentRunResult>;
  steer(sessionId: string, message: RuntimeQueuedMessage): Promise<void>;
  followUp(sessionId: string, message: RuntimeQueuedMessage): Promise<void>;
  nextTurn?(sessionId: string, message: RuntimeQueuedMessage): Promise<void>;
  invokeSkill?(
    sessionId: string,
    name: string,
    additionalInstructions?: string,
  ): Promise<AgentRunResult>;
  invokePromptTemplate?(
    sessionId: string,
    name: string,
    args?: string[],
  ): Promise<AgentRunResult>;
  contextUsage(sessionId: string): Promise<AgentContextUsage>;
  compact?(sessionId: string, customInstructions?: string): Promise<unknown>;
  navigateTree?(
    sessionId: string,
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<unknown>;
  waitForIdle?(sessionId: string): Promise<void>;
  /** Switch reasoning effort for subsequent turns without rebuilding history. */
  setThinkingLevel(
    sessionId: string,
    level: NonNullable<CreateSessionInput["thinkingLevel"]>,
  ): Promise<void>;
  /** Switch the model-visible tool profile for subsequent turns. */
  setActiveTools(sessionId: string, toolNames: string[]): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  subscribe(
    sessionId: string,
    listener: (event: AgentRuntimeEvent) => void,
  ): () => void;
  destroySession(sessionId: string): Promise<void>;
  deleteSession?(sessionId: string): Promise<void>;
}
