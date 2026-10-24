import {
  compactionSettingsForContextWindow,
  createOpenAICompatiblePiRuntime,
  type AgentSessionHandle,
  type AgentRuntime as CoreAgentRuntime,
  type BashOperations,
  type RuntimeSessionPersistencePort,
  type CreateSessionInput,
  type RuntimeTool,
} from "@boltpocket/agent-runtime";
import type { ConnectorRegistry } from "@boltpocket/connector-core";
import { canonicalizeNotionMarkdown } from "@boltpocket/connector-notion";
import type { McpProxyPort } from "@boltpocket/mcp-client";
import { expoModelFetch } from "@/infrastructure/model-config/expo-model-fetch";
import { LOCAL_PROVIDER_ID } from "@/config/local-inference";
import {
  ProjectShell,
  type ProjectShellCommand,
  type ProjectShellFetch,
  type ProjectShellJavaScriptRuntime,
} from "@boltpocket/project-shell";
import { createProjectShellExtraCommands } from "@boltpocket/project-shell-extras";

import { agentSessionIdForConversation } from "@/application/agent-session";
import { isExplicitCapabilityInstallConfirmation } from "@/application/capability-install-confirmation";
import { isExplicitSkillPublicationRequest } from "@/application/skill-publication-intent";
import {
  AGENT_ACTIVITY_LIMITS,
  AgentExecutionActivityBuilder,
} from "@/application/agent-execution-activity";
import {
  AGENT_TEXT_LIMITS,
  BoundedTextAccumulator,
  boundText,
} from "@/application/bounded-text";
import { ResourceReadBudget } from "@/application/resource-read-budget";
import type {
  AgentContextUsage,
  AgentContextUsageInput,
  AgentRunInput,
  AgentRunObserver,
  AgentRunOutput,
  AgentRuntime,
} from "@/application/ports/agent-runtime";
import type { AgentCredentialAccessPort } from "@/application/ports/credential-vault";
import { GLOBAL_MCP_SCOPE_ID } from "@/application/ports/mcp-connections";
import type { AgentMediaAnalysisPort } from "@/application/ports/media-analysis";
import type {
  AgentImageGenerationPort,
  ImageGenerationCapability,
} from "@/application/ports/image-generation";
import type {
  AgentVideoGenerationPort,
  VideoGenerationCapability,
} from "@/application/ports/video-generation";
import type { AgentTextDelegationPort } from "@/application/ports/text-delegation";
import type { AgentThirdPartyCapabilityPort } from "@/application/ports/third-party-capabilities";
import type { AgentSkillMarketPublicationPort } from "@/application/ports/skill-market-publication";
import type { AgentBrowserControlPort } from "@/application/ports/browser-control";
import type { AgentDeviceCapabilityPort } from "@/application/ports/device-capabilities";
import type { ProjectPreviewSnapshotPort } from "@/application/ports/project-preview";
import type { ProjectResourceFilePort } from "@/application/ports/project-resource-files";
import type {
  ChangeProposal,
  CollaborationTask,
  WorkspaceResource,
} from "@/domain/models";
import { isProjectWorkspaceResource } from "@/domain/project-workspace";
import type { AppLocale } from "@/i18n/translate";
import {
  translateMessage,
  type MessageKey,
  type MessageValues,
} from "@/i18n/messages";
import type {
  AgentSshCredentialConnectionPort,
  SshCommandSession,
} from "@/application/ports/ssh-command-sessions";
import { toAgentRunEvent } from "@/infrastructure/agent/pi-runtime-events";
import {
  assertProposalTargetsCurrent,
  projectResourceRefsById,
  readCurrentWorkspaceResource,
  type ActiveRunContext,
} from "@/infrastructure/agent/pi-mobile-agent-context";
import {
  abortError,
  createContextReferences,
  createSessionResources,
  createSessionSystemPrompt,
  mobileSkillName,
  type McpPromptServer,
  toProposal,
} from "@/infrastructure/agent/pi-mobile-agent-session";
import {
  basePiMobileAgentToolNames,
  createPiMobileAgentTools,
  piMobileAgentToolNamesForSkill,
  restorablePiMobileAgentToolNames,
} from "@/infrastructure/agent/pi-mobile-agent-tools";
import {
  AGENT_JAVASCRIPT_MAX_INPUT_BYTES,
  type AgentJavaScriptToolInput,
} from "@/infrastructure/agent/pi-mobile-agent-javascript";
import {
  assertProjectShellCwd,
  normalizeProjectShellPath,
  PROJECT_SHELL_ROOT,
  projectShellPathForResource,
} from "@/infrastructure/agent/workspace-project-shell";
import { WorkspacePiCodingTools } from "@/infrastructure/agent/workspace-pi-coding-tools";
import {
  createBoltPocketQuickJsProjectShellRuntime,
  createBoltPocketSshProjectShellTransport,
  createSshProjectShellCommands,
  type SshProjectShellTransport,
} from "@/infrastructure/shell";

type MobileModelRuntimeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  contextWindow: number;
  thinkingLevel: NonNullable<CreateSessionInput["thinkingLevel"]>;
  providerId?: string;
  providerKind?: "openai-compatible" | "openai-codex";
  protocol?: "chat-completions" | "responses";
  modelProfileId?: string;
  authIdentity?: string;
  fetch?: typeof fetch;
  capabilities?: {
    vision: boolean;
    reasoning: boolean;
  };
};

type PiMobileAgentRuntimeOptions = {
  locale?: () => AppLocale;
  coreRuntime?: CoreAgentRuntime;
  modelConfigProvider?: (
    modelProfileId?: string,
  ) => Promise<MobileModelRuntimeConfig>;
  thinkingLevel?: NonNullable<CreateSessionInput["thinkingLevel"]>;
  registryFactory?: (
    input: AgentRunInput,
  ) => ConnectorRegistry | Promise<ConnectorRegistry>;
  projectShellJavaScriptRuntime?: ProjectShellJavaScriptRuntime | null;
  publicReadFetch?: ProjectShellFetch;
  sshProjectShellTransportFactory?: () =>
    SshProjectShellTransport | Promise<SshProjectShellTransport>;
  sshProjectShellSessionsProvider?: (
    projectId: string,
  ) => readonly SshCommandSession[];
  sessionPersistence?: RuntimeSessionPersistencePort;
  mcpProxy?: McpProxyPort & {
    closeAll?: () => Promise<void>;
    retainProject?: (projectId: string) => () => void;
  };
  thirdPartyCapabilities?: AgentThirdPartyCapabilityPort;
  skillMarketPublication?: AgentSkillMarketPublicationPort;
  credentialAccess?: AgentCredentialAccessPort;
  sshCredentialConnection?: AgentSshCredentialConnectionPort;
  browserControl?: AgentBrowserControlPort;
  projectPreview?: ProjectPreviewSnapshotPort;
  projectResourceFiles?: ProjectResourceFilePort;
  mediaAnalysis?: AgentMediaAnalysisPort;
  imageGeneration?: AgentImageGenerationPort;
  videoGeneration?: AgentVideoGenerationPort;
  textDelegation?: AgentTextDelegationPort;
  deviceCapabilities?: AgentDeviceCapabilityPort;
};

const MOBILE_PROJECT_SHELL_LIMITS = Object.freeze({
  maxCommandLength: 20_000,
  maxOutputBytes: 128 * 1024,
  maxProjectEntries: 2_000,
  maxProjectBytes: 8 * 1024 * 1024,
  maxExecutionTimeMs: 5_000,
  maxJavaScriptMemoryBytes: 16 * 1024 * 1024,
  maxJavaScriptStackBytes: 512 * 1024,
});
const MAX_RECORDED_TOOL_ACTIVITY = 64;
const MAX_COLLABORATION_TASKS = 3;
const MAX_COLLABORATION_SUMMARY_CHARACTERS = 12_000;
const MAX_COMPLETION_TARGETS = 8;
const MAX_PROTECTED_SKILL_REDACTION_SEGMENTS = 512;
const MIN_PROTECTED_SKILL_REDACTION_CHARACTERS = 12;
const PROTECTED_SKILL_REDACTION_SEGMENT_CHARACTERS = 160;
const MCP_SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;

