import {
  AgentHarness,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  InMemorySessionStorage,
  prepareCompaction,
  Session as HarnessSession,
  estimateContextTokens,
  estimateTokens,
  shouldCompact,
  type AgentHarnessEvent,
  type AgentHarnessStreamOptions,
  type AgentHarnessTool,
  type AgentMessage,
  type CompactionSettings,
  type SessionTreeEntry,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  isContextOverflow,
  retryAssistantCall,
  type AssistantMessage,
  type ImageContent,
  type Model,
  type Models,
  type RetryPolicy,
} from "@earendil-works/pi-ai";

import type {
  AgentRunResult,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentContextUsage,
  AgentSessionHandle,
  CreateSessionInput,
  RuntimeInitialTextMessage,
  RuntimeQueuedMessage,
  RuntimeSessionPersistencePort,
  RuntimeTool,
  RuntimeToolExecution,
  SendOptions,
} from "./contracts.ts";
import { PersistedPiSessionStorage } from "./session-persistence.ts";

export type PiAgentRuntimeOptions = {
  model: Model<any>;
  streamFn: StreamFn;
  /**
   * Optional full Pi model registry. The mobile OpenAI-compatible adapter uses
   * the supplied stream function for both turns and upstream summarization.
   */
  models?: Models;
  /** Curated provider options forwarded by the upstream AgentHarness. */
  streamOptions?: AgentHarnessStreamOptions;
  /**
   * Upstream coding-agent retry policy, shared by safe turn recovery and
   * Harness compaction/branch-summary calls.
   */
  retry?: RetryPolicy;
  /**
   * Upstream Pi exposes compaction primitives but leaves scheduling to its
   * host. Mobile sessions enable threshold compaction and one safe overflow
   * recovery by default; either behavior can be disabled by an embedding host.
   */
  contextMaintenance?:
    | false
    | {
        automaticCompaction?: boolean;
        recoverOverflow?: boolean;
      };
  /** App-owned encrypted persistence for Pi's complete upstream Session tree. */
  sessionPersistence?: RuntimeSessionPersistencePort;
};

const INITIAL_MESSAGE_KEYS = new Set(["role", "content", "timestamp"]);
const MAX_INITIAL_MESSAGES = 2_000;
const MAX_INITIAL_MESSAGE_CHARACTERS = 200_000;
const MAX_INITIAL_HISTORY_CHARACTERS = 2_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatedInitialMessages(
  value: RuntimeInitialTextMessage[] | undefined,
): RuntimeInitialTextMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_INITIAL_MESSAGES) {
    throw new Error("Initial Agent history must be a bounded message array.");
  }

  const messages: RuntimeInitialTextMessage[] = [];
  let pendingUsers = 0;
  let totalCharacters = 0;
  for (const candidate of value as unknown[]) {
    if (
      !isRecord(candidate) ||
      !Object.keys(candidate).every((key) => INITIAL_MESSAGE_KEYS.has(key)) ||
      Object.keys(candidate).length !== INITIAL_MESSAGE_KEYS.size ||
      (candidate.role !== "user" && candidate.role !== "assistant") ||
      typeof candidate.content !== "string" ||
      !candidate.content.trim() ||
      candidate.content.length > MAX_INITIAL_MESSAGE_CHARACTERS ||
      typeof candidate.timestamp !== "number" ||
      !Number.isSafeInteger(candidate.timestamp) ||
      candidate.timestamp < 0
    ) {
      throw new Error(
        "Initial Agent history accepts only validated user and assistant text messages.",
      );
    }
    totalCharacters += candidate.content.length;
    if (totalCharacters > MAX_INITIAL_HISTORY_CHARACTERS) {
      throw new Error("Initial Agent text history exceeds its size limit.");
    }
    if (candidate.role === "user") {
      pendingUsers += 1;
    } else {
      if (pendingUsers === 0) {
        throw new Error(
          "Initial Agent history must contain only completed user turns.",
        );
      }
      pendingUsers = 0;
    }
    messages.push({
      role: candidate.role,
      content: candidate.content,
      timestamp: candidate.timestamp,
    });
  }
  if (pendingUsers > 0) {
    throw new Error(
      "Initial Agent history must contain only completed user turns.",
    );
  }
  return messages;
}

function initialHarnessMessages(
  messages: readonly RuntimeInitialTextMessage[],
  model: PiAgentRuntimeOptions["model"],
): AgentMessage[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return {
        role: "user" as const,
        content: [{ type: "text" as const, text: message.content }],
        timestamp: message.timestamp,
      };
    }
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop" as const,
      timestamp: message.timestamp,
    };
  });
}

type RuntimeHarness = AgentHarness<undefined>;

