import {
  isValidCustomGlobalMemory,
  isValidCustomGlobalSkill,
  isValidEditableLibraryContent,
} from "@/domain/library-content";
import { builtInMemories, builtInSkills } from "@/domain/library-catalog";
import {
  createProjectWorkspaceFileResource,
  createVerifiedProjectWorkspaceBinaryFileResource,
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "@/domain/project-workspace";
import { isBuiltInProjectResourcePackId } from "@/domain/builtin-project-resources";
import {
  isMessageKey,
  messageCatalogs,
  messagePlaceholders,
  type MessageReference,
} from "@/i18n/messages";

import type { PersistedAppState } from "./persisted-app-state";

export class PersistedAppStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistedAppStateError";
  }
}

function uniqueIds(items: readonly { id: string }[], label: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new PersistedAppStateError(`${label} contains duplicate IDs.`);
    }
    ids.add(item.id);
  }
  return ids;
}

function uniqueSelectedValues<T>(
  items: readonly T[],
  select: (item: T) => string,
  label: string,
) {
  const values = new Set<string>();
  for (const item of items) {
    const value = select(item);
    if (values.has(value)) {
      throw new PersistedAppStateError(`${label} contains duplicate values.`);
    }
    values.add(value);
  }
  return values;
}

function validDate(value: string) {
  return Number.isFinite(Date.parse(value));
}

function validMessageReference(reference: MessageReference | undefined) {
  if (!reference) return true;
  if (!isMessageKey(reference.key)) return false;
  const expected = new Set(
    messagePlaceholders(messageCatalogs.en[reference.key]),
  );
  const actual = Object.keys(reference.values ?? {});
  return (
    actual.length === expected.size &&
    actual.every((name) => expected.has(name))
  );
}