function mcpPromptServersFromStatus(
  value: unknown,
): readonly McpPromptServer[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const status = value as Record<string, unknown>;
  if (status.action !== "status" || !Array.isArray(status.servers)) return [];
  if (status.servers.length > 100) return [];
  const seen = new Set<string>();
  const servers: McpPromptServer[] = [];
  for (const candidate of status.servers) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return [];
    }
    const server = candidate as Record<string, unknown>;
    if (
      typeof server.id !== "string" ||
      !MCP_SERVER_ID.test(server.id) ||
      seen.has(server.id) ||
      typeof server.name !== "string" ||
      !server.name.trim() ||
      server.name.length > 160
    ) {
      return [];
    }
    seen.add(server.id);
    servers.push({ id: server.id, name: server.name.trim() });
  }
  return servers;
}

function collaborationInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    !["scout", "planner", "reviewer"].includes(String(input.agent)) ||
    typeof input.description !== "string" ||
    !input.description.trim()
  ) {
    return null;
  }
  return {
    role: input.agent as CollaborationTask["role"],
    description: boundText(input.description.trim(), 80),
  };
}

function collaborationResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { summary: "", toolActivity: [] as string[] };
  }
  const result = value as Record<string, unknown>;
  const summary = Array.isArray(result.content)
    ? result.content
        .filter((block): block is { type: "text"; text: string } =>
          Boolean(
            block &&
            typeof block === "object" &&
            !Array.isArray(block) &&
            (block as Record<string, unknown>).type === "text" &&
            typeof (block as Record<string, unknown>).text === "string",
          ),
        )
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";
  const details =
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  const toolActivity = Array.isArray(details.toolActivity)
    ? details.toolActivity
        .filter((label): label is string => typeof label === "string")
        .slice(0, 32)
        .map((label) =>
          boundText(label, AGENT_TEXT_LIMITS.toolActivityCharacters),
        )
    : [];
  return { summary, toolActivity };
}

function completionWithoutModelText(
  proposal: ChangeProposal | undefined,
  toolActivity: readonly string[],
  t: (key: MessageKey, values?: MessageValues) => string,
) {
  if (proposal?.hunks.length) {
    const targets = [...new Set(proposal.hunks.map((hunk) => hunk.target))];
    const visibleTargets = targets.slice(0, MAX_COMPLETION_TARGETS);
    const remaining = targets.length - visibleTargets.length;
    return [
      t("runtime.agent.completion.proposalHeader", {
        count: proposal.hunks.length,
      }),
      ...visibleTargets.map((target) => `- ${target}`),
      ...(remaining > 0
        ? [t("runtime.agent.completion.moreFiles", { count: remaining })]
        : []),
      "",
      t("runtime.agent.completion.proposalReview"),
    ].join("\n");
  }
  if (toolActivity.length) {
    return t("runtime.agent.completion.toolOnly");
  }
  return null;
}

const MOBILE_PROJECT_SHELL_RUNTIME_COMMANDS = createProjectShellExtraCommands({
  limits: {
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: MOBILE_PROJECT_SHELL_LIMITS.maxOutputBytes,
    maxArchiveBytes: 4 * 1024 * 1024,
    maxArchiveEntries: 1_000,
    maxExtractedBytes: MOBILE_PROJECT_SHELL_LIMITS.maxProjectBytes,
    maxTraversalEntries: MOBILE_PROJECT_SHELL_LIMITS.maxProjectEntries,
    maxStructuredNodes: 20_000,
    maxCsvRows: 2_000,
    maxCsvCells: 40_000,
    maxSqlRows: 1_000,
    maxSqlTimeMs: 2_000,
    maxDatabaseBytes: 4 * 1024 * 1024,
  },
});

export class PiMobileAgentRuntime implements AgentRuntime {
  #core?: CoreAgentRuntime;
  #thinkingLevel: NonNullable<CreateSessionInput["thinkingLevel"]>;
  readonly #coresBySessionId = new Map<string, CoreAgentRuntime>();
  readonly #coreSignaturesBySessionId = new Map<string, string>();
  readonly #thinkingLevelsBySessionId = new Map<
    string,
    NonNullable<CreateSessionInput["thinkingLevel"]>
  >();
  readonly #mainSupportsImagesBySessionId = new Map<string, boolean>();
  readonly #contextWindowsBySessionId = new Map<string, number>();
  readonly #fixedCore: boolean;
  readonly #modelConfigProvider?: PiMobileAgentRuntimeOptions["modelConfigProvider"];
  readonly #locale: () => AppLocale;
  readonly #activeContexts = new Map<string, ActiveRunContext>();
  readonly #runningSessionIds = new Set<string>();
  readonly #conversationProjectBindings = new Map<string, string | null>();
  readonly #sessions = new Map<string, Promise<AgentSessionHandle>>();
  readonly #sessionResourceSignatures = new Map<string, string>();
  readonly #registeredToolsBySessionId = new Map<
    string,
    readonly RuntimeTool[]
  >();
  readonly #baseToolNamesBySessionId = new Map<string, readonly string[]>();
  readonly #activeToolNamesBySessionId = new Map<string, Set<string>>();
  readonly #skillToolActivationQueues = new Map<string, Promise<void>>();
  readonly #mcpServerNamesBySessionId = new Map<
    string,
    ReadonlyMap<string, string>
  >();
  readonly #registryFactory?: PiMobileAgentRuntimeOptions["registryFactory"];
  readonly #sessionPersistence?: RuntimeSessionPersistencePort;
  readonly #mcpProxy?: PiMobileAgentRuntimeOptions["mcpProxy"];
  readonly #thirdPartyCapabilities?: AgentThirdPartyCapabilityPort;
  readonly #skillMarketPublication?: AgentSkillMarketPublicationPort;
  readonly #credentialAccess?: AgentCredentialAccessPort;
  readonly #sshCredentialConnection?: AgentSshCredentialConnectionPort;
  readonly #browserControl?: AgentBrowserControlPort;
  readonly #projectPreview?: ProjectPreviewSnapshotPort;
  readonly #projectResourceFiles?: ProjectResourceFilePort;
  readonly #mediaAnalysis?: AgentMediaAnalysisPort;
  readonly #imageGeneration?: AgentImageGenerationPort;
  readonly #videoGeneration?: AgentVideoGenerationPort;
  readonly #textDelegation?: AgentTextDelegationPort;
  readonly #deviceCapabilities?: AgentDeviceCapabilityPort;
  readonly #sessionSecrets = new Map<string, Set<string>>();
  readonly #contextInjections = new Map<string, Map<string, string>>();
  #sensitiveMarkerSequence = 0;
  readonly #projectShellJavaScriptRuntime?: ProjectShellJavaScriptRuntime;
  readonly #publicReadFetch?: ProjectShellFetch;
  readonly #sshProjectShellTransportFactory: NonNullable<
    PiMobileAgentRuntimeOptions["sshProjectShellTransportFactory"]
  >;
  readonly #sshProjectShellSessionsProvider: NonNullable<
    PiMobileAgentRuntimeOptions["sshProjectShellSessionsProvider"]
  >;
  #sshProjectShellTransport?: Promise<SshProjectShellTransport>;

