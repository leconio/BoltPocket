import type {
  ChangeProposal,
  ChangeReceipt,
  ChatMessage,
  ConnectionItem,
  ConversationCheckpoint,
  MemoryItem,
  Project,
  RetryableAgentRun,
  UserChatAttachment,
  SkillItem,
  WorkspaceResource,
} from "./models.ts";
import { defaultGlobalSkillEnabledById } from "./library-catalog.ts";
import type { ProjectResourcePackEnabledByProjectId } from "./builtin-project-resources.ts";

export const INITIAL_CONVERSATION_ID = "conversation-root";
export const MAX_ACTIVE_CONVERSATION_RUNS = 3;

export type ConversationRunState = {
  runId: string;
  conversationId: string;
  request: RetryableAgentRun | null;
  status: string;
};

export type AppState = {
  isHydrating: boolean;
  projects: Record<string, Project>;
  /** Project pins in user-defined recency order. */
  pinnedProjectIds: string[];
  /** Most recently used projects, newest first. Navigation alone does not promote. */
  recentProjectIds: string[];
  /** Most recently used conversations, newest first. Navigation alone does not promote. */
  recentConversationIds: string[];
  selectedProjectId: string | null;
  activeConversationId: string;
  /** The most recently used conversation for each project. */
  conversationIdsByProject: Record<string, string>;
  /** Every conversation's owning project; multiple conversations may share one project. */
  conversationProjectIds: Record<string, string | null>;
  /** Optional model profile pinned to a conversation; absent follows the default route. */
  conversationModelProfileIds: Record<string, string>;
  messages: ChatMessage[];
  messagesByConversation: Record<string, ChatMessage[]>;
  draft: string;
  isRunning: boolean;
  activeRunId: string | null;
  activeRunConversationId: string | null;
  activeRunRequest: RetryableAgentRun | null;
  retryableRun: RetryableAgentRun | null;
  runStatus: string;
  runError: string | null;
  /** Live Agent runs keyed by their owning conversation. */
  activeRunsByConversation: Record<string, ConversationRunState>;
  /** Failed or interrupted runs that can be retried from their conversation. */
  retryableRunsByConversation: Record<string, RetryableAgentRun>;
  /** Conversation-local run failures; navigation must not move these across chats. */
  runErrorsByConversation: Record<string, string>;
  draftAttachments: UserChatAttachment[];
  /** A completed Agent turn whose staged Diff is being applied by the host. */
  autoApplyingProposalId: string | null;
  /** Every queued or executing automatic apply, including parallel Agent turns. */
  autoApplyingProposalIds: string[];
  proposals: Record<string, ChangeProposal>;
  resources: Record<string, WorkspaceResource>;
  connections: Record<string, ConnectionItem>;
  /** App-wide Skill defaults inherited by projects without an explicit override. */
  skillEnabledById: Record<string, boolean>;
  /** User-edited content for built-in global memories. */
  globalMemoryTextById: Record<string, string>;
  /** User-edited Markdown bodies for built-in global Skills. */
  globalSkillContentById: Record<string, string>;
  /** User-created global memories, persisted in the encrypted app snapshot. */
  customGlobalMemories: Record<string, MemoryItem>;
  /** User-created global Skills, persisted in the encrypted app snapshot. */
  customGlobalSkills: Record<string, SkillItem>;
  /** Per-project Skill overrides; missing entries inherit skillEnabledById. */
  projectSkillEnabledByProjectId: Record<string, Record<string, boolean>>;
  /** Per-project overrides; every bundled H5 resource pack defaults to enabled. */
  projectResourcePackEnabledByProjectId: ProjectResourcePackEnabledByProjectId;
  receipts: Record<string, ChangeReceipt>;
  conversationCheckpoints: Record<string, ConversationCheckpoint>;
  lastReceiptId: string | null;
  storageError: string | null;
};

export const initialAppState: AppState = {
  isHydrating: true,
  projects: {},
  pinnedProjectIds: [],
  recentProjectIds: [],
  recentConversationIds: [],
  selectedProjectId: null,
  activeConversationId: INITIAL_CONVERSATION_ID,
  conversationIdsByProject: {},
  conversationProjectIds: { [INITIAL_CONVERSATION_ID]: null },
  conversationModelProfileIds: {},
  messages: [],
  messagesByConversation: { [INITIAL_CONVERSATION_ID]: [] },
  draft: "",
  isRunning: false,
  activeRunId: null,
  activeRunConversationId: null,
  activeRunRequest: null,
  retryableRun: null,
  runStatus: "",
  runError: null,
  activeRunsByConversation: {},
  retryableRunsByConversation: {},
  runErrorsByConversation: {},
  draftAttachments: [],
  autoApplyingProposalId: null,
  autoApplyingProposalIds: [],
  proposals: {},
  resources: {},
  connections: {},
  skillEnabledById: { ...defaultGlobalSkillEnabledById },
  globalMemoryTextById: {},
  globalSkillContentById: {},
  customGlobalMemories: {},
  customGlobalSkills: {},
  projectSkillEnabledByProjectId: {},
  projectResourcePackEnabledByProjectId: {},
  receipts: {},
  conversationCheckpoints: {},
  lastReceiptId: null,
  storageError: null,
};