type RuntimeSession = {
  id: string;
  harness: RuntimeHarness;
  transcript: HarnessSession;
  durableStorage?: PersistedPiSessionStorage;
  listeners: Set<(event: AgentRuntimeEvent) => void>;
  unsubscribeHarness: () => void;
  unsubscribeToolPolicy: () => void;
  unsubscribeTurnPrompt: () => void;
  unsubscribeContextTransform: () => void;
  unsubscribeCompaction: () => void;
  toolsByName: Map<string, RuntimeTool>;
  toolExecutions: RuntimeToolExecution[];
  activeSignal?: AbortSignal;
  compactedDuringRun: boolean;
  turnSystemPrompt?: string;
};

function transformStringValues<T>(
  value: T,
  transform: (text: string) => string,
): T {
  if (typeof value === "string") return transform(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => transformStringValues(item, transform)) as T;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      transformStringValues(item, transform),
    ]),
  ) as T;
}

type ContextMaintenancePolicy = {
  automaticCompaction: boolean;
  recoverOverflow: boolean;
};

const MIN_COMPACTION_RESERVE_TOKENS = 2_048;
const MIN_COMPACTION_RECENT_TOKENS = 4_096;

/**
 * Keep Pi's defaults for large windows while scaling both budgets down for
 * smaller custom models. This prevents a 16K/32K model from inheriting a 16K
 * reserve and 20K retained tail that can never fit inside its own window.
 */
export function compactionSettingsForContextWindow(
  contextWindow: number,
): CompactionSettings {
  const reserveTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.reserveTokens,
    Math.max(MIN_COMPACTION_RESERVE_TOKENS, Math.floor(contextWindow * 0.16)),
  );
  const keepRecentTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    Math.max(MIN_COMPACTION_RECENT_TOKENS, Math.floor(contextWindow * 0.36)),
  );
  return { enabled: true, reserveTokens, keepRecentTokens };
}

function estimateContextContentTokens(messages: AgentMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(message),
    0,
  );
}

function hasUsableAssistantUsageAfterLastCompaction(
  branch: SessionTreeEntry[],
): boolean {
  const lastCompactionIndex = branch.findLastIndex(
    (entry) => entry.type === "compaction",
  );
  if (lastCompactionIndex < 0) return true;

  return branch.slice(lastCompactionIndex + 1).some((entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      return false;
    }
    const { usage, stopReason } = entry.message;
    return (
      stopReason !== "aborted" &&
      stopReason !== "error" &&
      (usage.totalTokens ||
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite) > 0
    );
  });
}

function estimateActiveContextTokens(
  messages: AgentMessage[],
  branch: SessionTreeEntry[],
): number {
  // Usage attached to retained assistant messages describes the old,
  // pre-compaction request. Until a new assistant response is stored after the
  // checkpoint, estimate the compacted context from the content that will
  // actually be sent next.
  if (!hasUsableAssistantUsageAfterLastCompaction(branch)) {
    return estimateContextContentTokens(messages);
  }
  return estimateContextTokens(messages).tokens;
}

type PromptAttempt = {
  failedLeafId: string;
  recoveryLeafId: string | null;
};

const EMPTY_TOOL_RESULT_CONTINUATION =
  "Host recovery: Continue the current request from the completed tool results. Do not repeat successful inspection calls. Finish any remaining work and return a non-empty user-facing summary.";
const EMPTY_POST_COMPACTION_CONTINUATION =
  "Host recovery after context compaction: Continue from the preserved summary and completed tool results. Do not repeat successful calls. Return the final user-facing answer now.";

function contextMaintenancePolicy(
  value: PiAgentRuntimeOptions["contextMaintenance"],
): ContextMaintenancePolicy {
  if (value === false) {
    return { automaticCompaction: false, recoverOverflow: false };
  }
  return {
    automaticCompaction: value?.automaticCompaction ?? true,
    recoverOverflow: value?.recoverOverflow ?? true,
  };
}

