import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceResource } from "../domain/models.ts";
import {
  createProjectDirectoryCreateProposal,
  createProjectEntryDeleteProposal,
  createProjectEntryRenameProposal,
  createProjectFileCreateProposal,
  createProjectFileEditProposal,
  getProjectFileEditability,
  listProjectDirectory,
  MAX_PROJECT_FILE_EDIT_LINES,
  normalizeProjectResourcePath,
  parentProjectDirectory,
  PROJECT_DIRECTORY_MARKER,
  projectResourcePath,
  projectFilesForProject,
} from "./project-file-manager.ts";
import {
  createProjectWorkspaceFileResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "../domain/project-workspace.ts";
import { applyChangeProposal } from "./change-workflow.ts";

function resource(
  id: string,
  path: string,
  overrides: Partial<WorkspaceResource> = {},
): WorkspaceResource {
  return {
    id,
    projectId: "launch",
    connectionId: "workspace",
    path,
    content: `${id}\n`,
    version: "1",
    storage: { kind: "memory" },
    ...overrides,
  };
}

const resources = [
  resource("readme", "README.md"),
  resource("button", "src/components/Button.tsx"),
  resource("app", "src/App.tsx"),
  resource("other", "notes/private.txt", { projectId: "support" }),
];

test("builds a deterministic virtual directory tree from project resources", () => {
  assert.deepEqual(
    listProjectDirectory(resources, "launch").map((entry) => [
      entry.kind,
      entry.path,
    ]),
    [
      ["directory", "src"],
      ["file", "README.md"],
    ],
  );
  assert.deepEqual(
    listProjectDirectory(resources, "launch", "src").map((entry) => [
      entry.kind,
      entry.path,
    ]),
    [
      ["directory", "src/components"],
      ["file", "src/App.tsx"],
    ],
  );
});

test("rejects unsafe and ambiguous paths before they reach the explorer", () => {
  for (const path of [
    "",
    "/absolute.txt",
    "../outside.txt",
    "safe/../outside.txt",
    "safe//file.txt",
    "safe\\file.txt",
    "safe/./file.txt",
    "safe/secret\0.txt",
  ]) {
    assert.equal(normalizeProjectResourcePath(path), null, path);
  }
  assert.equal(normalizeProjectResourcePath("safe/file.txt"), "safe/file.txt");
  assert.deepEqual(
    projectFilesForProject(
      [...resources, resource("unsafe", "../secret.txt")],
      "launch",
    ).map((entry) => entry.resource.id),
    ["readme", "app", "button"],
  );
  assert.equal(parentProjectDirectory("src/components"), "src");
  assert.equal(parentProjectDirectory("src"), "");
});

test("creates one pending manual proposal against the exact resource version", () => {
  const target = resource("plan", "docs/plan.md", {
    content: "# Plan\n\n- Before\n",
    version: "sha-before",
  });
  const proposal = createProjectFileEditProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    resource: target,
    after: "# Plan\n\n- After\n",
    connectorLabel: "Workspace",
    proposalId: "manual-one",
    hunkId: "manual-one-file",
    createdAt: "2026-08-04T00:00:00.000Z",
    locale: "en",
  });

  assert.equal(proposal.kind, "manual");
  assert.equal(proposal.title, "Edit docs/plan.md");
  assert.deepEqual(proposal.titleMessage, {
    key: "changes.generated.manualTitle",
    values: { path: "docs/plan.md" },
  });
  assert.equal(proposal.connectorId, target.connectionId);
  assert.equal(proposal.hunks[0]?.baseVersion, "sha-before");
  assert.equal(proposal.hunks[0]?.before, target.content);
  assert.equal(proposal.hunks[0]?.after, "# Plan\n\n- After\n");
  assert.equal(
    proposal.hunks[0]?.summary,
    "Edited from the project file manager",
  );
  assert.deepEqual(proposal.hunks[0]?.summaryMessage, {
    key: "changes.generated.manualSummary",
  });
  assert.ok(proposal.hunks[0]?.lines.some((line) => line.kind === "deletion"));
  assert.ok(proposal.hunks[0]?.lines.some((line) => line.kind === "addition"));
});

test("creates a deterministic pending proposal for a new project Skill file", () => {
  const content = [
    "---",
    "name: release-check",
    'title: "Release check"',
    'description: "Verify a release."',
    "risk: read",
    "---",
    "",
    "# Verify",
    "",
  ].join("\n");
  const proposal = createProjectFileCreateProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    path: "skills/release-check/SKILL.md",
    content,
    connectorLabel: "Workspace",
    proposalId: "manual-create-skill",
    hunkId: "manual-create-skill-content",
    createdAt: "2026-08-13T00:00:00.000Z",
    locale: "en",
  });

  assert.equal(proposal.kind, "manual");
  assert.equal(proposal.hunks[0]?.operation, "create");
  assert.equal(
    proposal.hunks[0]?.baseVersion,
    PROJECT_WORKSPACE_ABSENT_VERSION,
  );
  assert.equal(proposal.hunks[0]?.before, "");
  assert.equal(proposal.hunks[0]?.after, content);
  assert.match(
    proposal.hunks[0]?.resourceId ?? "",
    /^project-workspace-launch-file-/u,
  );
});