export type AppAction =
  | { type: "state/restore"; state: AppState }
  | { type: "state/hydration-complete" }
  | { type: "storage/fail"; message: string }
  | { type: "storage/ready" }
  | {
      type: "project/created";
      project: Project;
      connection: ConnectionItem;
      resources: WorkspaceResource[];
    }
  | { type: "project/opened"; projectId: string }
  | { type: "project/set-pinned"; projectId: string; pinned: boolean }
  | {
      type: "project-resource/set-enabled";
      projectId: string;
      packId: import("./builtin-project-resources.ts").BuiltInProjectResourcePackId;
      enabled: boolean;
    }
  | { type: "chat/open-project"; projectId: string }
  | {
      type: "chat/open-conversation";
      projectId: string | null;
      conversationId: string;
    }
  | { type: "chat/new"; conversationId: string }
  | {
      type: "chat/new-project";
      projectId: string;
      conversationId: string;
    }
  | {
      type: "conversation/delete";
      conversationId: string;
      replacementConversationId: string;
    }
  | {
      type: "conversation/claim-project";
      conversationId: string;
      projectId: string;
    }
  | {
      type: "conversation/set-model";
      conversationId: string;
      modelProfileId: string | null;
    }
  | { type: "draft/change"; value: string }
  | { type: "attachment/add"; attachment: UserChatAttachment }
  | { type: "attachment/remove"; attachmentId: string }
  | { type: "attachment/clear" }
  | {
      type: "run/start";
      runId: string;
      conversationId: string;
      message?: ChatMessage;
      request?: RetryableAgentRun;
    }
  | {
      type: "run/status";
      runId: string;
      conversationId: string;
      status: string;
    }
  | {
      type: "run/steer-queued";
      runId: string;
      conversationId: string;
      message: ChatMessage;
    }
  | {
      type: "run/complete";
      runId: string;
      conversationId: string;
      message: ChatMessage;
      proposal?: ChangeProposal;
    }
  | {
      type: "run/fail";
      runId: string;
      conversationId: string;
      message: string;
      partialMessage?: ChatMessage;
      failedAt?: string;
    }
  | {
      type: "run/interrupted";
      runId: string;
      conversationId: string;
      partialMessage?: ChatMessage;
      interruptedAt?: string;
    }
  | {
      type: "run/cancel";
      runId: string;
      conversationId: string;
      partialMessage?: ChatMessage;
      cancelledAt?: string;
    }
  | { type: "run/retry-dismiss"; conversationId: string }
  | { type: "run/capacity-rejected"; conversationId: string }
  | { type: "run/rejected"; conversationId: string; message: string }
  | {
      type: "skill/set-enabled";
      /** Changes the app-wide default without replacing project overrides. */
      scope: "global";
      skillId: string;
      enabled: boolean;
    }
  | { type: "memory/update-global"; memoryId: string; text: string }
  | { type: "skill/update-global"; skillId: string; content: string }
  | { type: "memory/create-global"; memory: MemoryItem }
  | { type: "skill/create-global"; skill: SkillItem }
  | {
      type: "project/workspace-skill-created";
      projectId: string;
      skillId: string;
      resource: WorkspaceResource;
    }
  | {
      type: "skill/set-enabled";
      scope: "project";
      projectId: string;
      skillId: string;
      enabled: boolean;
    }
  | {
      type: "connection/upsert";
      connection: ConnectionItem;
      resources: WorkspaceResource[];
    }
  | {
      type: "resources/refreshed";
      resources: WorkspaceResource[];
    }
  | {
      type: "proposal/applied";
      proposalId: string;
      resources: Record<string, WorkspaceResource>;
      receipt: ChangeReceipt;
      checkpoint: ConversationCheckpoint;
      message: ChatMessage;
    }
  | {
      type: "proposal/auto-apply-start";
      proposalId: string;
    }
  | {
      type: "proposal/auto-apply-failed";
      proposalId: string;
      message: string;
    }
  | { type: "proposal/manual-created"; proposal: ChangeProposal }
  | { type: "proposal/capability-created"; proposal: ChangeProposal }
  | { type: "proposal/restore-created"; proposal: ChangeProposal };
