import assert from "node:assert/strict";
import test from "node:test";

import { proposal, workspaceResources } from "../testing/app-state-fixtures.ts";
import {
  applyChangeProposal,
  ProposalConflictError,
} from "./change-workflow.ts";
import {
  advanceConversationCheckpoint,
  createConversationRestoreProposal,
} from "./conversation-checkpoint.ts";
import { createProjectEntryRenameProposal } from "./project-file-manager.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "../domain/project-workspace.ts";

test("one conversation checkpoint keeps the first baseline across later writes", () => {
  const firstProposal = { ...proposal, hunks: [proposal.hunks[0]!] };
  const first = applyChangeProposal({
    proposal: firstProposal,
    resources: workspaceResources,
    receiptId: "receipt-first",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-03T01:00:00.000Z",
  });
  const firstCheckpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-1",
    conversationId: "conversation-launch",
    projectId: "launch",
    createdAt: "2026-08-03T01:00:00.000Z",
    receipt: first.receipt,
    beforeResources: workspaceResources,
    afterResources: first.resources,
  });
  const secondProposal = {
    ...proposal,
    id: "proposal-second",
    hunks: [
      {
        ...proposal.hunks[0]!,
        id: "instructions-second",
        baseVersion: first.resources["launch-instructions"]!.version,
        before: first.resources["launch-instructions"]!.content,
        after: `${first.resources["launch-instructions"]!.content}\nSecond pass`,
      },
    ],
  };
  const second = applyChangeProposal({
    proposal: secondProposal,
    resources: first.resources,
    receiptId: "receipt-second",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-03T02:00:00.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpoint: firstCheckpoint,
    checkpointId: "ignored",
    conversationId: "conversation-launch",
    projectId: "launch",
    createdAt: "2026-08-03T02:00:00.000Z",
    receipt: second.receipt,
    beforeResources: first.resources,
    afterResources: second.resources,
  });

  assert.equal(checkpoint.id, "checkpoint-1");
  assert.equal(
    checkpoint.baselineResources["launch-instructions"]?.content,
    workspaceResources["launch-instructions"]?.content,
  );
  assert.equal(
    checkpoint.latestResources["launch-instructions"]?.content,
    secondProposal.hunks[0]?.after,
  );
});

test("conversation restore covers changed resources and rejects external drift", () => {
  const applied = applyChangeProposal({
    proposal,
    resources: workspaceResources,
    receiptId: "receipt-applied",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-03T01:00:00.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-1",
    conversationId: "conversation-launch",
    projectId: "launch",
    createdAt: "2026-08-03T01:00:00.000Z",
    receipt: applied.receipt,
    beforeResources: workspaceResources,
    afterResources: applied.resources,
  });
  const restore = createConversationRestoreProposal({
    checkpoint,
    resources: applied.resources,
    proposalId: "restore-conversation",
    createdAt: "2026-08-03T02:00:00.000Z",
    locale: "en",
  });

  assert.equal(restore.kind, "restore");
  assert.equal(restore.title, "Restore this conversation");
  assert.deepEqual(restore.titleMessage, {
    key: "changes.generated.restoreTitle",
  });
  assert.equal(restore.hunks.length, proposal.hunks.length);
  assert.equal(
    restore.hunks[0]?.summary,
    "Restore the content from before this conversation’s first change",
  );
  assert.deepEqual(restore.hunks[0]?.summaryMessage, {
    key: "changes.generated.restoreContentSummary",
  });
  assert.equal(
    restore.hunks[0]?.after,
    workspaceResources[restore.hunks[0]!.resourceId]?.content,
  );

  const drifted = {
    ...applied.resources,
    "launch-instructions": {
      ...applied.resources["launch-instructions"]!,
      content: "external edit",
      version: "external-version",
    },
  };
  assert.throws(
    () =>
      createConversationRestoreProposal({
        checkpoint,
        resources: drifted,
        proposalId: "restore-conflict",
        createdAt: "2026-08-03T03:00:00.000Z",
      }),
    ProposalConflictError,
  );
});