  constructor(options: PiMobileAgentRuntimeOptions = {}) {
    this.#locale = options.locale ?? (() => "zh-CN");
    this.#registryFactory = options.registryFactory;
    this.#sessionPersistence = options.sessionPersistence;
    this.#mcpProxy = options.mcpProxy;
    this.#thirdPartyCapabilities = options.thirdPartyCapabilities;
    this.#skillMarketPublication = options.skillMarketPublication;
    this.#credentialAccess = options.credentialAccess;
    this.#sshCredentialConnection = options.sshCredentialConnection;
    this.#browserControl = options.browserControl;
    this.#projectPreview = options.projectPreview;
    this.#projectResourceFiles = options.projectResourceFiles;
    this.#mediaAnalysis = options.mediaAnalysis;
    this.#imageGeneration = options.imageGeneration;
    this.#videoGeneration = options.videoGeneration;
    this.#textDelegation = options.textDelegation;
    this.#deviceCapabilities = options.deviceCapabilities;
    this.#modelConfigProvider = options.modelConfigProvider;
    this.#thinkingLevel = options.thinkingLevel ?? "off";
    this.#projectShellJavaScriptRuntime =
      options.projectShellJavaScriptRuntime === null
        ? undefined
        : (options.projectShellJavaScriptRuntime ??
          createBoltPocketQuickJsProjectShellRuntime());
    this.#publicReadFetch = options.publicReadFetch;
    this.#sshProjectShellTransportFactory =
      options.sshProjectShellTransportFactory ??
      createBoltPocketSshProjectShellTransport;
    this.#sshProjectShellSessionsProvider =
      options.sshProjectShellSessionsProvider ?? (() => []);
    this.#fixedCore = Boolean(options.coreRuntime);
    if (options.coreRuntime) {
      this.#core = options.coreRuntime;
    }
  }