function userMessageText(entry: SessionTreeEntry) {
  if (entry.type !== "message" || entry.message.role !== "user") {
    return undefined;
  }
  if (typeof entry.message.content === "string") {
    return entry.message.content;
  }
  return entry.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function assistantText(message: AssistantMessage | undefined) {
  const blocks =
    message?.content.filter((block) => block.type === "text") ?? [];
  const finalAnswerBlocks = blocks.filter((block) => {
    if (!block.textSignature) return false;
    try {
      const signature = JSON.parse(block.textSignature) as unknown;
      return isRecord(signature) && signature.phase === "final_answer";
    } catch {
      return false;
    }
  });
  return (finalAnswerBlocks.length > 0 ? finalAnswerBlocks : blocks)
    .map((block) => block.text)
    .join("");
}

/**
 * Browser-safe Models subset used by AgentHarness. Upstream Pi implements
 * completeSimple by awaiting the result of streamSimple; doing the same here
 * keeps compaction and branch summaries on the injected mobile transport
 * without importing provider/auth discovery into the React Native bundle.
 */
function harnessModels(options: PiAgentRuntimeOptions): Models {
  if (options.models) return options.models;
  return {
    streamSimple: (model, context, streamOptions) =>
      options.streamFn(model, context, streamOptions),
    completeSimple: async (model, context, streamOptions) => {
      const stream = await options.streamFn(model, context, streamOptions);
      return stream.result();
    },
  } as Models;
}

export class PiAgentRuntime implements AgentRuntime {
  readonly #options: PiAgentRuntimeOptions;
  readonly #models: Models;
  readonly #contextMaintenance: ContextMaintenancePolicy;
  readonly #sessions = new Map<string, RuntimeSession>();

  constructor(options: PiAgentRuntimeOptions) {
    this.#options = options;
    this.#models = harnessModels(options);
    this.#contextMaintenance = contextMaintenancePolicy(
      options.contextMaintenance,
    );
  }

  async createSession(input: CreateSessionInput): Promise<AgentSessionHandle> {
    if (this.#sessions.has(input.id)) {
      throw new Error(`Agent session already exists: ${input.id}`);
    }

    const initialMessages = validatedInitialMessages(input.initialMessages);
    const durableStorage = this.#options.sessionPersistence
      ? await PersistedPiSessionStorage.open(
          input.id,
          this.#options.sessionPersistence,
          input.redactDurableText,
        )
      : undefined;
    const storage =
      durableStorage ??
      new InMemorySessionStorage({
        metadata: { id: input.id, createdAt: new Date().toISOString() },
      });
    const transcript = new HarnessSession(storage);
    const hasPersistedEntries =
      (await transcript.getEntries({ limit: 1 })).length > 0;
    if (!hasPersistedEntries) {
      await durableStorage?.beginBatch();
      try {
        for (const message of initialHarnessMessages(
          initialMessages,
          this.#options.model,
        )) {
          await transcript.appendMessage(message);
        }
      } finally {
        await durableStorage?.finishBatch();
      }
    }

    const restoredContext = await transcript.buildContext();

    const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
    const availableToolNames = new Set(input.tools.map((tool) => tool.name));
    const restorableActiveToolNames = input.restorableActiveToolNames
      ? new Set(input.restorableActiveToolNames)
      : undefined;
    const restoredActiveToolNames = restoredContext.activeToolNames?.filter(
      (name) =>
        availableToolNames.has(name) &&
        (restorableActiveToolNames?.has(name) ?? true),
    );
    const baseActiveToolNames = new Set(input.baseActiveToolNames ?? []);
    const defaultActiveToolNames =
      input.baseActiveToolNames !== undefined ||
      restoredActiveToolNames !== undefined
        ? input.tools
            .map((tool) => tool.name)
            .filter(
              (name) =>
                baseActiveToolNames.has(name) ||
                restoredActiveToolNames?.includes(name),
            )
        : undefined;
    const harness = new AgentHarness<undefined>({
      session: transcript,
      models: this.#models,
      model: this.#options.model,
      systemPrompt: input.systemPrompt,
      tools: input.tools.map((tool) => this.#toHarnessTool(input.id, tool)),
      activeToolNames:
        input.activeToolNames ?? defaultActiveToolNames ?? undefined,
      thinkingLevel:
        input.thinkingLevel ??
        (restoredContext.thinkingLevel as
          "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"),
      resources: input.resources,
      streamOptions: this.#options.streamOptions,
      retry: this.#options.retry,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
    const session: RuntimeSession = {
      id: input.id,
      harness,
      transcript,
      durableStorage,
      listeners: new Set(),
      unsubscribeHarness: () => undefined,
      unsubscribeToolPolicy: () => undefined,
      unsubscribeTurnPrompt: () => undefined,
      unsubscribeContextTransform: () => undefined,
      unsubscribeCompaction: () => undefined,
      toolsByName,
      toolExecutions: [],
      compactedDuringRun: false,
    };
    session.unsubscribeHarness = harness.subscribe(async (event, signal) => {
      if (signal) session.activeSignal = signal;
      this.#handleHarnessEvent(session, event);
      if (event.type === "save_point") {
        await session.durableStorage?.flush();
      }
    });
    session.unsubscribeToolPolicy = harness.on("tool_call", async (event) => {
      const tool = toolsByName.get(event.toolName);
      if (!tool) return { block: true, reason: "Unknown tool" };
      const authorization = await input.authorizeToolCall?.({
        sessionId: input.id,
        tool,
        toolCallId: event.toolCallId,
        arguments: event.input,
      });
      if (authorization && !authorization.allow) {
        return {
          block: true,
          reason: authorization.reason ?? "Tool call blocked by host policy.",
        };
      }
      if (tool.risk !== "write" && tool.risk !== "dangerous") {
        return undefined;
      }
      if (authorization?.allow) return undefined;
      return {
        block: true,
        reason:
          authorization?.reason ??
          "Write and dangerous tools require explicit application authorization.",
      };
    });
    session.unsubscribeContextTransform = harness.on(
      "context",
      async (event) => {
        const compactedMessages = await this.#compactContextDuringRun(
          session,
          event.messages,
        );
        return {
          messages: input.transformContextText
            ? transformStringValues(
                compactedMessages,
                input.transformContextText,
              )
            : compactedMessages,
        };
      },
    );
    const compactionSettings = compactionSettingsForContextWindow(
      this.#options.model.contextWindow,
    );
    if (
      compactionSettings.reserveTokens !==
        DEFAULT_COMPACTION_SETTINGS.reserveTokens ||
      compactionSettings.keepRecentTokens !==
        DEFAULT_COMPACTION_SETTINGS.keepRecentTokens
    ) {
      session.unsubscribeCompaction = harness.on(
        "session_before_compact",
        async (event) => {
          const prepared = prepareCompaction(
            event.branchEntries,
            compactionSettings,
          );
          if (!prepared.ok) throw prepared.error;
          if (!prepared.value) return { cancel: true };
          const result = await compact(
            prepared.value,
            this.#models,
            this.#options.model,
            event.customInstructions,
            event.signal,
            harness.getThinkingLevel(),
            this.#options.retry,
          );
          if (!result.ok) throw result.error;
          return { compaction: result.value };
        },
      );
    }
    session.unsubscribeTurnPrompt = harness.on(
      "before_agent_start",
      (event) => {
        const instruction = session.turnSystemPrompt?.trim();
        if (!instruction) return undefined;
        return {
          systemPrompt: `${event.systemPrompt}\n\n${instruction}`,
        };
      },
    );
    this.#sessions.set(input.id, session);
    return {
      id: input.id,
      activeToolNames: harness.getActiveTools().map((tool) => tool.name),
    };
  }

  async send(
    sessionId: string,
    message: string,
    options: SendOptions = {},
  ): Promise<AgentRunResult> {
    const session = this.#getSession(sessionId);
    session.toolExecutions = [];
    session.activeSignal = options.signal;
    session.compactedDuringRun = false;
    session.turnSystemPrompt = options.turnSystemPrompt;
    await session.durableStorage?.beginBatch();
    let abortPromise: Promise<unknown> | undefined;
    const abort = () => {
      abortPromise ??= session.harness.abort();
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    let result: AgentRunResult;
    let persistenceFailure: unknown;
    try {
      const images = options.images?.map((image) => ({
        type: "image" as const,
        ...image,
      }));
      const previousLeafId = await session.transcript.getLeafId();
      const prompt = session.harness.prompt(message, { images });
      if (options.signal?.aborted) abort();
      let assistant = await prompt;
      await abortPromise;
      if (
        !options.signal?.aborted &&
        session.toolExecutions.length > 0 &&
        assistant.stopReason !== "error" &&
        assistant.stopReason !== "aborted" &&
        assistantText(assistant).trim() === ""
      ) {
        assistant = await session.harness.prompt(
          EMPTY_TOOL_RESULT_CONTINUATION,
        );
        await abortPromise;
      }
      if (
        this.#contextMaintenance.recoverOverflow &&
        !options.signal?.aborted &&
        session.toolExecutions.length === 0 &&
        assistantText(assistant) === "" &&
        isContextOverflow(assistant, this.#options.model.contextWindow)
      ) {
        assistant = await this.#recoverContextOverflow(
          session,
          message,
          images,
          previousLeafId,
          assistant,
          options.signal,
        );
        await abortPromise;
      }
      assistant = await this.#retryTransientFailure(
        session,
        message,
        images,
        previousLeafId,
        assistant,
        options.signal,
      );
      await abortPromise;
      if (
        assistant.stopReason !== "error" &&
        assistant.stopReason !== "aborted" &&
        !options.signal?.aborted
      ) {
        await this.#compactIfNeeded(session);
      }
      if (
        session.compactedDuringRun &&
        !options.signal?.aborted &&
        session.toolExecutions.length > 0 &&
        assistant.stopReason !== "error" &&
        assistant.stopReason !== "aborted" &&
        assistantText(assistant).trim() === ""
      ) {
        assistant = await session.harness.prompt(
          EMPTY_POST_COMPACTION_CONTINUATION,
        );
        await abortPromise;
      }
      result = {
        status:
          assistant.stopReason === "aborted"
            ? "cancelled"
            : assistant.stopReason === "error"
              ? "failed"
              : "completed",
        text: assistantText(assistant),
        toolExecutions: [...session.toolExecutions],
        ...(assistant.errorMessage ? { error: assistant.errorMessage } : {}),
      };
    } catch (error) {
      await abortPromise?.catch(() => undefined);
      result = {
        status: options.signal?.aborted ? "cancelled" : "failed",
        text: "",
        toolExecutions: [...session.toolExecutions],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        await session.durableStorage?.finishBatch();
      } catch (error) {
        persistenceFailure = error;
      }
      session.activeSignal = undefined;
      session.turnSystemPrompt = undefined;
      options.signal?.removeEventListener("abort", abort);
    }

    if (persistenceFailure) {
      result = {
        status: "failed",
        text: "",
        toolExecutions: [...session.toolExecutions],
        error:
          persistenceFailure instanceof Error
            ? persistenceFailure.message
            : String(persistenceFailure),
      };
    }

    this.#emit(session, { type: "run_completed", sessionId, result });
    return result;
  }

  async steer(sessionId: string, message: RuntimeQueuedMessage): Promise<void> {
    const session = this.#getSession(sessionId);
    await session.harness.steer(message.text, {
      images: message.images?.map((image) => ({
        type: "image" as const,
        ...image,
      })),
    });
  }

  async followUp(
    sessionId: string,
    message: RuntimeQueuedMessage,
  ): Promise<void> {
    const session = this.#getSession(sessionId);
    await session.harness.followUp(message.text, {
      images: message.images?.map((image) => ({
        type: "image" as const,
        ...image,
      })),
    });
  }

  async nextTurn(
    sessionId: string,
    message: RuntimeQueuedMessage,
  ): Promise<void> {
    const session = this.#getSession(sessionId);
    await session.harness.nextTurn(message.text, {
      images: message.images?.map((image) => ({
        type: "image" as const,
        ...image,
      })),
    });
  }

  async invokeSkill(
    sessionId: string,
    name: string,
    additionalInstructions?: string,
  ): Promise<AgentRunResult> {
    const session = this.#getSession(sessionId);
    return this.#runHarnessOperation(session, () =>
      session.harness.skill(name, additionalInstructions),
    );
  }

  async invokePromptTemplate(
    sessionId: string,
    name: string,
    args: string[] = [],
  ): Promise<AgentRunResult> {
    const session = this.#getSession(sessionId);
    return this.#runHarnessOperation(session, () =>
      session.harness.promptFromTemplate(name, args),
    );
  }

  compact(sessionId: string, customInstructions?: string) {
    return this.#getSession(sessionId).harness.compact(customInstructions);
  }

  navigateTree(
    sessionId: string,
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) {
    return this.#getSession(sessionId).harness.navigateTree(targetId, options);
  }

  waitForIdle(sessionId: string) {
    return this.#getSession(sessionId).harness.waitForIdle();
  }

  async setThinkingLevel(
    sessionId: string,
    level: NonNullable<CreateSessionInput["thinkingLevel"]>,
  ): Promise<void> {
    await this.#getSession(sessionId).harness.setThinkingLevel(level);
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    await this.#getSession(sessionId).harness.setActiveTools(toolNames);
  }

  async contextUsage(sessionId: string): Promise<AgentContextUsage> {
    const contextWindow = this.#options.model.contextWindow;
    const transcript = this.#getSession(sessionId).transcript;
    const [context, branch] = await Promise.all([
      transcript.buildContext(),
      transcript.getBranch(),
    ]);
    const usedTokens = Math.max(
      0,
      estimateActiveContextTokens(context.messages, branch),
    );
    const settings = compactionSettingsForContextWindow(contextWindow);
    return {
      contextWindow,
      usedTokens,
      remainingTokens: Math.max(0, contextWindow - usedTokens),
      compactionThresholdTokens: Math.max(
        0,
        contextWindow - settings.reserveTokens,
      ),
    };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#getSession(sessionId).harness.abort();
  }

  subscribe(sessionId: string, listener: (event: AgentRuntimeEvent) => void) {
    const session = this.#getSession(sessionId);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.#getSession(sessionId);
    await session.harness.abort();
    await session.durableStorage?.flush();
    session.unsubscribeTurnPrompt();
    session.unsubscribeContextTransform();
    session.unsubscribeCompaction();
    session.unsubscribeToolPolicy();
    session.unsubscribeHarness();
    session.listeners.clear();
    this.#sessions.delete(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.#sessions.has(sessionId)) {
      await this.destroySession(sessionId);
    }
    await this.#options.sessionPersistence?.delete(sessionId);
  }

  async #recoverContextOverflow(
    session: RuntimeSession,
    message: string,
    images: ImageContent[] | undefined,
    previousLeafId: string | null,
    originalAssistant: AssistantMessage,
    signal: AbortSignal | undefined,
  ): Promise<AssistantMessage> {
    if (!previousLeafId) return originalAssistant;
    const attempt = await this.#findPromptAttempt(
      session,
      message,
      previousLeafId,
      originalAssistant,
    );
    if (!attempt) return originalAssistant;

    this.#emit(session, {
      type: "context_maintenance",
      sessionId: session.id,
      operation: "overflow_recovery",
      phase: "started",
    });
    try {
      await this.#moveToRecoveryLeaf(session, attempt.recoveryLeafId);
      if (signal?.aborted) throw new Error("Context recovery was cancelled.");
      const recoveryContext = await session.transcript.buildContext();
      const tokensBefore = estimateContextContentTokens(
        recoveryContext.messages,
      );
      await session.harness.compact();
      if (signal?.aborted) throw new Error("Context recovery was cancelled.");
      const recovered = await session.harness.prompt(message, { images });
      const recoveredContext = await session.transcript.buildContext();
      const tokensAfter = estimateContextContentTokens(
        recoveredContext.messages,
      );
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "overflow_recovery",
        phase:
          recovered.stopReason === "error" || recovered.stopReason === "aborted"
            ? "failed"
            : "completed",
        tokensBefore,
        tokensAfter,
        ...(recovered.errorMessage ? { error: recovered.errorMessage } : {}),
      });
      return recovered;
    } catch (error) {
      await session.harness
        .navigateTree(attempt.failedLeafId, { summarize: false })
        .catch(() => undefined);
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "overflow_recovery",
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return originalAssistant;
    }
  }

  async #findPromptAttempt(
    session: RuntimeSession,
    message: string,
    previousLeafId: string | null,
    assistant: AssistantMessage,
  ): Promise<PromptAttempt | undefined> {
    const branch = await session.transcript.getBranch();
    const previousIndex = previousLeafId
      ? branch.findIndex((entry) => entry.id === previousLeafId)
      : -1;
    if (previousLeafId && previousIndex < 0) return undefined;
    const startIndex = previousIndex + 1;

    let promptIndex = -1;
    for (let index = branch.length - 1; index >= startIndex; index -= 1) {
      if (userMessageText(branch[index]!) === message) {
        promptIndex = index;
        break;
      }
    }
    if (promptIndex < 0) return undefined;

    const laterMessages = branch
      .slice(promptIndex + 1)
      .filter((entry) => entry.type === "message");
    if (
      laterMessages.length !== 1 ||
      laterMessages[0]?.message.role !== "assistant" ||
      laterMessages[0].message.stopReason !== assistant.stopReason ||
      laterMessages[0].message.errorMessage !== assistant.errorMessage
    ) {
      return undefined;
    }
    const failedLeafId = await session.transcript.getLeafId();
    if (!failedLeafId) return undefined;
    return { failedLeafId, recoveryLeafId: previousLeafId };
  }

  async #moveToRecoveryLeaf(
    session: RuntimeSession,
    recoveryLeafId: string | null,
  ): Promise<void> {
    if (recoveryLeafId) {
      await session.harness.navigateTree(recoveryLeafId, { summarize: false });
      return;
    }
    await session.transcript.moveTo(null);
  }

  async #retryTransientFailure(
    session: RuntimeSession,
    message: string,
    images: ImageContent[] | undefined,
    previousLeafId: string | null,
    originalAssistant: AssistantMessage,
    signal: AbortSignal | undefined,
  ): Promise<AssistantMessage> {
    const retry = this.#options.retry;
    if (!retry?.enabled || retry.maxRetries <= 0) {
      return originalAssistant;
    }

    let assistant = originalAssistant;
    let attempts = 0;
    while (attempts < retry.maxRetries) {
      if (
        signal?.aborted ||
        assistant.stopReason !== "error" ||
        assistantText(assistant) !== "" ||
        session.toolExecutions.length > 0 ||
        isContextOverflow(assistant, this.#options.model.contextWindow) ||
        !(await this.#findPromptAttempt(
          session,
          message,
          previousLeafId,
          assistant,
        ))
      ) {
        break;
      }

      const nextAttempt = attempts + 1;
      let replay = false;
      let scheduled = false;
      assistant = await retryAssistantCall(
        async () => {
          if (!replay) {
            replay = true;
            return assistant;
          }
          const attempt = await this.#findPromptAttempt(
            session,
            message,
            previousLeafId,
            assistant,
          );
          if (!attempt) {
            return assistant;
          }
          await this.#moveToRecoveryLeaf(session, attempt.recoveryLeafId);
          return session.harness.prompt(message, { images });
        },
        {
          enabled: true,
          maxRetries: 1,
          baseDelayMs: retry.baseDelayMs * 2 ** attempts,
        },
        signal,
        {
          onRetryScheduled: (_attempt, _maxAttempts, delayMs, errorMessage) => {
            scheduled = true;
            this.#emit(session, {
              type: "retry_status",
              sessionId: session.id,
              operation: "turn",
              phase: "scheduled",
              attempt: nextAttempt,
              maxAttempts: retry.maxRetries,
              delayMs,
              error: errorMessage,
            });
          },
          onRetryAttemptStart: () => {
            this.#emit(session, {
              type: "retry_status",
              sessionId: session.id,
              operation: "turn",
              phase: "attempt_started",
              attempt: nextAttempt,
              maxAttempts: retry.maxRetries,
            });
          },
        },
      );
      if (!scheduled) {
        break;
      }
      attempts = nextAttempt;
      if (assistant.stopReason !== "error") {
        this.#emit(session, {
          type: "retry_status",
          sessionId: session.id,
          operation: "turn",
          phase: "finished",
          attempt: attempts,
          success: assistant.stopReason !== "aborted",
        });
        return assistant;
      }
    }

    if (attempts > 0) {
      this.#emit(session, {
        type: "retry_status",
        sessionId: session.id,
        operation: "turn",
        phase: "finished",
        attempt: attempts,
        success: false,
        ...(assistant.errorMessage ? { error: assistant.errorMessage } : {}),
      });
    }
    return assistant;
  }

  async #compactContextDuringRun(
    session: RuntimeSession,
    messages: AgentMessage[],
  ): Promise<AgentMessage[]> {
    if (!this.#contextMaintenance.automaticCompaction) return messages;
    const settings = compactionSettingsForContextWindow(
      this.#options.model.contextWindow,
    );
    const rawContextTokens = estimateContextTokens(messages).tokens;
    if (
      !shouldCompact(
        rawContextTokens,
        this.#options.model.contextWindow,
        settings,
      )
    ) {
      return messages;
    }

    const branch = await session.transcript.getBranch();
    const contextTokens = estimateActiveContextTokens(messages, branch);
    if (
      !shouldCompact(
        contextTokens,
        this.#options.model.contextWindow,
        settings,
      ) ||
      branch.at(-1)?.type === "compaction"
    ) {
      return messages;
    }

    const prepared = prepareCompaction(branch, settings);
    if (!prepared.ok || !prepared.value) return messages;
    this.#emit(session, {
      type: "context_maintenance",
      sessionId: session.id,
      operation: "automatic_compaction",
      phase: "started",
    });
    try {
      const compacted = await compact(
        prepared.value,
        this.#models,
        this.#options.model,
        undefined,
        session.activeSignal,
        session.harness.getThinkingLevel(),
        this.#options.retry,
      );
      if (!compacted.ok) throw compacted.error;
      const value = compacted.value;
      await session.transcript.appendCompaction(
        value.summary,
        value.firstKeptEntryId,
        value.tokensBefore,
        value.details,
        false,
        value.usage,
        value.retainedTail,
      );
      const compactedContext = await session.transcript.buildContext();
      session.compactedDuringRun = true;
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "automatic_compaction",
        phase: "completed",
        tokensBefore: contextTokens,
        tokensAfter: estimateContextContentTokens(compactedContext.messages),
      });
      return compactedContext.messages;
    } catch (error) {
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "automatic_compaction",
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return messages;
    }
  }

  async #compactIfNeeded(session: RuntimeSession): Promise<boolean> {
    if (!this.#contextMaintenance.automaticCompaction) return false;
    const context = await session.transcript.buildContext();
    const branch = await session.transcript.getBranch();
    const contextTokens = estimateActiveContextTokens(context.messages, branch);
    const settings = compactionSettingsForContextWindow(
      this.#options.model.contextWindow,
    );
    if (
      !shouldCompact(contextTokens, this.#options.model.contextWindow, settings)
    ) {
      return false;
    }
    if (branch.at(-1)?.type === "compaction") return false;

    this.#emit(session, {
      type: "context_maintenance",
      sessionId: session.id,
      operation: "automatic_compaction",
      phase: "started",
    });
    try {
      await session.harness.compact();
      const compactedContext = await session.transcript.buildContext();
      session.compactedDuringRun = true;
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "automatic_compaction",
        phase: "completed",
        tokensBefore: estimateContextContentTokens(context.messages),
        tokensAfter: estimateContextContentTokens(compactedContext.messages),
      });
      return true;
    } catch (error) {
      this.#emit(session, {
        type: "context_maintenance",
        sessionId: session.id,
        operation: "automatic_compaction",
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async #runHarnessOperation(
    session: RuntimeSession,
    operation: () => Promise<AssistantMessage>,
  ): Promise<AgentRunResult> {
    session.toolExecutions = [];
    await session.durableStorage?.beginBatch();
    let result: AgentRunResult;
    let persistenceFailure: unknown;
    try {
      const assistant = await operation();
      result = {
        status:
          assistant.stopReason === "aborted"
            ? "cancelled"
            : assistant.stopReason === "error"
              ? "failed"
              : "completed",
        text: assistantText(assistant),
        toolExecutions: [...session.toolExecutions],
        ...(assistant.errorMessage ? { error: assistant.errorMessage } : {}),
      };
    } catch (error) {
      result = {
        status: "failed",
        text: "",
        toolExecutions: [...session.toolExecutions],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        await session.durableStorage?.finishBatch();
      } catch (error) {
        persistenceFailure = error;
      }
    }
    if (persistenceFailure) {
      result = {
        status: "failed",
        text: "",
        toolExecutions: [...session.toolExecutions],
        error:
          persistenceFailure instanceof Error
            ? persistenceFailure.message
            : String(persistenceFailure),
      };
    }
    this.#emit(session, {
      type: "run_completed",
      sessionId: session.id,
      result,
    });
    return result;
  }

  #toHarnessTool(
    sessionId: string,
    tool: RuntimeTool,
  ): AgentHarnessTool<undefined> {
    return {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      prepareArguments: tool.prepareArguments,
      executionMode: tool.executionMode ?? "sequential",
      execute: async (toolCallId, parameters, signal, onUpdate) => {
        const result = await tool.execute(parameters, {
          sessionId,
          toolCallId,
          signal,
          update: (content, details = {}) =>
            onUpdate?.({
              content: [{ type: "text", text: content }],
              details,
            }),
        });
        return {
          content: [{ type: "text", text: result.content }],
          details: result.details,
        };
      },
    };
  }

  #handleHarnessEvent(session: RuntimeSession, event: AgentHarnessEvent) {
    switch (event.type) {
      case "agent_start":
        this.#emit(session, { type: "run_started", sessionId: session.id });
        break;
      case "turn_start":
        this.#emit(session, { type: "turn_started", sessionId: session.id });
        break;
      case "queue_update":
        this.#emit(session, {
          type: "queue_updated",
          sessionId: session.id,
          steering: event.steer.length,
          followUp: event.followUp.length,
          nextTurn: event.nextTurn.length,
        });
        break;
      case "retry_scheduled":
        this.#emit(session, {
          type: "retry_status",
          sessionId: session.id,
          operation: event.operation,
          phase: "scheduled",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage,
        });
        break;
      case "retry_attempt_start":
        this.#emit(session, {
          type: "retry_status",
          sessionId: session.id,
          operation: event.operation,
          phase: "attempt_started",
        });
        break;
      case "retry_finished":
        this.#emit(session, {
          type: "retry_status",
          sessionId: session.id,
          operation: event.operation,
          phase: "finished",
        });
        break;
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.#emit(session, {
            type: "text_delta",
            sessionId: session.id,
            delta: event.assistantMessageEvent.delta,
          });
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          this.#emit(session, {
            type: "model_activity",
            sessionId: session.id,
          });
        }
        break;
      case "tool_execution_start": {
        const execution = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: event.args,
        };
        session.toolExecutions.push(execution);
        this.#emit(session, {
          type: "tool_started",
          sessionId: session.id,
          execution,
        });
        break;
      }
      case "tool_execution_update":
        this.#emit(session, {
          type: "tool_updated",
          sessionId: session.id,
          toolCallId: event.toolCallId,
          update: event.partialResult,
        });
        break;
      case "tool_execution_end": {
        const execution = session.toolExecutions.find(
          (item) => item.toolCallId === event.toolCallId,
        ) ?? {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: {},
        };
        execution.result = event.result;
        execution.isError = event.isError;
        this.#emit(session, {
          type: "tool_completed",
          sessionId: session.id,
          execution,
        });
        break;
      }
      default:
        break;
    }
  }

  #getSession(sessionId: string) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Agent session not found: ${sessionId}`);
    return session;
  }

  #emit(session: RuntimeSession, event: AgentRuntimeEvent) {
    for (const listener of session.listeners) listener(event);
  }
}