test("creates empty files and virtual folders while hiding folder markers", () => {
  const empty = createProjectFileCreateProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    path: "notes/empty.txt",
    content: "",
    connectorLabel: "Workspace",
    proposalId: "create-empty",
    hunkId: "create-empty-content",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.equal(empty.hunks[0]?.after, "");

  const folder = createProjectDirectoryCreateProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    path: "assets/icons",
    connectorLabel: "Workspace",
    proposalId: "create-folder",
    hunkId: "create-folder-content",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.equal(
    folder.hunks[0]?.target,
    `assets/icons/${PROJECT_DIRECTORY_MARKER}`,
  );
  const marker = createProjectWorkspaceFileResource({
    projectId: "launch",
    path: `assets/icons/${PROJECT_DIRECTORY_MARKER}`,
    content: "",
  });
  assert.deepEqual(
    listProjectDirectory([marker], "launch", "assets/icons"),
    [],
  );
  assert.equal(
    projectResourcePath("assets", "icons", "directory"),
    "assets/icons",
  );
  assert.throws(() => projectResourcePath("", "a/b", "file"), /名称/u);
});

test("renames and deletes project entries through one recoverable manual proposal", () => {
  const first = createProjectWorkspaceFileResource({
    projectId: "launch",
    path: "docs/one.txt",
    content: "one\n",
  });
  const second = createProjectWorkspaceFileResource({
    projectId: "launch",
    path: "docs/nested/two.txt",
    content: "two\n",
  });
  const rename = createProjectEntryRenameProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    entry: { kind: "directory", name: "docs", path: "docs" },
    destinationPath: "archive",
    resources: [first, second],
    connectorLabel: "Workspace",
    proposalId: "rename-docs",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.equal(rename.hunks.length, 4);
  const renamed = applyChangeProposal({
    proposal: rename,
    resources: { [first.id]: first, [second.id]: second },
    receiptId: "rename-receipt",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-17T00:00:01.000Z",
  });
  assert.deepEqual(
    Object.values(renamed.resources)
      .map((value) => value.path)
      .sort(),
    ["archive/nested/two.txt", "archive/one.txt"],
  );
  assert.equal(
    renamed.receipt.changes.filter((change) => change.operation === "delete")
      .length,
    2,
  );

  const renamedFile = Object.values(renamed.resources).find(
    (value) => value.path === "archive/one.txt",
  )!;
  const deletion = createProjectEntryDeleteProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    entry: {
      kind: "file",
      name: "one.txt",
      path: renamedFile.path,
      resource: renamedFile,
    },
    resources: Object.values(renamed.resources),
    connectorLabel: "Workspace",
    proposalId: "delete-file",
    createdAt: "2026-08-17T00:00:02.000Z",
  });
  assert.equal(deletion.hunks[0]?.operation, "delete");
});

test("resource manager does not add a built-in filename allowlist", () => {
  const agents = createProjectWorkspaceFileResource({
    projectId: "launch",
    path: "AGENTS.md",
    content: "instructions\n",
  });
  const deletion = createProjectEntryDeleteProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    entry: {
      kind: "file",
      name: "AGENTS.md",
      path: "AGENTS.md",
      resource: agents,
    },
    resources: [agents],
    connectorLabel: "Workspace",
    proposalId: "delete-agents",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.equal(deletion.hunks[0]?.operation, "delete");
});

test("project creation rejects file and directory path collisions", () => {
  const existing = createProjectWorkspaceFileResource({
    projectId: "launch",
    path: "notes",
    content: "plain file\n",
  });
  const nested = createProjectFileCreateProposal({
    projectId: "launch",
    conversationId: "conversation-launch",
    path: "notes/today.md",
    content: "",
    connectorLabel: "Workspace",
    proposalId: "nested-file",
    hunkId: "nested-file-content",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.throws(
    () =>
      applyChangeProposal({
        proposal: nested,
        resources: { [existing.id]: existing },
        receiptId: "nested-file-receipt",
        conversationId: "conversation-launch",
        appliedAt: "2026-08-17T00:00:01.000Z",
      }),
    /目标内容已变化/u,
  );
});

test("manual proposals fail closed for no-op, read-only, oversized and cross-project edits", () => {
  const target = resource("plan", "plan.txt");
  const create = (candidate: WorkspaceResource, after: string) =>
    createProjectFileEditProposal({
      projectId: "launch",
      conversationId: "conversation-launch",
      resource: candidate,
      after,
      connectorLabel: "Workspace",
      proposalId: "manual-one",
      hunkId: "manual-one-file",
      createdAt: "2026-08-04T00:00:00.000Z",
    });

  assert.throws(() => create(target, target.content), /没有变化/u);
  assert.throws(
    () =>
      create(
        resource("source", "source.txt", {
          storage: {
            kind: "source-file",
            locator: "source.txt",
            snapshotId: "snapshot",
            sourceKind: "public-archive",
            sourceLabel: "Source",
            mountPath: "source",
            revision: "sha",
            versionLabel: "sha",
            manifestPath: "manifest.json",
            access: "persistent",
          },
        }),
        "changed",
      ),
    /只读/u,
  );
  assert.throws(
    () =>
      create(
        target,
        Array(MAX_PROJECT_FILE_EDIT_LINES + 1)
          .fill("x")
          .join("\n"),
      ),
    /不能超过/u,
  );
  assert.throws(
    () => create({ ...target, projectId: "support" }, "changed"),
    /不属于当前项目/u,
  );
  assert.equal(
    getProjectFileEditability(
      resource("large", "large.txt", {
        content: Array(MAX_PROJECT_FILE_EDIT_LINES + 1)
          .fill("x")
          .join("\n"),
      }),
    ).editable,
    false,
  );
});