  async run(
    input: AgentRunInput,
    signal: AbortSignal,
    onEvent?: AgentRunObserver,
  ): Promise<AgentRunOutput> {
    if (signal.aborted) throw abortError();
    const t = (key: MessageKey, values?: MessageValues) =>
      translateMessage(key, this.#locale(), values);
    const sessionId = agentSessionIdForConversation(input.conversationId);
    if (this.#runningSessionIds.has(sessionId)) {
      throw new Error("当前对话已有正在运行的任务，请等待完成或先取消。");
    }
    this.#assertConversationProjectBinding(
      sessionId,
      input.project?.id ?? null,
    );
    this.#runningSessionIds.add(sessionId);
    const releaseMcpTransport =
      this.#mcpProxy?.retainProject?.(GLOBAL_MCP_SCOPE_ID);
    let activeContext: ActiveRunContext | undefined;
    let activeCore: CoreAgentRuntime | undefined;
    let unsubscribe: () => void = () => undefined;
    const activity = new AgentExecutionActivityBuilder();
    const toolActivity: string[] = [];
    const toolActivityIndexByCallId = new Map<string, number>();
    const activeSubagentCallIds = new Set<string>();
    const collaboration = new Map<string, CollaborationTask>();
    let lastModelActivityAt = 0;
    let pendingPublicText = new BoundedTextAccumulator(
      AGENT_ACTIVITY_LIMITS.textItemCharacters,
    );
    const reportModelActivity = () => {
      const now = Date.now();
      if (!signal.aborted && now - lastModelActivityAt >= 1_000) {
        lastModelActivityAt = now;
        onEvent?.({ type: "model-activity" });
      }
    };
    const flushPublicText = () => {
      const content = boundText(
        this.#redactSessionText(sessionId, pendingPublicText.value()).trim(),
        AGENT_ACTIVITY_LIMITS.textItemCharacters,
      );
      pendingPublicText = new BoundedTextAccumulator(
        AGENT_ACTIVITY_LIMITS.textItemCharacters,
      );
      if (!content || signal.aborted) return;
      activity.appendText(content);
      onEvent?.({ type: "assistant-text", content });
    };

    try {
      const core = await this.#ensureCore(sessionId, input.modelProfileId);
      activeCore = core;
      const imageGenerationCapability = this.#imageGeneration
        ? await this.#imageGeneration.capability().catch(() => null)
        : null;
      const videoGenerationCapability = this.#videoGeneration
        ? await this.#videoGeneration.capability().catch(() => null)
        : null;
      const context: ActiveRunContext = {
        input,
        signal,
        registry: await this.#createRegistry(input),
        readBudget: new ResourceReadBudget({
          maxResources: MOBILE_PROJECT_SHELL_LIMITS.maxProjectEntries,
          maxCharacters: MOBILE_PROJECT_SHELL_LIMITS.maxProjectBytes,
        }),
        resourceSnapshots: new Map(),
        onEvent,
      };
      activeContext = context;
      this.#activeContexts.set(sessionId, context);
      await this.#ensureSession(
        core,
        sessionId,
        input,
        imageGenerationCapability,
        videoGenerationCapability,
      );
      if (
        input.project &&
        isExplicitCapabilityInstallConfirmation(input.prompt) &&
        this.#thirdPartyCapabilities?.hasAssessmentAwaitingConfirmation({
          conversationId: input.conversationId,
          projectId: input.project.id,
        })
      ) {
        await this.#activateSkillTools(core, sessionId, "install-capabilities");
      }
      if (
        input.project &&
        isExplicitSkillPublicationRequest(input.prompt) &&
        this.#skillMarketPublication?.hasReviewAwaitingPublication({
          conversationId: input.conversationId,
          projectId: input.project.id,
        })
      ) {
        await this.#activateSkillTools(core, sessionId, "publish-skill");
      }
      unsubscribe = core.subscribe(sessionId, (event) => {
        if (event.type === "text_delta") {
          pendingPublicText.append(event.delta);
          reportModelActivity();
          return;
        }
        if (event.type === "model_activity") {
          reportModelActivity();
          return;
        }
        if (event.type === "tool_started") flushPublicText();
        const mappedRunEvent = toAgentRunEvent(event, this.#locale(), {
          mcpServerNames: this.#mcpServerNamesBySessionId.get(sessionId),
        });
        const runEvent =
          mappedRunEvent && "label" in mappedRunEvent
            ? {
                ...mappedRunEvent,
                label: boundText(
                  this.#redactSessionText(sessionId, mappedRunEvent.label),
                  AGENT_TEXT_LIMITS.toolActivityCharacters,
                ),
                ...(mappedRunEvent.type === "tool-completed" &&
                mappedRunEvent.failureReason
                  ? {
                      failureReason: boundText(
                        this.#redactSessionText(
                          sessionId,
                          mappedRunEvent.failureReason,
                        ),
                        AGENT_TEXT_LIMITS.toolFailureReasonCharacters,
                      ),
                    }
                  : {}),
              }
            : mappedRunEvent;
        if (
          runEvent?.type === "tool-started" &&
          !(
            event.type === "tool_started" &&
            event.execution.toolName === "subagent"
          ) &&
          toolActivity.length < MAX_RECORDED_TOOL_ACTIVITY
        ) {
          toolActivityIndexByCallId.set(
            event.type === "tool_started"
              ? event.execution.toolCallId
              : `tool-${toolActivity.length}`,
            toolActivity.length,
          );
          toolActivity.push(runEvent.label);
        } else if (
          runEvent?.type === "tool-completed" &&
          event.type === "tool_completed"
        ) {
          const index = toolActivityIndexByCallId.get(
            event.execution.toolCallId,
          );
          if (index !== undefined) {
            toolActivity[index] = boundText(
              `${runEvent.label} · ${
                runEvent.outcome === "failed"
                  ? t("runtime.messaging.tool.failed")
                  : runEvent.outcome === "staged"
                    ? t("runtime.messaging.tool.staged")
                    : t("runtime.messaging.tool.complete")
              }`,
              AGENT_TEXT_LIMITS.toolActivityCharacters,
            );
            toolActivityIndexByCallId.delete(event.execution.toolCallId);
          }
        }
        let visibleRunEvent = runEvent;
        if (
          event.type === "tool_started" &&
          event.execution.toolName === "subagent"
        ) {
          const input = collaborationInput(event.execution.arguments);
          if (input && collaboration.size < MAX_COLLABORATION_TASKS) {
            const task: CollaborationTask = {
              id: event.execution.toolCallId,
              ...input,
              status: "running",
              startedAt: Date.now(),
            };
            collaboration.set(task.id, task);
            activeSubagentCallIds.add(task.id);
            if (!signal.aborted) {
              onEvent?.({ type: "collaboration-updated", task });
            }
          }
          if (activeSubagentCallIds.size > 1) {
            visibleRunEvent = {
              type: "status",
              label: t("runtime.agent.collaboration.parallel", {
                count: activeSubagentCallIds.size,
              }),
            };
          }
        } else if (
          event.type === "tool_completed" &&
          event.execution.toolName === "subagent"
        ) {
          const previous = collaboration.get(event.execution.toolCallId);
          if (previous) {
            const parsed = collaborationResult(event.execution.result);
            const task: CollaborationTask = {
              ...previous,
              status: event.execution.isError ? "failed" : "completed",
              durationMs: Math.max(0, Date.now() - previous.startedAt),
              summary: boundText(
                this.#redactSessionText(
                  sessionId,
                  parsed.summary ||
                    (event.execution.isError
                      ? t("runtime.agent.collaboration.taskFailed")
                      : t("runtime.agent.collaboration.noSummary")),
                ),
                MAX_COLLABORATION_SUMMARY_CHARACTERS,
              ),
              ...(parsed.toolActivity.length
                ? { toolActivity: parsed.toolActivity }
                : {}),
            };
            collaboration.set(task.id, task);
            activeSubagentCallIds.delete(task.id);
            if (!signal.aborted) {
              onEvent?.({ type: "collaboration-updated", task });
            }
          }
          if (activeSubagentCallIds.size > 0) {
            visibleRunEvent = {
              type: "status",
              label: t(
                event.execution.isError
                  ? "runtime.agent.collaboration.failedRemaining"
                  : "runtime.agent.collaboration.remaining",
                { count: activeSubagentCallIds.size },
              ),
            };
          }
        }
        if (visibleRunEvent && !signal.aborted) {
          if (visibleRunEvent.type === "tool-started") {
            activity.startTool(
              visibleRunEvent.toolCallId,
              visibleRunEvent.label,
            );
          } else if (visibleRunEvent.type === "tool-completed") {
            activity.completeTool(
              visibleRunEvent.toolCallId,
              visibleRunEvent.label,
              visibleRunEvent.outcome,
              Date.now(),
              visibleRunEvent.failureReason,
            );
          } else if (visibleRunEvent.type === "context-maintenance") {
            if (visibleRunEvent.phase === "started") {
              activity.startContextMaintenance(visibleRunEvent.operation);
            } else {
              activity.completeContextMaintenance(
                visibleRunEvent.operation,
                visibleRunEvent.phase,
                visibleRunEvent.tokensBefore,
                visibleRunEvent.tokensAfter,
              );
            }
          }
          onEvent?.(visibleRunEvent);
        }
      });
      const result = await core.send(sessionId, input.prompt, {
        signal,
        images: this.#supportsImages(sessionId)
          ? input.attachments.map((attachment) => ({
              data: attachment.base64,
              mimeType: attachment.mimeType,
            }))
          : [],
      });
      if (result.status === "cancelled" || signal.aborted) {
        throw abortError();
      }
      if (result.status === "failed") {
        throw new Error(
          this.#redactSessionText(
            sessionId,
            result.error ?? t("runtime.agent.error.runFailed"),
          ),
        );
      }
      await this.#finalizeStagedProposal(context);
      const usedCredential = Boolean(context.sensitiveAccessApproved);
      const modelText = this.#redactSessionText(sessionId, result.text).trim();
      const fallbackText = completionWithoutModelText(
        context.proposal,
        toolActivity,
        t,
      );
      const completionText = usedCredential
        ? t("runtime.agent.completion.sensitive")
        : modelText || fallbackText;
      if (!completionText) {
        throw new Error(t("runtime.agent.error.invalidResponse"));
      }
      const executionActivity = activity.finish();
      return {
        content: usedCredential
          ? completionText
          : boundText(
              completionText,
              AGENT_TEXT_LIMITS.storedResponseCharacters,
            ),
        ...(executionActivity.length ? { activity: executionActivity } : {}),
        ...(toolActivity.length ? { toolActivity } : {}),
        ...(collaboration.size
          ? { collaboration: [...collaboration.values()] }
          : {}),
        ...(context.generatedMedia?.length
          ? { attachments: [...context.generatedMedia] }
          : {}),
        context: createContextReferences(input, this.#locale()),
        proposal: context.proposal,
      };
    } finally {
      unsubscribe();
      releaseMcpTransport?.();
      if (input.project && this.#browserControl?.closeRun) {
        await Promise.resolve(
          this.#browserControl.closeRun(input.project.id, input.runId),
        ).catch(() => undefined);
      }
      this.#contextInjections.delete(sessionId);
      if (
        activeCore &&
        activeContext?.sensitiveAccessApproved &&
        this.#sessionPersistence
      ) {
        await this.#retireSensitiveSession(activeCore, sessionId);
      }
      this.#runningSessionIds.delete(sessionId);
      if (
        activeContext &&
        this.#activeContexts.get(sessionId) === activeContext
      ) {
        this.#activeContexts.delete(sessionId);
      }
    }
  }

  async steer(
    conversationId: string,
    content: string,
    attachments: AgentRunInput["attachments"] = [],
  ): Promise<void> {
    const sessionId = agentSessionIdForConversation(conversationId);
    if (
      !this.#sessions.has(sessionId) ||
      !this.#runningSessionIds.has(sessionId) ||
      !this.#activeContexts.has(sessionId)
    ) {
      throw new Error("当前对话没有正在运行的 Agent 会话。");
    }
    await this.#requiredCore(sessionId).steer(sessionId, {
      text: content,
      images: attachments.map((attachment) => ({
        data: attachment.base64,
        mimeType: attachment.mimeType,
      })),
    });
  }

  async contextUsage(
    conversationId: string,
    input: AgentContextUsageInput,
  ): Promise<AgentContextUsage> {
    const sessionId = agentSessionIdForConversation(conversationId);
    if (this.#fixedCore) {
      const creation = this.#sessions.get(sessionId);
      if (creation && this.#core) {
        await creation;
        return {
          ...(await this.#core.contextUsage(sessionId)),
          estimated: false,
        };
      }
      return this.#estimatedContextUsage(
        this.#contextWindowsBySessionId.get(sessionId) ?? 128_000,
        input.estimatedUsedTokens,
      );
    }

    const config = await this.#loadModelConfig(input.modelProfileId);
    const core = this.#coresBySessionId.get(sessionId);
    const creation = this.#sessions.get(sessionId);
    if (
      core &&
      creation &&
      this.#contextWindowsBySessionId.get(sessionId) === config.contextWindow
    ) {
      await creation;
      return {
        ...(await core.contextUsage(sessionId)),
        estimated: false,
      };
    }
    return this.#estimatedContextUsage(
      config.contextWindow,
      input.estimatedUsedTokens,
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const sessionId = agentSessionIdForConversation(conversationId);
    await this.#waitForSessionIdle(sessionId);
    const core = this.#fixedCore
      ? this.#core
      : this.#coresBySessionId.get(sessionId);
    if (core?.deleteSession) {
      await core.deleteSession(sessionId);
    } else {
      if (core && this.#sessions.has(sessionId)) {
        await this.#sessions.get(sessionId);
        await core.destroySession(sessionId);
      }
    }
    // The host-owned encrypted store is authoritative even when a supplied
    // core uses a different persistence adapter. Deletion is idempotent.
    await this.#sessionPersistence?.delete(sessionId);
    this.#sessions.delete(sessionId);
    this.#sessionResourceSignatures.delete(sessionId);
    this.#clearSessionToolProfile(sessionId);
    this.#mcpServerNamesBySessionId.delete(sessionId);
    this.#activeContexts.delete(sessionId);
    this.#conversationProjectBindings.delete(sessionId);
    this.#sessionSecrets.delete(sessionId);
    this.#contextInjections.delete(sessionId);
    this.#coreSignaturesBySessionId.delete(sessionId);
    this.#thinkingLevelsBySessionId.delete(sessionId);
    this.#mainSupportsImagesBySessionId.delete(sessionId);
    this.#contextWindowsBySessionId.delete(sessionId);
    if (!this.#fixedCore) this.#coresBySessionId.delete(sessionId);
  }

  async releaseConversationResources(conversationId: string): Promise<void> {
    const sessionId = agentSessionIdForConversation(conversationId);
    await this.#waitForSessionIdle(sessionId);
    const core = this.#fixedCore
      ? this.#core
      : this.#coresBySessionId.get(sessionId);
    const creation = this.#sessions.get(sessionId);
    try {
      if (core && creation) {
        await creation;
        await core.destroySession(sessionId);
      }
    } finally {
      this.#sessions.delete(sessionId);
      this.#sessionResourceSignatures.delete(sessionId);
      this.#clearSessionToolProfile(sessionId);
      this.#mcpServerNamesBySessionId.delete(sessionId);
      this.#activeContexts.delete(sessionId);
      this.#sessionSecrets.delete(sessionId);
      this.#contextInjections.delete(sessionId);
      this.#coreSignaturesBySessionId.delete(sessionId);
      this.#thinkingLevelsBySessionId.delete(sessionId);
      this.#mainSupportsImagesBySessionId.delete(sessionId);
      this.#contextWindowsBySessionId.delete(sessionId);
      if (!this.#fixedCore) this.#coresBySessionId.delete(sessionId);
    }
  }

  async dispose() {
    await Promise.all([
      ...[...this.#sessions.keys()].map((sessionId) =>
        this.#requiredCore(sessionId)
          .destroySession(sessionId)
          .catch(() => undefined),
      ),
      this.#mcpProxy?.closeAll?.().catch(() => undefined),
    ]);
    this.#sessions.clear();
    this.#sessionResourceSignatures.clear();
    this.#registeredToolsBySessionId.clear();
    this.#baseToolNamesBySessionId.clear();
    this.#activeToolNamesBySessionId.clear();
    this.#skillToolActivationQueues.clear();
    this.#mcpServerNamesBySessionId.clear();
    this.#activeContexts.clear();
    this.#runningSessionIds.clear();
    this.#conversationProjectBindings.clear();
    this.#sessionSecrets.clear();
    this.#contextInjections.clear();
    this.#coresBySessionId.clear();
    this.#coreSignaturesBySessionId.clear();
    this.#thinkingLevelsBySessionId.clear();
    this.#mainSupportsImagesBySessionId.clear();
    this.#contextWindowsBySessionId.clear();
    if (!this.#fixedCore) this.#core = undefined;
  }

  async #waitForSessionIdle(sessionId: string) {
    if (!this.#runningSessionIds.has(sessionId)) return;
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (!this.#runningSessionIds.has(sessionId)) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= 10_000) {
          reject(new Error("当前任务仍在停止中，请稍后再删除。"));
          return;
        }
        setTimeout(poll, 25);
      };
      poll();
    });
  }

  async #ensureSession(
    core: CoreAgentRuntime,
    sessionId: string,
    input: AgentRunInput,
    imageGenerationCapability: ImageGenerationCapability | null,
    videoGenerationCapability: VideoGenerationCapability | null,
  ) {
    const mcpServers = await this.#mcpPromptServers();
    this.#mcpServerNamesBySessionId.set(
      sessionId,
      new Map(mcpServers.map((server) => [server.id, server.name])),
    );
    const resourceSignature = JSON.stringify([
      input.project?.id ?? null,
      input.project?.instructions ?? "",
      input.skills.map((skill) => [
        skill.id,
        skill.description,
        skill.content,
        skill.risk,
        skill.enabled,
      ]),
      (input.resourcePacks ?? []).map((pack) => pack.id),
      mcpServers.map((server) => [server.id, server.name]),
      imageGenerationCapability
        ? [
            imageGenerationCapability.providerId,
            imageGenerationCapability.providerName,
            imageGenerationCapability.modelProfileId,
            imageGenerationCapability.modelId,
          ]
        : null,
      videoGenerationCapability
        ? [
            videoGenerationCapability.providerId,
            videoGenerationCapability.providerName,
            videoGenerationCapability.modelProfileId,
            videoGenerationCapability.modelId,
          ]
        : null,
    ]);
    const existing = this.#sessions.get(sessionId);
    if (
      existing &&
      this.#sessionResourceSignatures.get(sessionId) === resourceSignature
    ) {
      await existing;
      return existing;
    }
    if (existing) {
      await existing;
      await core.destroySession(sessionId);
      this.#sessions.delete(sessionId);
      this.#clearSessionToolProfile(sessionId);
    }
    const resources = createSessionResources(input);
    const protectedSkillIds = new Set(input.protectedSkillIds ?? []);
    const protectedSkillDocuments = new Map(
      input.skills
        .filter((skill) => skill.enabled)
        .flatMap((skill, index) =>
          protectedSkillIds.has(skill.id)
            ? [[mobileSkillName(skill.id, index), skill.content] as const]
            : [],
        ),
    );
    if (protectedSkillDocuments.size !== protectedSkillIds.size) {
      throw new Error("Protected Skill runtime metadata is invalid.");
    }
    const enabledSkillNames = new Set(
      (resources.skills ?? []).map((skill) => skill.name),
    );
    const hasSkill = (name: string) => enabledSkillNames.has(name);
    const tools = createPiMobileAgentTools({
      requiredContext: () => this.#requiredContext(sessionId),
      projectTools: () => this.#projectTools(sessionId),
      executeProjectBash: (command, cwd, options) =>
        this.#executeProjectBash(sessionId, command, cwd, options),
      activateSkillTools: (skillName) =>
        this.#activateSkillTools(core, sessionId, skillName),
      protectSkillContent: (skillName, content) => {
        const protectedDocument = protectedSkillDocuments.get(skillName);
        return protectedDocument === undefined
          ? content
          : this.#registerProtectedSkillContent(
              sessionId,
              content,
              protectedDocument,
            );
      },
      ...(this.#projectShellJavaScriptRuntime
        ? {
            executeJavaScript: (javaScriptInput, signal) =>
              this.#executeAgentJavaScript(sessionId, javaScriptInput, signal),
          }
        : {}),
      credentialAccess: this.#credentialAccess,
      mcpProxy: mcpServers.length > 0 ? this.#mcpProxy : undefined,
      thirdPartyCapabilities:
        input.project && hasSkill("install-capabilities")
          ? this.#thirdPartyCapabilities
          : undefined,
      skillMarketPublication:
        input.project && hasSkill("publish-skill")
          ? this.#skillMarketPublication
          : undefined,
      locale: this.#locale(),
      sshCredentialConnection: hasSkill("operate-ssh")
        ? this.#sshCredentialConnection
        : undefined,
      browserControl:
        hasSkill("operate-browser") || hasSkill("build-h5")
          ? this.#browserControl
          : undefined,
      projectPreview:
        hasSkill("build-h5") || hasSkill("operate-browser")
          ? this.#projectPreview
          : undefined,
      projectResourceFiles: this.#projectResourceFiles,
      mediaAnalysis: this.#mediaAnalysis,
      imageGeneration: imageGenerationCapability
        ? this.#imageGeneration
        : undefined,
      videoGeneration: videoGenerationCapability
        ? this.#videoGeneration
        : undefined,
      textDelegation: this.#textDelegation,
      deviceCapabilities: [
        "operate-device",
        "manage-calendar-reminders",
        "read-device-sensors",
        "play-device-audio",
      ].some(hasSkill)
        ? this.#deviceCapabilities
        : undefined,
      translate: (key, values) => translateMessage(key, this.#locale(), values),
      registerSensitiveValue: (value) =>
        this.#registerSensitiveValue(sessionId, value),
    });
    const baseToolNames = basePiMobileAgentToolNames(tools);
    const restorableToolNames = restorablePiMobileAgentToolNames(
      enabledSkillNames,
      tools,
    );
    this.#registeredToolsBySessionId.set(sessionId, tools);
    this.#baseToolNamesBySessionId.set(sessionId, baseToolNames);
    this.#activeToolNamesBySessionId.set(sessionId, new Set(baseToolNames));
    const creation = core
      .createSession({
        id: sessionId,
        systemPrompt: createSessionSystemPrompt(
          input,
          resources,
          Boolean(this.#credentialAccess),
          Boolean(this.#sshCredentialConnection),
          Boolean(this.#browserControl && hasSkill("operate-browser")),
          Boolean(this.#projectShellJavaScriptRuntime),
          Boolean(this.#mediaAnalysis),
          Boolean(this.#textDelegation),
          mcpServers,
          imageGenerationCapability,
          videoGenerationCapability,
          this.#locale(),
        ),
        tools,
        baseActiveToolNames: [...baseToolNames],
        restorableActiveToolNames: [...restorableToolNames],
        thinkingLevel:
          this.#thinkingLevelsBySessionId.get(sessionId) ?? this.#thinkingLevel,
        resources,
        transformContextText: (text) =>
          this.#transformSessionContextText(sessionId, text),
        redactDurableText: (text) => this.#redactSessionText(sessionId, text),
        authorizeToolCall: async ({ arguments: arguments_ }) => {
          if (this.#activeContexts.get(sessionId)?.sensitiveAccessApproved) {
            return {
              allow: false,
              reason:
                "密码本读取后，本轮不能再调用其他工具；敏感内容只允许用于本轮模型推理。",
            };
          }
          if (this.#containsSessionSecret(sessionId, arguments_)) {
            return {
              allow: false,
              reason: "密码本内容不能进入工具参数；请只传递密码本记录 ID。",
            };
          }
          return undefined;
        },
      })
      .then((handle) => {
        const restoredToolNames = new Set(
          handle.activeToolNames?.filter((name) =>
            restorableToolNames.includes(name),
          ) ?? baseToolNames,
        );
        for (const name of baseToolNames) restoredToolNames.add(name);
        this.#activeToolNamesBySessionId.set(sessionId, restoredToolNames);
        return handle;
      })
      .catch((error) => {
        this.#sessions.delete(sessionId);
        this.#sessionResourceSignatures.delete(sessionId);
        this.#clearSessionToolProfile(sessionId);
        throw error;
      });
    this.#sessions.set(sessionId, creation);
    this.#sessionResourceSignatures.set(sessionId, resourceSignature);
    return creation;
  }

  async #activateSkillTools(
    core: CoreAgentRuntime,
    sessionId: string,
    skillName: string,
  ) {
    const registeredTools = this.#registeredToolsBySessionId.get(sessionId);
    if (!registeredTools) return [];
    const unlockedToolNames = piMobileAgentToolNamesForSkill(
      skillName,
      registeredTools,
    );
    if (unlockedToolNames.length === 0) return [];

    const previous = this.#skillToolActivationQueues.get(sessionId);
    const activation = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const activeToolNames = new Set(
          this.#activeToolNamesBySessionId.get(sessionId) ??
            this.#baseToolNamesBySessionId.get(sessionId) ??
            [],
        );
        const changed = unlockedToolNames.some(
          (toolName) => !activeToolNames.has(toolName),
        );
        if (!changed) return;
        for (const toolName of unlockedToolNames) {
          activeToolNames.add(toolName);
        }
        const orderedToolNames = registeredTools
          .map((tool) => tool.name)
          .filter((toolName) => activeToolNames.has(toolName));
        await core.setActiveTools(sessionId, orderedToolNames);
        this.#activeToolNamesBySessionId.set(sessionId, activeToolNames);
      });
    this.#skillToolActivationQueues.set(sessionId, activation);
    try {
      await activation;
    } finally {
      if (this.#skillToolActivationQueues.get(sessionId) === activation) {
        this.#skillToolActivationQueues.delete(sessionId);
      }
    }
    return unlockedToolNames;
  }

  #clearSessionToolProfile(sessionId: string) {
    this.#registeredToolsBySessionId.delete(sessionId);
    this.#baseToolNamesBySessionId.delete(sessionId);
    this.#activeToolNamesBySessionId.delete(sessionId);
    this.#skillToolActivationQueues.delete(sessionId);
  }

  async #mcpPromptServers() {
    if (!this.#mcpProxy) return [];
    try {
      return mcpPromptServersFromStatus(
        await this.#mcpProxy.execute(GLOBAL_MCP_SCOPE_ID, {
          action: "status",
        }),
      );
    } catch {
      return [];
    }
  }

  #registerSensitiveValue(sessionId: string, value: string) {
    const secrets = this.#sessionSecrets.get(sessionId) ?? new Set<string>();
    secrets.add(value);
    this.#sessionSecrets.set(sessionId, secrets);
    const marker = `[[BOLTPOCKET_CREDENTIAL:${Date.now().toString(36)}-${(this.#sensitiveMarkerSequence += 1).toString(
      36,
    )}]]`;
    const injections = this.#contextInjections.get(sessionId) ?? new Map();
    injections.set(marker, value);
    this.#contextInjections.set(sessionId, injections);
    return marker;
  }

  #registerProtectedSkillContent(
    sessionId: string,
    runtimeValue: string,
    protectedDocument: string,
  ) {
    const marker = this.#registerSensitiveValue(sessionId, runtimeValue);
    const secrets = this.#sessionSecrets.get(sessionId);
    if (!secrets) return marker;
    for (const segment of protectedSkillRedactionSegments(protectedDocument)) {
      secrets.add(segment);
    }
    return marker;
  }

  async #retireSensitiveSession(core: CoreAgentRuntime, sessionId: string) {
    try {
      await this.#sessions.get(sessionId);
      await core.destroySession(sessionId);
      this.#sessions.delete(sessionId);
      this.#sessionResourceSignatures.delete(sessionId);
      this.#clearSessionToolProfile(sessionId);
      this.#sessionSecrets.delete(sessionId);
      this.#contextInjections.delete(sessionId);
    } catch {
      // Keep the known-secret set and the existing session when a safe rebuild
      // from encrypted persistence cannot be guaranteed.
    }
  }

  #redactSessionText(sessionId: string, value: string) {
    return this.#redactKnownSecrets(sessionId, value).replace(
      /\[\[BOLTPOCKET_CREDENTIAL:[a-z0-9-]+\]\]/giu,
      "••••",
    );
  }

  #redactKnownSecrets(sessionId: string, value: string) {
    let result = value;
    const secrets = [...(this.#sessionSecrets.get(sessionId) ?? [])].sort(
      (left, right) => right.length - left.length,
    );
    for (const secret of secrets) {
      if (secret) result = result.split(secret).join("••••");
    }
    return result;
  }

  #transformSessionContextText(sessionId: string, value: string) {
    let result = this.#redactKnownSecrets(sessionId, value);
    const injections = this.#contextInjections.get(sessionId);
    if (injections) {
      for (const [marker, secret] of [...injections]) {
        if (!value.includes(marker)) continue;
        result = result.split(marker).join(secret);
        injections.delete(marker);
      }
      if (injections.size === 0) this.#contextInjections.delete(sessionId);
    }
    return result.replace(/\[\[BOLTPOCKET_CREDENTIAL:[a-z0-9-]+\]\]/giu, "••••");
  }

  #containsSessionSecret(sessionId: string, value: unknown): boolean {
    const secrets = this.#sessionSecrets.get(sessionId);
    if (!secrets || secrets.size === 0) return false;
    if (typeof value === "string") {
      return [...secrets].some((secret) => secret && value.includes(secret));
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.#containsSessionSecret(sessionId, item));
    }
    if (!value || typeof value !== "object") return false;
    return Object.values(value).some((item) =>
      this.#containsSessionSecret(sessionId, item),
    );
  }

  async #projectTools(sessionId: string): Promise<WorkspacePiCodingTools> {
    const active = this.#requiredContext(sessionId);
    if (!active.input.project) {
      throw new Error("当前对话没有绑定项目资源。");
    }
    if (active.toolEnvironment) return active.toolEnvironment;

    const creation = (async () => {
      const project = active.input.project!;
      const refs = await active.registry.listResources(project.id);
      const refsById = projectResourceRefsById(project.id, refs);
      const resources = active.input.resources.filter((resource) => {
        const ref = refsById.get(resource.id);
        return (
          resource.projectId === project.id &&
          ref?.connectorId === resource.connectionId
        );
      });
      return new WorkspacePiCodingTools({
        projectId: project.id,
        resources,
        readBudget: active.readBudget,
        refreshResource: async (resource) => {
          const ref = refsById.get(resource.id);
          if (
            !ref ||
            ref.connectorId !== resource.connectionId ||
            ref.projectId !== project.id
          ) {
            throw new Error(`资源不在当前项目连接器范围：${resource.id}`);
          }
          return readCurrentWorkspaceResource(active, ref);
        },
      });
    })();
    active.toolEnvironment = creation;
    return creation;
  }

  async #executeProjectBash(
    sessionId: string,
    command: string,
    cwd: string,
    options: Parameters<BashOperations["exec"]>[2],
  ): Promise<{ exitCode: number | null }> {
    const active = this.#requiredContext(sessionId);
    if (!active.input.project) {
      throw new Error("当前对话没有绑定项目资源，不能运行 bash。");
    }
    const timeoutSeconds = options.timeout;
    if (
      timeoutSeconds !== undefined &&
      (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    ) {
      throw new Error("Invalid timeout: must be a finite number of seconds");
    }
    const userTimeoutMs =
      timeoutSeconds === undefined
        ? undefined
        : Math.min(Math.floor(timeoutSeconds * 1_000), 2_147_483_647);
    const executionLimitMs = Math.min(
      MOBILE_PROJECT_SHELL_LIMITS.maxExecutionTimeMs,
      userTimeoutMs ?? MOBILE_PROJECT_SHELL_LIMITS.maxExecutionTimeMs,
    );
    const environment = await this.#projectTools(sessionId);
    const currentResources = await environment.currentResources(options.signal);
    const commands = await this.#projectShellCommands(
      active.input.project.id,
      currentResources,
    );
    const shell = new ProjectShell({
      fileSystem: environment,
      root: PROJECT_SHELL_ROOT,
      commands,
      runtimeCommands: MOBILE_PROJECT_SHELL_RUNTIME_COMMANDS,
      ...(this.#publicReadFetch ? { fetch: this.#publicReadFetch } : {}),
      limits: {
        ...MOBILE_PROJECT_SHELL_LIMITS,
        maxExecutionTimeMs: executionLimitMs,
      },
      ...(this.#projectShellJavaScriptRuntime
        ? { javaScriptRuntime: this.#projectShellJavaScriptRuntime }
        : {}),
    });
    const executionCwd = assertProjectShellCwd(cwd);
    try {
      const result = await shell.execute({
        command,
        cwd: executionCwd,
        signal: options.signal,
      });
      assertProjectShellCwd(result.cwd);
      if (result.stdout) options.onData(Buffer.from(result.stdout, "utf8"));
      if (result.stderr) options.onData(Buffer.from(result.stderr, "utf8"));
      await environment.applyShellChanges(result.changes, options.signal);
      if (
        result.exitCode === 124 &&
        userTimeoutMs !== undefined &&
        userTimeoutMs <= MOBILE_PROJECT_SHELL_LIMITS.maxExecutionTimeMs
      ) {
        throw new Error(`timeout:${timeoutSeconds}`);
      }
      return { exitCode: result.exitCode };
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new Error("aborted");
      }
      throw error;
    }
  }

  async #executeAgentJavaScript(
    sessionId: string,
    input: AgentJavaScriptToolInput,
    signal?: AbortSignal,
  ) {
    const runtime = this.#projectShellJavaScriptRuntime;
    if (!runtime) {
      throw new Error("当前构建没有可用的隔离计算运行时。");
    }
    const active = this.#requiredContext(sessionId);
    const selectedFiles: { path: string; contents: string }[] = [];
    const seenPaths = new Set<string>();
    if ((input.files?.length ?? 0) > 0 && !active.input.project) {
      throw new Error("当前对话没有绑定项目，不能读取项目计算输入。");
    }
    const environment =
      (input.files?.length ?? 0) > 0
        ? await this.#projectTools(sessionId)
        : undefined;
    for (const requestedPath of input.files ?? []) {
      const path = normalizeProjectShellPath(requestedPath);
      if (path === PROJECT_SHELL_ROOT || seenPaths.has(path)) {
        throw new Error(`计算输入包含无效或重复的项目文件：${requestedPath}`);
      }
      seenPaths.add(path);
      selectedFiles.push({
        path,
        contents: await environment!.readFile(path, signal),
      });
    }
    const runtimeInput = {
      args: [...(input.args ?? [])],
      cwd: PROJECT_SHELL_ROOT,
      stdin: input.stdin ?? "",
      files: selectedFiles,
    };
    if (
      Buffer.byteLength(JSON.stringify(runtimeInput), "utf8") >
      AGENT_JAVASCRIPT_MAX_INPUT_BYTES
    ) {
      throw new Error("显式选择的计算输入超过 240 KiB 限制。");
    }
    return runtime.execute({
      source: input.code,
      filename: "agent-calculation.js",
      ...runtimeInput,
      limits: {
        memoryBytes: MOBILE_PROJECT_SHELL_LIMITS.maxJavaScriptMemoryBytes,
        stackBytes: MOBILE_PROJECT_SHELL_LIMITS.maxJavaScriptStackBytes,
        outputBytes: MOBILE_PROJECT_SHELL_LIMITS.maxOutputBytes,
        timeoutMs: MOBILE_PROJECT_SHELL_LIMITS.maxExecutionTimeMs,
      },
      ...(signal ? { signal } : {}),
    });
  }

  async #finalizeStagedProposal(active: ActiveRunContext): Promise<void> {
    if (!active.toolEnvironment || !active.input.project) return;
    const environment = await active.toolEnvironment;
    const staged = environment.stagedChanges();
    if (staged.length === 0) return;
    if (active.proposal) {
      throw new Error("本轮已经创建过修改提案，不能覆盖它。");
    }
    for (const change of staged) {
      if (
        change.operation === "modify" &&
        change.resource.content !== change.before
      ) {
        throw new Error(`项目工具修改基线不一致：${change.path}`);
      }
      if (
        (change.operation === "create" || change.operation === "copy") &&
        active.input.resources.some(
          (resource) =>
            resource.id === change.resource.id ||
            (resource.projectId === active.input.project!.id &&
              resource.path === change.resource.path &&
              isProjectWorkspaceResource(resource)),
        )
      ) {
        throw new Error(`新增项目文件路径已存在：${change.resource.path}`);
      }
    }
    const changes = staged.map((change) => {
      const summaryKey: MessageKey =
        change.operation === "copy"
          ? "runtime.agent.change.copy"
          : change.operation === "create"
            ? "runtime.agent.change.create"
            : "runtime.agent.change.modify";
      const after =
        change.resource.storage.kind === "notion-page"
          ? canonicalizeNotionMarkdown(change.after)
          : change.after;
      return {
        resourceId: change.resource.id,
        after,
        summary: translateMessage(summaryKey, this.#locale(), {
          path: change.resource.path,
        }).slice(0, 240),
        summaryMessage: {
          key: summaryKey,
          values: { path: change.resource.path },
        },
        ...(change.operation === "create"
          ? { operation: "create" as const }
          : {}),
        ...(change.operation === "copy" &&
        change.resource.storage.kind === "project-workspace" &&
        change.resource.storage.binary
          ? {
              operation: "create" as const,
              binaryFile: {
                ...change.resource.storage.binary,
                source: { ...change.resource.storage.binary.source },
              },
            }
          : {}),
      };
    });
    const modifiedChanges = staged
      .filter((change) => change.operation === "modify")
      .map((change) => ({ resourceId: change.resource.id }));
    const currentResources = modifiedChanges.length
      ? await assertProposalTargetsCurrent(active, modifiedChanges)
      : [];
    const proposalResources = [
      ...currentResources,
      ...staged
        .filter(
          (change) =>
            change.operation === "create" || change.operation === "copy",
        )
        .map((change) => change.resource),
    ];
    active.proposal = toProposal(
      active.input.runId,
      active.input.project.id,
      translateMessage("runtime.agent.change.proposalSummary", this.#locale(), {
        count: changes.length,
      }),
      proposalResources,
      changes,
      {
        titleMessage: {
          key: "runtime.agent.change.proposalSummary",
          values: { count: changes.length },
        },
      },
    );
  }

  #requiredContext(sessionId: string) {
    const active = this.#activeContexts.get(sessionId);
    if (!active) throw new Error("Agent run context is no longer active.");
    return active;
  }

  #assertConversationProjectBinding(
    sessionId: string,
    projectId: string | null,
  ) {
    if (
      this.#conversationProjectBindings.has(sessionId) &&
      this.#conversationProjectBindings.get(sessionId) !== projectId
    ) {
      throw new Error("同一对话不能切换到另一个项目；请在目标项目中新建对话。");
    }
    this.#conversationProjectBindings.set(sessionId, projectId);
  }

  async #ensureCore(sessionId: string, modelProfileId?: string) {
    if (this.#fixedCore) return this.#requiredCore(sessionId);
    const config = await this.#loadModelConfig(modelProfileId);
    const signature = JSON.stringify([
      config.baseUrl,
      config.model,
      config.providerKind === "openai-codex"
        ? config.authIdentity
        : config.apiKey,
      config.contextWindow,
      config.providerId ?? "openai-compatible",
      config.protocol ?? "chat-completions",
      config.modelProfileId ?? config.model,
      config.capabilities?.vision ?? true,
      config.capabilities?.reasoning ?? true,
    ]);
    const existingCore = this.#coresBySessionId.get(sessionId);
    if (
      existingCore &&
      this.#coreSignaturesBySessionId.get(sessionId) === signature
    ) {
      if (
        this.#thinkingLevelsBySessionId.get(sessionId) !== config.thinkingLevel
      ) {
        const sessionCreation = this.#sessions.get(sessionId);
        if (sessionCreation) {
          await sessionCreation;
          await existingCore.setThinkingLevel(sessionId, config.thinkingLevel);
        }
        this.#thinkingLevelsBySessionId.set(sessionId, config.thinkingLevel);
      }
      return existingCore;
    }
    if (existingCore) {
      if (this.#sessions.has(sessionId)) {
        await this.#sessions.get(sessionId);
        await existingCore.destroySession(sessionId).catch(() => undefined);
      }
      this.#sessions.delete(sessionId);
      this.#sessionResourceSignatures.delete(sessionId);
      this.#clearSessionToolProfile(sessionId);
    }
    const supportsImages = config.capabilities?.vision ?? true;
    const core = config.providerId === LOCAL_PROVIDER_ID
      ? (await import("./native-bolt-runtime")).createNativePiRuntime(this.#sessionPersistence, sessionId)
      : createOpenAICompatiblePiRuntime({
      baseUrl: config.baseUrl,
      modelId: config.model,
      apiKey: config.apiKey,
      providerKind: config.providerKind,
      protocol: config.protocol,
      contextWindow: config.contextWindow,
      supportsImages,
      reasoning: config.capabilities?.reasoning ?? true,
      supportsReasoningEffort: config.capabilities?.reasoning ?? true,
      fetch: config.fetch ?? expoModelFetch,
      providerTimeoutMs: 600_000,
      sessionPersistence: this.#sessionPersistence,
    });
    this.#coresBySessionId.set(sessionId, core);
    this.#coreSignaturesBySessionId.set(sessionId, signature);
    this.#thinkingLevelsBySessionId.set(sessionId, config.thinkingLevel);
    this.#mainSupportsImagesBySessionId.set(sessionId, supportsImages);
    this.#contextWindowsBySessionId.set(sessionId, config.contextWindow);
    return core;
  }

  async #loadModelConfig(modelProfileId?: string) {
    try {
      const provider =
        this.#modelConfigProvider ??
        (async (selectedModelProfileId?: string) => {
          const { loadModelRuntimeConfig, loadModelRuntimeConfigByProfile } =
            await import("@/infrastructure/model-config");
          return selectedModelProfileId
            ? loadModelRuntimeConfigByProfile(selectedModelProfileId)
            : loadModelRuntimeConfig();
        });
      return await provider(modelProfileId);
    } catch (error) {
      if (modelProfileId && error instanceof Error) {
        throw new Error(error.message, { cause: error });
      }
      throw new Error("请先在设置中保存模型 Base URL、模型名称和 API Key。", {
        cause: error,
      });
    }
  }

  #estimatedContextUsage(
    contextWindow: number,
    estimatedUsedTokens: number,
  ): AgentContextUsage {
    const usedTokens = Math.max(0, Math.round(estimatedUsedTokens));
    const settings = compactionSettingsForContextWindow(contextWindow);
    return {
      contextWindow,
      usedTokens,
      remainingTokens: Math.max(0, contextWindow - usedTokens),
      compactionThresholdTokens: Math.max(
        0,
        contextWindow - settings.reserveTokens,
      ),
      estimated: true,
    };
  }

  #requiredCore(sessionId: string) {
    const core = this.#fixedCore
      ? this.#core
      : this.#coresBySessionId.get(sessionId);
    if (!core) throw new Error("Agent 尚未准备好。");
    return core;
  }

  #supportsImages(sessionId: string) {
    return this.#fixedCore
      ? true
      : (this.#mainSupportsImagesBySessionId.get(sessionId) ?? true);
  }

  async #createRegistry(input: AgentRunInput) {
    if (this.#registryFactory) return this.#registryFactory(input);
    const { createRunConnectorRegistry } =
      await import("@/infrastructure/connectors/run-project-connectors");
    return createRunConnectorRegistry(input);
  }

  async #projectShellCommands(
    projectId: string,
    resources: readonly WorkspaceResource[],
  ): Promise<Readonly<Record<string, ProjectShellCommand>>> {
    const sessions = this.#sshProjectShellSessionsProvider(projectId);
    if (sessions.length === 0) return {};
    this.#sshProjectShellTransport ??= Promise.resolve(
      this.#sshProjectShellTransportFactory(),
    );
    const transport = await this.#sshProjectShellTransport;
    return createSshProjectShellCommands({
      sessions,
      resources,
      transport,
      localRoot: PROJECT_SHELL_ROOT,
      localPathForResource: projectShellPathForResource,
      maxTextBytes: 100_000,
    });
  }
}

function protectedSkillRedactionSegments(value: string) {
  const segments = new Set<string>();
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (line.length < MIN_PROTECTED_SKILL_REDACTION_CHARACTERS) continue;
    if (line.length <= PROTECTED_SKILL_REDACTION_SEGMENT_CHARACTERS) {
      segments.add(line);
    } else {
      const step = PROTECTED_SKILL_REDACTION_SEGMENT_CHARACTERS / 2;
      for (let offset = 0; offset < line.length; offset += step) {
        const segment = line.slice(
          offset,
          offset + PROTECTED_SKILL_REDACTION_SEGMENT_CHARACTERS,
        );
        if (segment.length >= MIN_PROTECTED_SKILL_REDACTION_CHARACTERS) {
          segments.add(segment);
        }
        if (segments.size >= MAX_PROTECTED_SKILL_REDACTION_SEGMENTS) break;
      }
    }
    if (segments.size >= MAX_PROTECTED_SKILL_REDACTION_SEGMENTS) break;
  }
  return segments;
}
