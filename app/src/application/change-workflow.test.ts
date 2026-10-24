import assert from "node:assert/strict";
import test from "node:test";

import { proposal, workspaceResources } from "../testing/app-state-fixtures.ts";
import type { WorkspaceResource } from "../domain/models.ts";
import { builtInProjectResourceFile } from "../domain/builtin-project-resources.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "../domain/project-workspace.ts";
import {
  applyChangeProposal,
  InvalidProposalError,
  ProposalConflictError,
  selectChangeProposalHunks,
} from "./change-workflow.ts";

test("selects an approved subset in original Diff order", () => {
  const [first, second] = proposal.hunks;
  assert.ok(first && second);

  const selected = selectChangeProposalHunks(proposal, [second.id, first.id]);

  assert.deepEqual(
    selected.hunks.map((hunk) => hunk.id),
    [first.id, second.id],
  );
});

test("rejects empty, duplicate, or foreign Diff selections", () => {
  const first = proposal.hunks[0]!;

  assert.throws(
    () => selectChangeProposalHunks(proposal, []),
    InvalidProposalError,
  );
  assert.throws(
    () => selectChangeProposalHunks(proposal, [first.id, first.id]),
    InvalidProposalError,
  );
  assert.throws(
    () => selectChangeProposalHunks(proposal, ["foreign-hunk"]),
    InvalidProposalError,
  );
});

test("applies only the accepted Diff subset and leaves rejected targets unchanged", () => {
  const first = proposal.hunks[0]!;
  const selectedProposal = selectChangeProposalHunks(proposal, [first.id]);
  const result = applyChangeProposal({
    proposal: selectedProposal,
    resources: workspaceResources,
    receiptId: "receipt-test",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-03T01:00:00.000Z",
  });

  assert.equal(result.receipt.changes.length, 1);
  assert.equal(result.receipt.additions, 2);
  assert.equal(result.receipt.deletions, 1);
  assert.equal(result.resources["launch-instructions"]?.version, "19");
  assert.equal(result.resources["launch-instructions"]?.content, first.after);
  assert.equal(result.resources["launch-release-plan"]?.version, "18");
  assert.equal(
    result.resources["launch-release-plan"]?.content,
    workspaceResources["launch-release-plan"]?.content,
  );
  assert.equal(workspaceResources["launch-instructions"]?.version, "18");
});

test("rejects the whole proposal when any target version changed", () => {
  const staleResources: Record<string, WorkspaceResource> = {
    ...workspaceResources,
    "launch-release-plan": {
      ...workspaceResources["launch-release-plan"]!,
      version: "19",
      content: "外部修改后的内容\n",
    },
  };

  assert.throws(
    () =>
      applyChangeProposal({
        proposal,
        resources: staleResources,
        receiptId: "receipt-conflict",
        conversationId: "conversation-launch",
        appliedAt: "2026-08-03T01:00:00.000Z",
      }),
    ProposalConflictError,
  );
  assert.equal(staleResources["launch-instructions"]?.version, "18");
});

test("rejects cross-project, mismatched-path, and read-only Diff targets", () => {
  const hunk = proposal.hunks[0]!;
  const selected = selectChangeProposalHunks(proposal, [hunk.id]);
  const resource = workspaceResources[hunk.resourceId]!;
  const apply = (
    candidateProposal: typeof selected,
    candidateResource: WorkspaceResource,
  ) =>
    applyChangeProposal({
      proposal: candidateProposal,
      resources: {
        ...workspaceResources,
        [candidateResource.id]: candidateResource,
      },
      receiptId: "receipt-invalid-target",
      conversationId: "conversation-launch",
      appliedAt: "2026-08-03T01:00:00.000Z",
    });

  assert.throws(
    () => apply(selected, { ...resource, projectId: "another-project" }),
    InvalidProposalError,
  );
  assert.throws(
    () =>
      apply(
        {
          ...selected,
          hunks: [{ ...hunk, target: "another/path.md" }],
        },
        resource,
      ),
    InvalidProposalError,
  );
  assert.throws(
    () =>
      apply(selected, {
        ...resource,
        storage: {
          kind: "source-file",
          locator: "fixture://source/read-only",
          snapshotId: "snapshot-read-only",
          sourceKind: "pasted-text",
          sourceLabel: "Read-only fixture",
          mountPath: "fixture",
          revision: "revision-1",
          versionLabel: "revision-1",
          manifestPath: ".boltpocket-source.md",
          access: "persistent",
        },
      }),
    InvalidProposalError,
  );
});