export function validateSnapshotSemantics(snapshot: PersistedAppState) {
  if (!validDate(snapshot.updatedAt)) {
    throw new PersistedAppStateError("Saved app state has an invalid date.");
  }
  const conversationIds = uniqueIds(snapshot.conversations, "Conversations");
  const projectIds = uniqueIds(snapshot.projects, "Projects");
  const pinnedProjectIds = uniqueSelectedValues(
    snapshot.pinnedProjectIds ?? [],
    (projectId) => projectId,
    "Pinned projects",
  );
  const recentProjectIds = uniqueSelectedValues(
    snapshot.recentProjectIds ?? [],
    (projectId) => projectId,
    "Recent projects",
  );
  const recentConversationIds = uniqueSelectedValues(
    snapshot.recentConversationIds ?? [],
    (conversationId) => conversationId,
    "Recent conversations",
  );
  if (
    [...pinnedProjectIds, ...recentProjectIds].some(
      (projectId) => !projectIds.has(projectId),
    ) ||
    [...recentConversationIds].some(
      (conversationId) => !conversationIds.has(conversationId),
    )
  ) {
    throw new PersistedAppStateError(
      "Saved home activity points to an unknown item.",
    );
  }
  const workspaceResourceIds = uniqueIds(
    snapshot.workspaceResources,
    "Project workspace resources",
  );
  uniqueSelectedValues(
    snapshot.workspaceResources,
    (resource) => `${resource.projectId}:${resource.path}`,
    "Project workspace paths",
  );
  if (
    (snapshot.projects.length === 0) !==
    (snapshot.workspaceResources.length === 0)
  ) {
    throw new PersistedAppStateError(
      "Saved projects and project workspaces are incomplete.",
    );
  }
  for (const resource of snapshot.workspaceResources) {
    let validBinding = false;
    try {
      validBinding = isProjectWorkspaceResource(resource);
    } catch {
      validBinding = false;
    }
    if (
      !projectIds.has(resource.projectId) ||
      !validBinding ||
      !isSafeProjectWorkspacePath(resource.path)
    ) {
      throw new PersistedAppStateError(
        "Saved project workspace contains an invalid resource binding.",
      );
    }
    if (
      resource.storage.kind === "project-workspace" &&
      resource.storage.binary
    ) {
      try {
        const binary = resource.storage.binary;
        const expected = createVerifiedProjectWorkspaceBinaryFileResource({
          projectId: resource.projectId,
          path: resource.path,
          contentBase64: resource.content,
          binary,
          version: resource.version,
        });
        if (expected.id !== resource.id) throw new Error("resource id");
      } catch {
        throw new PersistedAppStateError(
          "Saved project workspace contains an invalid binary resource.",
        );
      }
    }
  }
  if (
    workspaceResourceIds.size > 0 &&
    snapshot.projects.some((project) => {
      const paths = new Set(
        snapshot.workspaceResources
          .filter((resource) => resource.projectId === project.id)
          .map((resource) => resource.path),
      );
      return (
        !paths.has("AGENTS.md") ||
        !paths.has("MEMORY.md") ||
        !paths.has("NOTES.md") ||
        !paths.has("memory/RECENT.md") ||
        !paths.has("memory/SUMMARIES.md") ||
        !paths.has("memory/EVIDENCE.md") ||
        ![...paths].some((path) =>
          /^skills\/[a-z0-9][a-z0-9._-]{0,79}\/SKILL\.md$/u.test(path),
        )
      );
    })
  ) {
    throw new PersistedAppStateError(
      "Saved project workspace is missing its required template.",
    );
  }
  uniqueIds(snapshot.proposals, "Proposals");
  const receiptIds = uniqueIds(snapshot.receipts, "Receipts");
  const conversationsById = new Map(
    snapshot.conversations.map((conversation) => [
      conversation.id,
      conversation,
    ]),
  );
  const proposalsById = new Map(
    snapshot.proposals.map((proposal) => [proposal.id, proposal]),
  );
  const receiptsById = new Map(
    snapshot.receipts.map((receipt) => [receipt.id, receipt]),
  );
  uniqueIds(snapshot.checkpoints, "Checkpoints");
  uniqueSelectedValues(
    snapshot.projectConversations,
    (mapping) => mapping.projectId,
    "Project conversation mappings",
  );
  uniqueSelectedValues(
    snapshot.projectConversations,
    (mapping) => mapping.conversationId,
    "Project conversation mappings",
  );
  uniqueSelectedValues(
    snapshot.skillSettings,
    (setting) => setting.skillId,
    "Skill settings",
  );
  uniqueSelectedValues(
    snapshot.globalMemoryEdits ?? [],
    (edit) => edit.memoryId,
    "Global memory edits",
  );
  uniqueSelectedValues(
    snapshot.globalSkillEdits ?? [],
    (edit) => edit.skillId,
    "Global Skill edits",
  );
  const customGlobalMemories = snapshot.customGlobalMemories ?? [];
  const customGlobalSkills = snapshot.customGlobalSkills ?? [];
  uniqueIds(customGlobalMemories, "Custom global memories");
  uniqueIds(customGlobalSkills, "Custom global Skills");
  const editableGlobalMemoryIds = new Set(
    builtInMemories
      .filter((memory) => memory.scope === "global")
      .map((memory) => memory.id),
  );
  const editableGlobalSkillIds = new Set(
    builtInSkills
      .filter((skill) => skill.scope === "global")
      .map((skill) => skill.id),
  );
  if (
    customGlobalMemories.some(
      (memory) =>
        editableGlobalMemoryIds.has(memory.id) ||
        !isValidCustomGlobalMemory(memory) ||
        !validMessageReference(memory.sourceMessage),
    ) ||
    customGlobalSkills.some(
      (skill) =>
        editableGlobalSkillIds.has(skill.id) ||
        !isValidCustomGlobalSkill(skill),
    ) ||
    (snapshot.globalMemoryEdits ?? []).some(
      (edit) =>
        !editableGlobalMemoryIds.has(edit.memoryId) ||
        !isValidEditableLibraryContent("memory", edit.text),
    ) ||
    (snapshot.globalSkillEdits ?? []).some(
      (edit) =>
        !editableGlobalSkillIds.has(edit.skillId) ||
        !isValidEditableLibraryContent("skill", edit.content),
    )
  ) {
    throw new PersistedAppStateError("Saved global library edits are invalid.");
  }
  uniqueSelectedValues(
    snapshot.projectSkillSettings ?? [],
    (setting) => `${setting.projectId}\0${setting.skillId}`,
    "Project Skill settings",
  );
  if (
    (snapshot.projectSkillSettings ?? []).some(
      (setting) => !projectIds.has(setting.projectId),
    )
  ) {
    throw new PersistedAppStateError(
      "Saved project Skill setting points to an unknown project.",
    );
  }
  uniqueSelectedValues(
    snapshot.projectResourcePackSettings ?? [],
    (setting) => `${setting.projectId}\0${setting.packId}`,
    "Project resource pack settings",
  );
  if (
    (snapshot.projectResourcePackSettings ?? []).some(
      (setting) =>
        !projectIds.has(setting.projectId) ||
        !isBuiltInProjectResourcePackId(setting.packId),
    )
  ) {
    throw new PersistedAppStateError(
      "Saved project resource setting is invalid.",
    );
  }
  uniqueSelectedValues(
    snapshot.checkpoints,
    (checkpoint) => checkpoint.conversationId,
    "Conversation checkpoints",
  );
  if (!conversationIds.has(snapshot.activeConversationId)) {
    throw new PersistedAppStateError(
      "Saved app state points to an unknown active conversation.",
    );
  }
  if (
    snapshot.selectedProjectId !== null &&
    !projectIds.has(snapshot.selectedProjectId)
  ) {
    throw new PersistedAppStateError(
      "Saved app state points to an unknown selected project.",
    );
  }
  if (
    conversationsById.get(snapshot.activeConversationId)?.projectId !==
    snapshot.selectedProjectId
  ) {
    throw new PersistedAppStateError(
      "Saved active conversation does not belong to the selected project.",
    );
  }
  for (const mapping of snapshot.projectConversations) {
    if (
      conversationsById.get(mapping.conversationId)?.projectId !==
      mapping.projectId
    ) {
      throw new PersistedAppStateError(
        "Saved project mapping points to a conversation owned by another project.",
      );
    }
  }
  for (const conversation of snapshot.conversations) {
    if (
      conversation.projectId !== null &&
      !projectIds.has(conversation.projectId)
    ) {
      throw new PersistedAppStateError(
        "Saved conversation points to an unknown project.",
      );
    }
    uniqueIds(conversation.messages, "Conversation messages");
    for (const message of conversation.messages) {
      if (
        message.proposalId &&
        proposalsById.get(message.proposalId)?.conversationId !==
          conversation.id
      ) {
        throw new PersistedAppStateError(
          "Saved message points to a proposal owned by another conversation.",
        );
      }
    }
  }
  for (const proposal of snapshot.proposals) {
    uniqueIds(proposal.hunks, "Proposal hunks");
    let lifecycleValid = validMessageReference(proposal.titleMessage);
    let capabilityTotalBytes = 0;
    let capabilitySkillDocuments = 0;
    for (const hunk of proposal.hunks) {
      lifecycleValid =
        lifecycleValid && validMessageReference(hunk.summaryMessage);
      if (hunk.operation === "create") {
        if (hunk.createTarget) {
          lifecycleValid =
            lifecycleValid &&
            !hunk.binaryFile &&
            hunk.createTarget.connectorId === proposal.connectorId &&
            Boolean(hunk.createTarget.accountId) &&
            Boolean(hunk.createTarget.accountLabel) &&
            hunk.before === "" &&
            hunk.baseVersion === PROJECT_WORKSPACE_ABSENT_VERSION &&
            Boolean(hunk.target.trim()) &&
            hunk.target.length <= 1_000 &&
            !/[\u0000-\u001f\u007f]/u.test(hunk.target) &&
            !hunk.after.includes("\0") &&
            hunk.after.length <= 100_000;
          continue;
        }
        try {
          const expected = hunk.binaryFile
            ? createVerifiedProjectWorkspaceBinaryFileResource({
                projectId: proposal.projectId,
                path: hunk.target,
                contentBase64: hunk.after,
                binary: hunk.binaryFile,
                version: PROJECT_WORKSPACE_ABSENT_VERSION,
              })
            : createProjectWorkspaceFileResource({
                projectId: proposal.projectId,
                path: hunk.target,
                content: "",
                version: PROJECT_WORKSPACE_ABSENT_VERSION,
              });
          lifecycleValid =
            lifecycleValid &&
            hunk.resourceId === expected.id &&
            hunk.before === "" &&
            hunk.baseVersion === PROJECT_WORKSPACE_ABSENT_VERSION &&
            !hunk.after.includes("\0") &&
            (Boolean(hunk.binaryFile) || hunk.after.length <= 100_000);
          capabilityTotalBytes += hunk.binaryFile
            ? hunk.binaryFile.byteLength
            : new TextEncoder().encode(hunk.after).byteLength;
          if (
            proposal.capabilityInstall &&
            hunk.target ===
              `skills/${proposal.capabilityInstall.skillId}/SKILL.md`
          ) {
            capabilitySkillDocuments += 1;
          }
        } catch {
          lifecycleValid = false;
        }
      } else if (hunk.operation === "delete") {
        lifecycleValid =
          lifecycleValid &&
          !hunk.createTarget &&
          !hunk.binaryFile &&
          proposal.kind === "restore" &&
          hunk.after === "";
      } else if (hunk.createTarget || hunk.binaryFile) {
        lifecycleValid = false;
      }
    }
    if (proposal.kind === "capability") {
      const install = proposal.capabilityInstall;
      lifecycleValid = Boolean(
        lifecycleValid &&
        install &&
        install.kind === "skill" &&
        install.fileCount === proposal.hunks.length &&
        install.totalBytes === capabilityTotalBytes &&
        capabilitySkillDocuments === 1 &&
        proposal.hunks.every((hunk) => {
          const prefix = `skills/${install.skillId}/`;
          if (
            hunk.operation !== "create" ||
            hunk.createTarget ||
            !hunk.target.startsWith(prefix)
          ) {
            return false;
          }
          if (!hunk.binaryFile) return true;
          return (
            hunk.binaryFile.source.kind === "third-party-skill" &&
            hunk.binaryFile.source.skillId === install.skillId &&
            hunk.binaryFile.source.bundleSha256 === install.bundleSha256 &&
            hunk.binaryFile.source.path === hunk.target.slice(prefix.length)
          );
        }),
      );
    } else if (proposal.capabilityInstall) {
      lifecycleValid = false;
    }
    const appliedReceipt = proposal.appliedReceiptId
      ? receiptsById.get(proposal.appliedReceiptId)
      : undefined;
    if (
      !validDate(proposal.createdAt) ||
      !proposal.conversationId ||
      !lifecycleValid ||
      conversationsById.get(proposal.conversationId)?.projectId !==
        proposal.projectId ||
      (proposal.appliedReceiptId &&
        (appliedReceipt?.proposalId !== proposal.id ||
          appliedReceipt.conversationId !== proposal.conversationId ||
          appliedReceipt.projectId !== proposal.projectId))
    ) {
      throw new PersistedAppStateError("Saved proposal is inconsistent.");
    }
  }
  for (const receipt of snapshot.receipts) {
    uniqueSelectedValues(
      receipt.changes,
      (change) => change.hunkId,
      "Receipt changes",
    );
    const receiptProposal = proposalsById.get(receipt.proposalId);
    const hunkById = new Map(
      receiptProposal?.hunks.map((hunk) => [hunk.id, hunk]) ?? [],
    );
    if (
      receiptProposal?.conversationId !== receipt.conversationId ||
      receiptProposal?.projectId !== receipt.projectId ||
      conversationsById.get(receipt.conversationId)?.projectId !==
        receipt.projectId ||
      receipt.changes.some((change) => {
        const hunk = hunkById.get(change.hunkId);
        return (
          !hunk ||
          hunk.resourceId !== change.resourceId ||
          hunk.target !== change.target ||
          hunk.operation !== change.operation
        );
      }) ||
      !validDate(receipt.appliedAt)
    ) {
      throw new PersistedAppStateError("Saved receipt is inconsistent.");
    }
  }
  for (const checkpoint of snapshot.checkpoints) {
    const baselineIds = uniqueIds(
      checkpoint.baselineResources,
      "Checkpoint baselines",
    );
    const latestIds = uniqueIds(
      checkpoint.latestResources,
      "Checkpoint latest resources",
    );
    const createdIds = uniqueSelectedValues(
      checkpoint.createdResourceIds ?? [],
      (resourceId) => resourceId,
      "Checkpoint created resources",
    );
    const deletedIds = uniqueSelectedValues(
      checkpoint.deletedResourceIds ?? [],
      (resourceId) => resourceId,
      "Checkpoint deleted resources",
    );
    if (
      conversationsById.get(checkpoint.conversationId)?.projectId !==
        checkpoint.projectId ||
      !validDate(checkpoint.createdAt) ||
      [...createdIds].some(
        (id) => baselineIds.has(id) || !latestIds.has(id) || deletedIds.has(id),
      ) ||
      [...deletedIds].some((id) => !baselineIds.has(id) || latestIds.has(id)) ||
      [...latestIds].some(
        (id) =>
          !baselineIds.has(id) && !createdIds.has(id) && !deletedIds.has(id),
      ) ||
      [...checkpoint.baselineResources, ...checkpoint.latestResources].some(
        (resource) => resource.projectId !== checkpoint.projectId,
      )
    ) {
      throw new PersistedAppStateError("Saved checkpoint is inconsistent.");
    }
  }
  const pendingConversationIds = uniqueSelectedValues(
    snapshot.pendingRuns,
    (run) => run.conversationId,
    "Pending runs",
  );
  const retryableConversationIds = uniqueSelectedValues(
    snapshot.retryableRuns,
    (run) => run.conversationId,
    "Retryable runs",
  );
  for (const run of [...snapshot.pendingRuns, ...snapshot.retryableRuns]) {
    if (!conversationIds.has(run.conversationId)) {
      throw new PersistedAppStateError(
        "Saved retry state points to an inconsistent run.",
      );
    }
  }
  if (
    snapshot.pendingRuns.some((run) => !run.runId) ||
    snapshot.retryableRuns.some((run) => run.runId !== undefined) ||
    [...pendingConversationIds].some((conversationId) =>
      retryableConversationIds.has(conversationId),
    )
  ) {
    throw new PersistedAppStateError(
      "Saved pending and retryable runs overlap or are incomplete.",
    );
  }
  if (snapshot.lastReceiptId && !receiptIds.has(snapshot.lastReceiptId)) {
    throw new PersistedAppStateError(
      "Saved app state points to an unknown latest receipt.",
    );
  }
}
