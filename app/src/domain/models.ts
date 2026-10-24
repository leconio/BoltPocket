import type { MessageReference } from "../i18n/messages.ts";

export type ContextKind = "memory" | "skill" | "connection";

export type ImageAttachment = {
  id: string;
  kind: "image";
  uri: string;
  name: string;
  mimeType: string;
  /** Present only while an image is being prepared for a model request. */
  base64?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

export type TextFileAttachment = {
  id: string;
  kind: "file";
  uri: string;
  name: string;
  mimeType: string;
  text: string;
  sizeBytes: number;
};

export type GeneratedImageAttachment = {
  id: string;
  kind: "generated-image";
  uri: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  width?: number;
  height?: number;
  providerName: string;
  modelId: string;
  createdAt: string;
};

export type GeneratedVideoAttachment = {
  id: string;
  kind: "generated-video";
  uri: string;
  name: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  durationSeconds?: number;
  providerName: string;
  modelId: string;
  createdAt: string;
};

export type GeneratedMediaAttachment =
  GeneratedImageAttachment | GeneratedVideoAttachment;

export type UserChatAttachment = ImageAttachment | TextFileAttachment;

export type ChatAttachment = UserChatAttachment | GeneratedMediaAttachment;

export function isImageAttachment(
  attachment: ChatAttachment,
): attachment is ImageAttachment {
  return attachment.kind === "image";
}

export function isTextFileAttachment(
  attachment: ChatAttachment,
): attachment is TextFileAttachment {
  return attachment.kind === "file";
}

export function isGeneratedImageAttachment(
  attachment: ChatAttachment,
): attachment is GeneratedImageAttachment {
  return attachment.kind === "generated-image";
}

export function isGeneratedVideoAttachment(
  attachment: ChatAttachment,
): attachment is GeneratedVideoAttachment {
  return attachment.kind === "generated-video";
}

export function isGeneratedMediaAttachment(
  attachment: ChatAttachment,
): attachment is GeneratedMediaAttachment {
  return (
    attachment.kind === "generated-image" ||
    attachment.kind === "generated-video"
  );
}

export type ContextReference = {
  id: string;
  kind: ContextKind;
  label: string;
  detail: string;
};

export type CollaborationTask = {
  id: string;
  role: "scout" | "planner" | "reviewer";
  description: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  durationMs?: number;
  /** Bounded final child result. Raw child reasoning is never exposed here. */
  summary?: string;
  /** Chronological, human-facing labels for child tools; arguments are omitted. */
  toolActivity?: string[];
};

export type AgentActivityItem =
  | {
      id: string;
      kind: "thinking";
      /** Legacy private reasoning. New runs never create, render, or retain it. */
      content: string;
    }
  | {
      id: string;
      kind: "text";
      /** Bounded public Agent narration; never contains model reasoning. */
      content: string;
    }
  | {
      id: string;
      kind: "tool";
      /** Sanitized, argument-aware label; raw arguments and results stay out. */
      label: string;
      status: "running" | "completed" | "failed" | "staged" | "cancelled";
      durationMs?: number;
      /** Sanitized, bounded explanation retained only for failed tools. */
      failureReason?: string;
    }
  | {
      id: string;
      kind: "context";
      operation: "automatic_compaction" | "overflow_recovery";
      status: "running" | "completed" | "failed" | "cancelled";
      tokensBefore?: number;
      tokensAfter?: number;
      durationMs?: number;
    };

export type AgentExecution = {
  status: "completed" | "failed" | "cancelled" | "interrupted";
  durationMs: number;
  /** Chronological, bounded activity retained independently of model context. */
  activity: AgentActivityItem[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Legacy persisted Pi thinking. Never render or persist for new messages. */
  thinking?: string;
  /** Ordered upstream Pi tool labels used to produce this assistant answer. */
  toolActivity?: string[];
  /** Structured execution timeline used by new messages. */
  execution?: AgentExecution;
  /** Inspectable summaries returned by isolated collaboration Agents. */
  collaboration?: CollaborationTask[];
  context?: ContextReference[];
  proposalId?: string;
  attachments?: ChatAttachment[];
};

export type RetryableAgentRun = {
  conversationId: string;
  content: string;
  attachments: UserChatAttachment[];
  requiresAttachmentReselection: boolean;
  /** A restored in-flight run has an unknown outcome and is not a safe retry. */
  retryReason: "failed" | "interrupted";
};

export type Project = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  instructions: string;
  memoryCount: number;
  skillCount: number;
  connectionCount: number;
  resourceCount: number;
};

export type MemoryItem = {
  id: string;
  text: string;
  scope: "global" | "project";
  source: string;
  sourceMessage?: MessageReference;
  projectIds?: string[];
  pinned?: boolean;
};

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  /** Trusted full instructions loaded into the upstream Pi Skill resource. */
  content: string;
  risk: "read" | "propose";
  enabled: boolean;
  scope: "global" | "project";
  projectIds: string[];
};

export type ConnectionItem = {
  id: string;
  projectId: string;
  name: string;
  /** Provider-stable account id; present for account-scoped external connectors. */
  accountId?: string;
  account: string;
  scope: string;
  status: "connected" | "attention";
  resourceCount: number;
  access: "persistent" | "session";
  writeMode: "atomic" | "recoverable" | "read-only";
  verification?: string;
};

export type DiffLine = {
  kind: "meta" | "context" | "addition" | "deletion";
  text: string;
};

export type ProjectWorkspaceBinarySource =
  | {
      kind: "builtin-h5-resource";
      packId: "bootstrap-icons" | "kenney-ui" | "kenney-1bit";
      path: string;
    }
  | {
      bundleSha256: string;
      executable: boolean;
      kind: "third-party-skill";
      path: string;
      skillId: string;
    };