test("creates a project-owned file only while its path is still absent", () => {
  const bundle = createProjectWithWorkspace({
    id: "create-file-project",
    name: "Create file",
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "index.html",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const createProposal = {
    id: "proposal-create-file",
    projectId: bundle.project.id,
    conversationId: "conversation-create-file",
    title: "新增 H5 入口",
    kind: "agent" as const,
    status: "pending" as const,
    connectorId: bundle.connection.id,
    connector: "Project connectors",
    createdAt: "2026-08-06T12:00:00.000Z",
    hunks: [
      {
        id: "hunk-create-file",
        resourceId: draft.id,
        target: draft.path,
        operation: "create" as const,
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: "<!doctype html>\n<title>Created</title>\n",
        summary: "新增 index.html",
        lines: [],
      },
    ],
  };
  const resources = Object.fromEntries(
    bundle.resources.map((resource) => [resource.id, resource]),
  );

  const applied = applyChangeProposal({
    proposal: createProposal,
    resources,
    receiptId: "receipt-create-file",
    conversationId: "conversation-create-file",
    appliedAt: "2026-08-06T12:01:00.000Z",
  });

  assert.equal(applied.resources[draft.id]?.path, "index.html");
  assert.equal(
    applied.resources[draft.id]?.content,
    "<!doctype html>\n<title>Created</title>\n",
  );
  assert.equal(applied.receipt.changes[0]?.operation, "create");
  assert.throws(
    () =>
      applyChangeProposal({
        proposal: createProposal,
        resources: applied.resources,
        receiptId: "receipt-create-conflict",
        conversationId: "conversation-create-file",
        appliedAt: "2026-08-06T12:02:00.000Z",
      }),
    ProposalConflictError,
  );
});

test("project Skill creation requires strict canonical frontmatter", () => {
  const bundle = createProjectWithWorkspace({
    id: "create-skill-project",
    name: "Create Skill",
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "skills/review/SKILL.md",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const proposal = {
    id: "proposal-create-skill",
    projectId: bundle.project.id,
    conversationId: "conversation-create-skill",
    title: "新增 Skill",
    kind: "agent" as const,
    status: "pending" as const,
    connectorId: bundle.connection.id,
    connector: "Project workspace",
    createdAt: "2026-08-13T00:00:00.000Z",
    hunks: [
      {
        id: "hunk-create-skill",
        resourceId: draft.id,
        target: draft.path,
        operation: "create" as const,
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: "---\nname: review\nrisk: propose\n---\n\n# Review\n",
        summary: "新增 Skill",
        lines: [],
      },
    ],
  };
  assert.throws(
    () =>
      applyChangeProposal({
        proposal,
        resources: Object.fromEntries(
          bundle.resources.map((resource) => [resource.id, resource]),
        ),
        receiptId: "receipt-create-skill",
        conversationId: "conversation-create-skill",
        appliedAt: "2026-08-13T00:01:00.000Z",
      }),
    /Skill/u,
  );
});

test("applies an exact bundled binary copy as a recoverable project file", () => {
  const bundle = createProjectWithWorkspace({
    id: "copy-resource-project",
    name: "Copy resource",
  });
  const path =
    "apps/demo/assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png";
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path,
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const descriptor = builtInProjectResourceFile(
    "kenney-ui",
    "png/blue/arrow_basic_e_small.png",
  );
  assert.ok(descriptor);
  const contentBase64 = Buffer.alloc(descriptor.byteLength).toString("base64");
  const result = applyChangeProposal({
    proposal: {
      id: "proposal-copy-resource",
      projectId: bundle.project.id,
      conversationId: "conversation-copy-resource",
      title: "复制 H5 资源",
      kind: "agent",
      status: "pending",
      connectorId: bundle.connection.id,
      connector: "Project connectors",
      createdAt: "2026-08-08T10:00:00.000Z",
      hunks: [
        {
          id: "hunk-copy-resource",
          resourceId: draft.id,
          target: path,
          operation: "create",
          binaryFile: {
            encoding: "base64",
            mimeType: descriptor.mimeType,
            byteLength: descriptor.byteLength,
            sha256: descriptor.sha256,
            source: {
              kind: "builtin-h5-resource",
              packId: "kenney-ui",
              path: descriptor.path,
            },
          },
          baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
          before: "",
          after: contentBase64,
          summary: "复制箭头素材",
          lines: [],
        },
      ],
    },
    resources: Object.fromEntries(
      bundle.resources.map((resource) => [resource.id, resource]),
    ),
    receiptId: "receipt-copy-resource",
    conversationId: "conversation-copy-resource",
    appliedAt: "2026-08-08T10:01:00.000Z",
  });

  const copied = result.resources[draft.id];
  assert.equal(copied?.content, contentBase64);
  assert.equal(copied?.storage.kind, "project-workspace");
  assert.equal(
    copied?.storage.kind === "project-workspace"
      ? copied.storage.binary?.source.path
      : undefined,
    descriptor.path,
  );
  assert.equal(result.receipt.changes[0]?.operation, "create");
});