test("conversation restore removes a file that the same conversation created", () => {
  const bundle = createProjectWithWorkspace({
    id: "restore-created-project",
    name: "Restore created",
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "index.html",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const resources = Object.fromEntries(
    bundle.resources.map((resource) => [resource.id, resource]),
  );
  const createProposal = {
    id: "proposal-create-for-restore",
    projectId: bundle.project.id,
    conversationId: "conversation-create-for-restore",
    title: "新增入口",
    kind: "agent" as const,
    status: "pending" as const,
    connectorId: bundle.connection.id,
    connector: "Project connectors",
    createdAt: "2026-08-06T12:00:00.000Z",
    hunks: [
      {
        id: "hunk-create-for-restore",
        resourceId: draft.id,
        target: draft.path,
        operation: "create" as const,
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: "<!doctype html>\n",
        summary: "新增 index.html",
        lines: [],
      },
    ],
  };
  const created = applyChangeProposal({
    proposal: createProposal,
    resources,
    receiptId: "receipt-created-for-restore",
    conversationId: "conversation-create-for-restore",
    appliedAt: "2026-08-06T12:01:00.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-created-file",
    conversationId: "conversation-create-for-restore",
    projectId: bundle.project.id,
    createdAt: "2026-08-06T12:01:00.000Z",
    receipt: created.receipt,
    beforeResources: resources,
    afterResources: created.resources,
  });
  const restore = createConversationRestoreProposal({
    checkpoint,
    resources: created.resources,
    proposalId: "restore-created-file",
    createdAt: "2026-08-06T12:02:00.000Z",
  });

  assert.equal(restore.hunks[0]?.operation, "delete");
  const restored = applyChangeProposal({
    proposal: restore,
    resources: created.resources,
    receiptId: "receipt-restored-created-file",
    conversationId: "conversation-create-for-restore",
    appliedAt: "2026-08-06T12:03:00.000Z",
  });
  assert.equal(restored.resources[draft.id], undefined);
  const clearedCheckpoint = advanceConversationCheckpoint({
    checkpoint,
    checkpointId: "ignored",
    conversationId: "conversation-create-for-restore",
    projectId: bundle.project.id,
    createdAt: "2026-08-06T12:03:00.000Z",
    receipt: restored.receipt,
    beforeResources: created.resources,
    afterResources: restored.resources,
  });
  assert.deepEqual(clearedCheckpoint.createdResourceIds, undefined);
  assert.throws(
    () =>
      createConversationRestoreProposal({
        checkpoint: clearedCheckpoint,
        resources: restored.resources,
        proposalId: "restore-again",
        createdAt: "2026-08-06T12:04:00.000Z",
      }),
    /没有需要恢复/u,
  );
});

test("conversation restore reverses project folder rename without a filename allowlist", () => {
  const bundle = createProjectWithWorkspace({
    id: "restore-renamed-project",
    name: "Restore renamed",
  });
  const first = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "AGENTS.md",
    content: "instructions\n",
  });
  const second = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "docs/plan.md",
    content: "plan\n",
  });
  const resources = { [first.id]: first, [second.id]: second };
  const rename = createProjectEntryRenameProposal({
    projectId: bundle.project.id,
    conversationId: "conversation-rename-for-restore",
    entry: { kind: "directory", name: "docs", path: "docs" },
    destinationPath: "archive",
    resources: Object.values(resources),
    connectorLabel: "Workspace",
    proposalId: "proposal-rename-for-restore",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const renamed = applyChangeProposal({
    proposal: rename,
    resources,
    receiptId: "receipt-rename-for-restore",
    conversationId: "conversation-rename-for-restore",
    appliedAt: "2026-08-17T00:00:01.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-rename-for-restore",
    conversationId: "conversation-rename-for-restore",
    projectId: bundle.project.id,
    createdAt: "2026-08-17T00:00:01.000Z",
    receipt: renamed.receipt,
    beforeResources: resources,
    afterResources: renamed.resources,
  });

  assert.deepEqual(checkpoint.deletedResourceIds, [second.id]);
  assert.equal(checkpoint.createdResourceIds?.length, 1);
  const restore = createConversationRestoreProposal({
    checkpoint,
    resources: renamed.resources,
    proposalId: "restore-renamed-folder",
    createdAt: "2026-08-17T00:00:02.000Z",
  });
  assert.deepEqual(
    restore.hunks.map((hunk) => [hunk.operation, hunk.target]).sort(),
    [
      ["create", "docs/plan.md"],
      ["delete", "archive/plan.md"],
    ],
  );
  const restored = applyChangeProposal({
    proposal: restore,
    resources: renamed.resources,
    receiptId: "receipt-restore-renamed-folder",
    conversationId: "conversation-rename-for-restore",
    appliedAt: "2026-08-17T00:00:03.000Z",
  });
  assert.deepEqual(
    Object.values(restored.resources)
      .map((resource) => resource.path)
      .sort(),
    ["AGENTS.md", "docs/plan.md"],
  );
  assert.equal(restored.resources[second.id]?.content, second.content);
});