export type DiffHunk = {
  id: string;
  resourceId: string;
  target: string;
  /** Omitted means an in-place text modification. */
  operation?: "create" | "delete";
  /** Present only when create targets an external document connector. */
  createTarget?: {
    provider: "google-docs" | "google-sheets" | "google-slides" | "notion";
    connectorId: string;
    accountId: string;
    accountLabel: string;
  };
  /** Present only when a verified immutable binary is copied into the project. */
  binaryFile?: {
    encoding: "base64";
    mimeType: string;
    byteLength: number;
    sha256: string;
    source: ProjectWorkspaceBinarySource;
  };
  baseVersion: string;
  before: string;
  after: string;
  summary: string;
  /** Product-authored copy is re-resolved when the app language changes. */
  summaryMessage?: MessageReference;
  lines: DiffLine[];
};

export type ProposalStatus = "pending" | "applied";

export type ChangeProposal = {
  id: string;
  projectId: string;
  conversationId?: string;
  title: string;
  /** Product-authored copy is re-resolved when the app language changes. */
  titleMessage?: MessageReference;
  kind: "agent" | "capability" | "manual" | "restore";
  status: ProposalStatus;
  connectorId: string;
  connector: string;
  createdAt: string;
  hunks: DiffHunk[];
  capabilityInstall?: {
    bundleSha256: string;
    fileCount: number;
    kind: "skill";
    skillId: string;
    totalBytes: number;
  };
  appliedReceiptId?: string;
};

export type ProjectWorkspaceBinaryFile = {
  encoding: "base64";
  mimeType: string;
  byteLength: number;
  sha256: string;
  source: ProjectWorkspaceBinarySource;
};

export type WorkspaceResource = {
  id: string;
  projectId: string;
  connectionId: string;
  path: string;
  content: string;
  version: string;
  storage:
    | { kind: "memory" }
    | {
        kind: "project-workspace";
        /** Present only for immutable binary files copied into the project. */
        binary?: ProjectWorkspaceBinaryFile;
      }
    | {
        kind: "native-file";
        locator: string;
        access: "persistent" | "session";
      }
    | {
        kind: "google-doc";
        locator: string;
        documentId: string;
        accountId: string;
        accountLabel: string;
        writable: boolean;
        trashable: boolean;
        restorable: boolean;
        trashed: boolean;
        access: "persistent";
      }
    | {
        kind: "google-sheet";
        locator: string;
        spreadsheetId: string;
        sheetId: number;
        accountId: string;
        accountLabel: string;
        writable: boolean;
        trashable: boolean;
        restorable: boolean;
        trashed: boolean;
        access: "persistent";
      }
    | {
        kind: "google-slide";
        locator: string;
        presentationId: string;
        accountId: string;
        accountLabel: string;
        writable: boolean;
        trashable: boolean;
        restorable: boolean;
        trashed: boolean;
        access: "persistent";
      }
    | {
        kind: "notion-page";
        locator: string;
        pageId: string;
        accountId: string;
        accountLabel: string;
        writable: boolean;
        trashable: boolean;
        restorable: boolean;
        trashed: boolean;
        access: "persistent";
      }
    | {
        kind: "source-file";
        locator: string;
        snapshotId: string;
        sourceKind:
          | "github-public"
          | "local-file"
          | "local-archive"
          | "pasted-text"
          | "public-archive";
        sourceLabel: string;
        mountPath: string;
        revision: string;
        versionLabel: string;
        manifestPath: string;
        access: "persistent";
      };
};

export function isReadOnlyWorkspaceResource(resource: WorkspaceResource) {
  return (
    resource.storage.kind === "source-file" ||
    (resource.storage.kind === "google-doc" &&
      (!resource.storage.writable || resource.storage.trashed)) ||
    (resource.storage.kind === "google-sheet" &&
      (!resource.storage.writable || resource.storage.trashed)) ||
    (resource.storage.kind === "google-slide" &&
      (!resource.storage.writable || resource.storage.trashed)) ||
    (resource.storage.kind === "notion-page" &&
      (!resource.storage.writable || resource.storage.trashed))
  );
}

export function isBinaryProjectWorkspaceResource(
  resource: WorkspaceResource,
): resource is WorkspaceResource & {
  storage: { kind: "project-workspace"; binary: ProjectWorkspaceBinaryFile };
} {
  return (
    resource.storage.kind === "project-workspace" &&
    resource.storage.binary?.encoding === "base64"
  );
}

export type ConversationCheckpoint = {
  id: string;
  conversationId: string;
  projectId: string;
  createdAt: string;
  baselineResources: Record<string, WorkspaceResource>;
  latestResources: Record<string, WorkspaceResource>;
  /** Files absent at the checkpoint baseline and created by this conversation. */
  createdResourceIds?: string[];
  /** Files present at the checkpoint baseline and deleted by this conversation. */
  deletedResourceIds?: string[];
};

export type AppliedChange = {
  hunkId: string;
  resourceId: string;
  target: string;
  /** Omitted means an in-place text modification. */
  operation?: "create" | "delete";
  before: string;
  after: string;
  beforeVersion: string;
  afterVersion: string;
};

export type ChangeReceipt = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  projectId: string;
  conversationId: string;
  connectorId: string;
  connector: string;
  appliedAt: string;
  changes: AppliedChange[];
  additions: number;
  deletions: number;
};

export type DiffStats = {
  additions: number;
  deletions: number;
  changes: number;
};
