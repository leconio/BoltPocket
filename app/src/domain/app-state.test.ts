import assert from "node:assert/strict";
import test from "node:test";

import {
  appReducer,
  getConversationPreview,
  getConversationTitle,
  getMemoryCatalog,
  getPinnedProjects,
  getProjectConversationIds,
  getRecentConversationIds,
  getRecentProjects,
  getSkillCatalog,
  initialAppState as productionInitialAppState,
  isUntouchedConversation,
} from "./app-state.ts";
import {
  proposal,
  seededAppState as initialAppState,
} from "../testing/app-state-fixtures.ts";
import { applyChangeProposal } from "../application/change-workflow.ts";
import {
  advanceConversationCheckpoint,
  createConversationRestoreProposal,
} from "../application/conversation-checkpoint.ts";
import { createProjectFileCreateProposal } from "../application/project-file-manager.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  createProjectWorkspaceSkillResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "./project-workspace.ts";

test("production starts without sample data and with only product-owned globals", () => {
  assert.deepEqual(productionInitialAppState.projects, {});
  assert.deepEqual(productionInitialAppState.messages, []);
  assert.deepEqual(productionInitialAppState.resources, {});
  assert.deepEqual(productionInitialAppState.connections, {});
  assert.deepEqual(getMemoryCatalog(productionInitialAppState), []);
  assert.deepEqual(
    getSkillCatalog(productionInitialAppState).map((skill) => skill.id),
    [
      "build-h5",
      "install-capabilities",
      "manage-calendar-reminders",
      "operate-browser",
      "operate-device",
      "operate-ssh",
      "play-device-audio",
      "publish-skill",
      "read-device-sensors",
      "skill-authoring",
      "use-bootstrap-icons",
      "use-h5-resources",
      "use-kenney-1bit",
      "use-kenney-ui",
    ],
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["operate-browser"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["operate-device"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["manage-calendar-reminders"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["read-device-sensors"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["play-device-audio"],
    true,
  );
  assert.equal(productionInitialAppState.skillEnabledById["operate-ssh"], true);
  assert.equal(
    productionInitialAppState.skillEnabledById["publish-skill"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["install-capabilities"],
    true,
  );
  assert.equal(productionInitialAppState.skillEnabledById["build-h5"], true);
  assert.equal(
    productionInitialAppState.skillEnabledById["use-h5-resources"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["use-bootstrap-icons"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["use-kenney-1bit"],
    true,
  );
  assert.equal(
    productionInitialAppState.skillEnabledById["use-kenney-ui"],
    true,
  );
});

test("a conversation can pin a model until its run starts", () => {
  const conversationId = productionInitialAppState.activeConversationId;
  const pinned = appReducer(productionInitialAppState, {
    type: "conversation/set-model",
    conversationId,
    modelProfileId: "model-fast",
  });
  assert.equal(
    pinned.conversationModelProfileIds[conversationId],
    "model-fast",
  );

  const running = {
    ...pinned,
    activeRunsByConversation: {
      [conversationId]: {
        runId: "run-model",
        conversationId,
        request: null,
        status: "",
      },
    },
  };
  assert.equal(
    appReducer(running, {
      type: "conversation/set-model",
      conversationId,
      modelProfileId: "model-other",
    }),
    running,
  );

  const cleared = appReducer(pinned, {
    type: "conversation/set-model",
    conversationId,
    modelProfileId: null,
  });
  assert.deepEqual(cleared.conversationModelProfileIds, {});
});

test("global Skill content and app-wide defaults remain editable", () => {
  const disabled = appReducer(productionInitialAppState, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: "build-h5",
    enabled: false,
  });
  assert.equal(disabled.skillEnabledById["build-h5"], false);

  const editedContent = "# 生成 H5 项目\n\n先读取项目，再生成并预览。";
  const edited = appReducer(disabled, {
    type: "skill/update-global",
    skillId: "build-h5",
    content: editedContent,
  });
  assert.equal(
    getSkillCatalog(edited).find((skill) => skill.id === "build-h5")?.content,
    editedContent,
  );
});

test("saving localized built-in Skill defaults does not create a language-locked override", () => {
  const englishDefault = getSkillCatalog(productionInitialAppState, "en").find(
    (skill) => skill.id === "build-h5",
  )?.content;
  assert.ok(englishDefault);

  const unchanged = appReducer(productionInitialAppState, {
    type: "skill/update-global",
    skillId: "build-h5",
    content: englishDefault,
  });
  assert.deepEqual(unchanged.globalSkillContentById, {});
  assert.match(
    getSkillCatalog(unchanged, "zh-CN").find((skill) => skill.id === "build-h5")
      ?.content ?? "",
    /生成 H5 项目/u,
  );

  const stateFromThePreviousBehavior = {
    ...productionInitialAppState,
    globalSkillContentById: { "build-h5": englishDefault },
  };
  assert.match(
    getSkillCatalog(stateFromThePreviousBehavior, "zh-CN").find(
      (skill) => skill.id === "build-h5",
    )?.content ?? "",
    /生成 H5 项目/u,
  );
});

test("automatic apply locks the turn and always releases its failure state", () => {
  const withProposal = {
    ...initialAppState,
    proposals: { [proposal.id]: proposal },
  };
  const applying = appReducer(withProposal, {
    type: "proposal/auto-apply-start",
    proposalId: proposal.id,
  });
  assert.equal(applying.autoApplyingProposalId, proposal.id);

  const failed = appReducer(applying, {
    type: "proposal/auto-apply-failed",
    proposalId: proposal.id,
    message: "automatic apply failed",
  });
  assert.equal(failed.autoApplyingProposalId, null);
  assert.equal(failed.runError, "automatic apply failed");
});

test("parallel automatic applies release only their own proposal", () => {
  const secondProposal = { ...proposal, id: "proposal-parallel-second" };
  const withProposals = {
    ...initialAppState,
    proposals: {
      [proposal.id]: proposal,
      [secondProposal.id]: secondProposal,
    },
  };
  const first = appReducer(withProposals, {
    type: "proposal/auto-apply-start",
    proposalId: proposal.id,
  });
  const second = appReducer(first, {
    type: "proposal/auto-apply-start",
    proposalId: secondProposal.id,
  });
  const firstFailed = appReducer(second, {
    type: "proposal/auto-apply-failed",
    proposalId: proposal.id,
    message: "first failed",
  });

  assert.deepEqual(firstFailed.autoApplyingProposalIds, [secondProposal.id]);
  assert.equal(firstFailed.autoApplyingProposalId, secondProposal.id);
});

test("starting a new chat clears project context and messages", () => {
  const next = appReducer(initialAppState, {
    type: "chat/new",
    conversationId: "conversation-new",
  });

  assert.equal(next.selectedProjectId, null);
  assert.equal(next.activeConversationId, "conversation-new");
  assert.deepEqual(next.messages, []);
  assert.equal(next.isRunning, false);
  assert.deepEqual(
    next.recentConversationIds,
    initialAppState.recentConversationIds,
  );
  assert.deepEqual(getRecentConversationIds(next), ["conversation-launch"]);
});

test("only a pristine new conversation is eligible for automatic discard", () => {
  const conversationId = "conversation-discard-empty";
  const pristine = appReducer(productionInitialAppState, {
    type: "chat/new",
    conversationId,
  });

  assert.equal(isUntouchedConversation(pristine, conversationId), true);
  assert.equal(
    isUntouchedConversation(
      { ...pristine, draft: "started typing" },
      conversationId,
    ),
    false,
  );
  assert.equal(
    isUntouchedConversation(
      {
        ...pristine,
        messages: [{ id: "message-one", role: "user", content: "hello" }],
        messagesByConversation: {
          ...pristine.messagesByConversation,
          [conversationId]: [
            { id: "message-one", role: "user", content: "hello" },
          ],
        },
      },
      conversationId,
    ),
    false,
  );
  assert.equal(
    isUntouchedConversation(
      {
        ...pristine,
        conversationModelProfileIds: { [conversationId]: "model-custom" },
      },
      conversationId,
    ),
    false,
  );
  assert.equal(
    isUntouchedConversation(pristine, "conversation-missing"),
    false,
  );
});

test("navigation is read-only and actual conversation activity updates order", () => {
  const pinned = appReducer(initialAppState, {
    type: "project/set-pinned",
    projectId: "support",
    pinned: true,
  });
  assert.deepEqual(
    getPinnedProjects(pinned).map((project) => project.id),
    ["support", "launch"],
  );

  const opened = appReducer(pinned, {
    type: "project/opened",
    projectId: "research",
  });
  assert.equal(opened, pinned);
  assert.deepEqual(
    getRecentProjects(opened).map((project) => project.id),
    ["launch", "support", "research"],
  );

  const quick = appReducer(opened, {
    type: "chat/new",
    conversationId: "conversation-quick-recent",
  });
  const projectConversation = appReducer(quick, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch",
  });
  assert.deepEqual(getRecentConversationIds(projectConversation), [
    "conversation-launch",
  ]);
  assert.deepEqual(
    projectConversation.recentConversationIds,
    initialAppState.recentConversationIds,
  );
  assert.equal(projectConversation.recentProjectIds[0], "launch");

  const reopenedQuick = appReducer(projectConversation, {
    type: "chat/open-conversation",
    projectId: null,
    conversationId: "conversation-quick-recent",
  });
  assert.equal(reopenedQuick.activeConversationId, "conversation-quick-recent");
  assert.equal(reopenedQuick.selectedProjectId, null);
  assert.deepEqual(
    reopenedQuick.recentConversationIds,
    initialAppState.recentConversationIds,
  );

  const usedQuick = appReducer(reopenedQuick, {
    type: "run/start",
    runId: "run-quick-recent",
    conversationId: "conversation-quick-recent",
    message: { id: "quick-recent", role: "user", content: "开始整理" },
  });
  assert.equal(usedQuick.recentConversationIds[0], "conversation-quick-recent");

  const researchChat = appReducer(usedQuick, {
    type: "chat/new-project",
    projectId: "research",
    conversationId: "conversation-research-new",
  });
  assert.equal(researchChat.recentProjectIds[0], "launch");
  const usedResearch = appReducer(researchChat, {
    type: "run/start",
    runId: "run-research-new",
    conversationId: "conversation-research-new",
    message: { id: "research-new", role: "user", content: "开始研究" },
  });
  assert.equal(usedResearch.recentProjectIds[0], "research");
  assert.equal(
    usedResearch.conversationIdsByProject.research,
    "conversation-research-new",
  );

  const unpinned = appReducer(usedResearch, {
    type: "project/set-pinned",
    projectId: "support",
    pinned: false,
  });
  assert.deepEqual(unpinned.pinnedProjectIds, ["launch"]);
  assert.equal(
    appReducer(unpinned, {
      type: "project/set-pinned",
      projectId: "missing",
      pinned: true,
    }),
    unpinned,
  );
});

test("selecting a project loads that project conversation fixture", () => {
  const empty = appReducer(initialAppState, {
    type: "chat/new",
    conversationId: "conversation-new",
  });
  const next = appReducer(empty, {
    type: "chat/open-project",
    projectId: "launch",
  });

  assert.equal(next.selectedProjectId, "launch");
  assert.ok(next.messages.length > 0);
});

test("a completed run appends the assistant message and stops running", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-test",
    conversationId: "conversation-launch",
    message: { id: "user-test", role: "user", content: "开始。" },
  });
  const next = appReducer(running, {
    type: "run/complete",
    runId: "run-test",
    conversationId: "conversation-launch",
    message: { id: "assistant-test", role: "assistant", content: "完成。" },
  });

  assert.equal(next.isRunning, false);
  assert.equal(next.messages.at(-1)?.id, "assistant-test");
});

test("app state applies and restores an Agent-created project file", () => {
  const bundle = createProjectWithWorkspace({
    id: "state-created-file",
    name: "Created file",
  });
  let state = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  state = appReducer(state, {
    type: "chat/new-project",
    projectId: bundle.project.id,
    conversationId: "conversation-created-file",
  });
  state = appReducer(state, {
    type: "run/start",
    runId: "run-created-file",
    conversationId: "conversation-created-file",
    message: { id: "user-created-file", role: "user", content: "生成网页" },
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "index.html",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const createProposal = {
    id: "proposal-created-file",
    projectId: bundle.project.id,
    conversationId: "conversation-created-file",
    title: "新增网页",
    kind: "agent" as const,
    status: "pending" as const,
    connectorId: bundle.connection.id,
    connector: "Project connectors",
    createdAt: "2026-08-06T12:00:00.000Z",
    hunks: [
      {
        id: "hunk-created-file",
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
  state = appReducer(state, {
    type: "run/complete",
    runId: "run-created-file",
    conversationId: "conversation-created-file",
    message: {
      id: "assistant-created-file",
      role: "assistant",
      content: "已生成。",
    },
    proposal: createProposal,
  });
  const created = applyChangeProposal({
    proposal: createProposal,
    resources: state.resources,
    receiptId: "receipt-created-file",
    conversationId: "conversation-created-file",
    appliedAt: "2026-08-06T12:01:00.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-created-file",
    conversationId: "conversation-created-file",
    projectId: bundle.project.id,
    createdAt: "2026-08-06T12:01:00.000Z",
    receipt: created.receipt,
    beforeResources: state.resources,
    afterResources: created.resources,
  });
  state = appReducer(state, {
    type: "proposal/applied",
    proposalId: createProposal.id,
    resources: created.resources,
    receipt: created.receipt,
    checkpoint,
    message: {
      id: "applied-created-file",
      role: "assistant",
      content: "已应用",
    },
  });

  assert.equal(state.resources[draft.id]?.path, "index.html");
  assert.equal(
    state.projects[bundle.project.id]?.resourceCount,
    bundle.project.resourceCount + 1,
  );
  assert.equal(
    state.connections[bundle.connection.id]?.resourceCount,
    bundle.connection.resourceCount + 1,
  );

  const restore = createConversationRestoreProposal({
    checkpoint,
    resources: state.resources,
    proposalId: "restore-created-file",
    createdAt: "2026-08-06T12:02:00.000Z",
  });
  state = appReducer(state, {
    type: "proposal/restore-created",
    proposal: restore,
  });
  const removed = applyChangeProposal({
    proposal: restore,
    resources: state.resources,
    receiptId: "receipt-removed-created-file",
    conversationId: "conversation-created-file",
    appliedAt: "2026-08-06T12:03:00.000Z",
  });
  const clearedCheckpoint = advanceConversationCheckpoint({
    checkpoint,
    checkpointId: "ignored",
    conversationId: "conversation-created-file",
    projectId: bundle.project.id,
    createdAt: "2026-08-06T12:03:00.000Z",
    receipt: removed.receipt,
    beforeResources: state.resources,
    afterResources: removed.resources,
  });
  state = appReducer(state, {
    type: "proposal/applied",
    proposalId: restore.id,
    resources: removed.resources,
    receipt: removed.receipt,
    checkpoint: clearedCheckpoint,
    message: {
      id: "removed-created-file",
      role: "assistant",
      content: "已还原",
    },
  });

  assert.equal(state.resources[draft.id], undefined);
  assert.equal(
    state.projects[bundle.project.id]?.resourceCount,
    bundle.project.resourceCount,
  );
  assert.equal(
    state.connections[bundle.connection.id]?.resourceCount,
    bundle.connection.resourceCount,
  );
});

test("an Agent-created project Skill is counted, enabled, and listed", () => {
  const bundle = createProjectWithWorkspace({
    id: "state-created-skill",
    name: "Created Skill",
  });
  let state = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  state = appReducer(state, {
    type: "chat/new-project",
    projectId: bundle.project.id,
    conversationId: "conversation-created-skill",
  });
  state = appReducer(state, {
    type: "run/start",
    runId: "run-created-skill",
    conversationId: "conversation-created-skill",
    message: { id: "user-created-skill", role: "user", content: "创建 Skill" },
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "skills/release-check/SKILL.md",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const document = [
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
  const proposal = {
    id: "proposal-created-skill",
    projectId: bundle.project.id,
    conversationId: "conversation-created-skill",
    title: "新增 Skill",
    kind: "agent" as const,
    status: "pending" as const,
    connectorId: bundle.connection.id,
    connector: "Project workspace",
    createdAt: "2026-08-13T00:00:00.000Z",
    hunks: [
      {
        id: "hunk-created-skill",
        resourceId: draft.id,
        target: draft.path,
        operation: "create" as const,
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: document,
        summary: "新增 Skill",
        lines: [],
      },
    ],
  };
  state = appReducer(state, {
    type: "run/complete",
    runId: "run-created-skill",
    conversationId: "conversation-created-skill",
    message: {
      id: "assistant-created-skill",
      role: "assistant",
      content: "已创建。",
    },
    proposal,
  });
  const created = applyChangeProposal({
    proposal,
    resources: state.resources,
    receiptId: "receipt-created-skill",
    conversationId: "conversation-created-skill",
    appliedAt: "2026-08-13T00:01:00.000Z",
  });
  const checkpoint = advanceConversationCheckpoint({
    checkpointId: "checkpoint-created-skill",
    conversationId: "conversation-created-skill",
    projectId: bundle.project.id,
    createdAt: "2026-08-13T00:01:00.000Z",
    receipt: created.receipt,
    beforeResources: state.resources,
    afterResources: created.resources,
  });
  state = appReducer(state, {
    type: "proposal/applied",
    proposalId: proposal.id,
    resources: created.resources,
    receipt: created.receipt,
    checkpoint,
    message: {
      id: "applied-created-skill",
      role: "assistant",
      content: "已应用",
    },
  });

  assert.equal(
    state.projects[bundle.project.id]?.skillCount,
    bundle.project.skillCount + 1,
  );
  assert.equal(
    state.projectSkillEnabledByProjectId[bundle.project.id]?.["release-check"],
    true,
  );
  assert.equal(state.resources[draft.id]?.content, document);
});

test("a native connection adds project resources without replacing fixtures", () => {
  const next = appReducer(initialAppState, {
    type: "connection/upsert",
    connection: {
      id: "native-launch",
      projectId: "launch",
      name: "设备工作区",
      account: "此设备",
      scope: "Release",
      status: "connected",
      resourceCount: 1,
      access: "persistent",
      writeMode: "recoverable",
    },
    resources: [
      {
        id: "native-plan",
        projectId: "launch",
        connectionId: "native-launch",
        path: "plan.txt",
        content: "ready",
        version: "hash-ready",
        storage: {
          kind: "native-file",
          locator: "content://workspace/plan.txt",
          access: "persistent",
        },
      },
    ],
  });

  assert.equal(next.connections["native-launch"]?.resourceCount, 1);
  assert.equal(next.resources["native-plan"]?.content, "ready");
  assert.ok(next.resources["launch-instructions"]);
});

test("refreshing one connection removes its stale resource entries", () => {
  const connected = appReducer(initialAppState, {
    type: "connection/upsert",
    connection: {
      id: "device-files",
      projectId: "launch",
      name: "Device files",
      account: "Android SAF",
      scope: "fixture",
      status: "connected",
      resourceCount: 2,
      access: "persistent",
      writeMode: "recoverable",
    },
    resources: [
      {
        id: "device-old",
        projectId: "launch",
        connectionId: "device-files",
        path: "old.md",
        content: "old",
        version: "1",
        storage: { kind: "memory" },
      },
      {
        id: "device-current",
        projectId: "launch",
        connectionId: "device-files",
        path: "current.md",
        content: "before",
        version: "1",
        storage: { kind: "memory" },
      },
    ],
  });
  const refreshed = appReducer(connected, {
    type: "connection/upsert",
    connection: {
      ...connected.connections["device-files"]!,
      resourceCount: 1,
    },
    resources: [
      {
        ...connected.resources["device-current"]!,
        content: "after",
        version: "2",
      },
    ],
  });
  assert.equal(refreshed.resources["device-old"], undefined);
  assert.equal(refreshed.resources["device-current"]?.content, "after");
  assert.ok(refreshed.resources["launch-instructions"]);
});

test("connection bundles fail closed when resource scope is inconsistent", () => {
  const connection = {
    id: "test-connector",
    projectId: "launch",
    name: "Test connector",
    account: "fixture",
    scope: "project",
    status: "connected" as const,
    resourceCount: 1,
    access: "persistent" as const,
    writeMode: "recoverable" as const,
  };
  const mismatched = appReducer(initialAppState, {
    type: "connection/upsert",
    connection,
    resources: [
      {
        ...initialAppState.resources["launch-instructions"]!,
        id: "foreign-resource",
        projectId: "other-project",
        connectionId: connection.id,
      },
    ],
  });
  assert.equal(mismatched, initialAppState);

  const attentionWithResource = appReducer(initialAppState, {
    type: "connection/upsert",
    connection: { ...connection, status: "attention", resourceCount: 1 },
    resources: [
      {
        ...initialAppState.resources["launch-instructions"]!,
        connectionId: connection.id,
      },
    ],
  });
  assert.equal(attentionWithResource, initialAppState);

  const collidingResourceId = appReducer(initialAppState, {
    type: "connection/upsert",
    connection,
    resources: [
      {
        ...initialAppState.resources["launch-instructions"]!,
        connectionId: connection.id,
      },
    ],
  });
  assert.equal(collidingResourceId, initialAppState);
});

test("unknown global Skills are not synthesized into application state", () => {
  const next = appReducer(productionInitialAppState, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: "planning",
    enabled: false,
  });

  assert.equal(next, productionInitialAppState);
});

test("unknown global memory and Skill edits are rejected", () => {
  const memoryChanged = appReducer(productionInitialAppState, {
    type: "memory/update-global",
    memoryId: "memory-language",
    text: "默认使用简体中文，并保留代码原文。",
  });
  const changed = appReducer(memoryChanged, {
    type: "skill/update-global",
    skillId: "planning",
    content: "# 项目规划\n\n先确认验收标准。",
  });

  assert.equal(memoryChanged, productionInitialAppState);
  assert.equal(changed, productionInitialAppState);
  assert.deepEqual(getMemoryCatalog(changed), []);
  assert.deepEqual(
    getSkillCatalog(changed),
    getSkillCatalog(productionInitialAppState),
  );
});

test("a manual file proposal is accepted only for the current project resource snapshot", () => {
  const sourceProposal = proposal;
  const hunk = sourceProposal.hunks[0]!;
  const manualProposal = {
    ...sourceProposal,
    id: "manual-project-file",
    kind: "manual" as const,
    hunks: [{ ...hunk, id: "manual-project-file-hunk" }],
  };
  const created = appReducer(initialAppState, {
    type: "proposal/manual-created",
    proposal: manualProposal,
  });

  assert.equal(created.proposals[manualProposal.id], manualProposal);

  const stale = appReducer(initialAppState, {
    type: "proposal/manual-created",
    proposal: {
      ...manualProposal,
      id: "manual-project-file-stale",
      hunks: [
        {
          ...manualProposal.hunks[0]!,
          baseVersion: "stale-version",
        },
      ],
    },
  });
  assert.equal(stale, initialAppState);

  const stateWithOtherConversation = {
    ...initialAppState,
    conversationProjectIds: {
      ...initialAppState.conversationProjectIds,
      "conversation-other": "support",
    },
    messagesByConversation: {
      ...initialAppState.messagesByConversation,
      "conversation-other": [],
    },
  };
  const wrongConversation = appReducer(stateWithOtherConversation, {
    type: "proposal/manual-created",
    proposal: {
      ...manualProposal,
      id: "manual-project-file-wrong-conversation",
      conversationId: "conversation-other",
    },
  });
  assert.equal(wrongConversation, stateWithOtherConversation);

  const createdWithConversation = appReducer(initialAppState, {
    type: "proposal/manual-created",
    proposal: {
      ...manualProposal,
      id: "manual-project-file-new-conversation",
      conversationId: "conversation-project-files",
    },
  });
  assert.equal(
    createdWithConversation.conversationProjectIds[
      "conversation-project-files"
    ],
    "launch",
  );
  assert.deepEqual(
    createdWithConversation.messagesByConversation[
      "conversation-project-files"
    ],
    [],
  );
});

test("a manual project Skill create is accepted only at its deterministic safe target", () => {
  const skillDocument = [
    "---",
    "name: manual-install",
    'title: "Manual install"',
    'description: "Validate a downloaded Skill install."',
    "risk: read",
    "---",
    "",
    "# Procedure",
    "",
    "Read the project before reporting.",
    "",
  ].join("\n");
  const manualProposal = createProjectFileCreateProposal({
    projectId: "launch",
    conversationId: "conversation-project-skill-install",
    path: "skills/manual-install/SKILL.md",
    content: skillDocument,
    connectorLabel: "Project workspace",
    proposalId: "manual-project-skill-install",
    hunkId: "manual-project-skill-install-hunk",
    createdAt: "2026-08-13T00:00:00.000Z",
  });
  const created = appReducer(initialAppState, {
    type: "proposal/manual-created",
    proposal: manualProposal,
  });
  assert.equal(created.proposals[manualProposal.id], manualProposal);

  for (const proposal of [
    {
      ...manualProposal,
      id: "manual-project-skill-wrong-resource",
      hunks: [
        {
          ...manualProposal.hunks[0]!,
          resourceId: "project-workspace:launch-file-tampered",
        },
      ],
    },
    {
      ...manualProposal,
      id: "manual-project-skill-invalid-document",
      hunks: [{ ...manualProposal.hunks[0]!, after: "# Missing metadata" }],
    },
  ]) {
    assert.equal(
      appReducer(initialAppState, {
        type: "proposal/manual-created",
        proposal,
      }),
      initialAppState,
    );
  }
});

test("a new project chat keeps the previous project conversation isolated", () => {
  const next = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-second",
  });

  assert.equal(next.selectedProjectId, "launch");
  assert.equal(next.activeConversationId, "conversation-launch-second");
  assert.deepEqual(next.messages, []);
  assert.equal(
    next.messagesByConversation["conversation-launch"]?.length,
    initialAppState.messages.length,
  );
  assert.deepEqual(
    next.messagesByConversation["conversation-launch-second"],
    [],
  );
  assert.equal(next.conversationIdsByProject.launch, "conversation-launch");
  assert.deepEqual(
    next.recentConversationIds,
    initialAppState.recentConversationIds,
  );
  assert.deepEqual(getProjectConversationIds(next, "launch"), [
    "conversation-launch",
  ]);
});

test("one project lists multiple isolated conversations over shared resources", () => {
  const second = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-second",
  });
  const running = appReducer(second, {
    type: "run/start",
    runId: "run-second-conversation",
    conversationId: "conversation-launch-second",
    message: {
      id: "user-second-conversation",
      role: "user",
      content: "整理第二个对话的发布目标",
    },
  });
  const completed = appReducer(running, {
    type: "run/complete",
    runId: "run-second-conversation",
    conversationId: "conversation-launch-second",
    message: {
      id: "assistant-second-conversation",
      role: "assistant",
      content: "第二个对话的目标已经整理完成。",
    },
  });

  assert.deepEqual(getProjectConversationIds(completed, "launch"), [
    "conversation-launch-second",
    "conversation-launch",
  ]);
  assert.equal(
    getConversationTitle(completed, "conversation-launch-second"),
    "整理第二个对话的发布目标",
  );
  assert.equal(
    getConversationPreview(completed, "conversation-launch-second"),
    "第二个对话的目标已经整理完成。",
  );

  const sharedResources = completed.resources;
  const openedFirst = appReducer(completed, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch",
  });
  assert.equal(openedFirst.activeConversationId, "conversation-launch");
  assert.deepEqual(openedFirst.messages, initialAppState.messages);
  assert.equal(openedFirst.resources, sharedResources);
  assert.equal(
    openedFirst.conversationIdsByProject.launch,
    "conversation-launch-second",
  );
  assert.deepEqual(getProjectConversationIds(openedFirst, "launch"), [
    "conversation-launch-second",
    "conversation-launch",
  ]);

  const reopenedSecond = appReducer(openedFirst, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch-second",
  });
  assert.equal(
    reopenedSecond.messages.at(-1)?.id,
    "assistant-second-conversation",
  );
  assert.equal(reopenedSecond.resources, sharedResources);
});

test("a conversation cannot be opened or rebound through another project", () => {
  const wrongProject = appReducer(initialAppState, {
    type: "chat/open-conversation",
    projectId: "support",
    conversationId: "conversation-launch",
  });
  assert.equal(wrongProject, initialAppState);

  const rebound = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "support",
    conversationId: "conversation-launch",
  });
  assert.equal(rebound, initialAppState);
});

test("an async reply is written back to its originating conversation", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-from-first-conversation",
    conversationId: "conversation-launch",
    message: { id: "origin-request", role: "user", content: "开始。" },
  });
  const switched = appReducer(running, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-second",
  });
  const next = appReducer(switched, {
    type: "run/complete",
    runId: "run-from-first-conversation",
    conversationId: "conversation-launch",
    message: { id: "late-reply", role: "assistant", content: "完成。" },
  });

  assert.deepEqual(next.messages, []);
  assert.equal(
    next.messagesByConversation["conversation-launch"]?.at(-1)?.id,
    "late-reply",
  );
});

test("a delayed run update never clears another conversation's draft", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-origin-draft",
    conversationId: "conversation-launch",
    message: { id: "origin-draft-request", role: "user", content: "开始。" },
  });
  const switched = appReducer(running, {
    type: "chat/new",
    conversationId: "conversation-draft-owner",
  });
  const typing = appReducer(switched, {
    type: "draft/change",
    value: "这是另一个对话的草稿",
  });
  const steered = appReducer(typing, {
    type: "run/steer-queued",
    runId: "run-origin-draft",
    conversationId: "conversation-launch",
    message: { id: "origin-steer", role: "user", content: "补充。" },
  });
  assert.equal(steered.draft, "这是另一个对话的草稿");

  const beforeLateStart = appReducer(initialAppState, {
    type: "chat/new",
    conversationId: "conversation-start-draft-owner",
  });
  const typingBeforeLateStart = appReducer(beforeLateStart, {
    type: "draft/change",
    value: "启动期间输入的新草稿",
  });
  const lateStart = appReducer(typingBeforeLateStart, {
    type: "run/start",
    runId: "run-origin-late",
    conversationId: "conversation-launch",
    message: { id: "origin-late-request", role: "user", content: "开始。" },
  });
  assert.equal(
    lateStart.activeRunsByConversation["conversation-launch"]?.runId,
    "run-origin-late",
  );
  assert.equal(lateStart.draft, "启动期间输入的新草稿");
});

test("three conversations keep independent live streams and a fourth is rejected", () => {
  const first = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-one",
    conversationId: "conversation-launch",
    message: { id: "user-one", role: "user", content: "一" },
  });
  const secondConversation = appReducer(first, {
    type: "chat/new",
    conversationId: "conversation-two",
  });
  const second = appReducer(secondConversation, {
    type: "run/start",
    runId: "run-two",
    conversationId: "conversation-two",
    message: { id: "user-two", role: "user", content: "二" },
  });
  const thirdConversation = appReducer(second, {
    type: "chat/new",
    conversationId: "conversation-three",
  });
  const third = appReducer(thirdConversation, {
    type: "run/start",
    runId: "run-three",
    conversationId: "conversation-three",
    message: { id: "user-three", role: "user", content: "三" },
  });
  const fourthConversation = appReducer(third, {
    type: "chat/new",
    conversationId: "conversation-four",
  });
  const rejected = appReducer(fourthConversation, {
    type: "run/capacity-rejected",
    conversationId: "conversation-four",
  });
  assert.equal(Object.keys(rejected.activeRunsByConversation).length, 3);
  assert.equal(rejected.runError, "runtime.messaging.run.capacity");
  assert.equal(rejected.isRunning, false);

  const returned = appReducer(rejected, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch",
  });
  assert.equal(returned.isRunning, true);
  assert.equal(returned.activeRunId, "run-one");
});

test("run status updates apply only to the active run", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-status",
    conversationId: "conversation-launch",
    message: { id: "user-status", role: "user", content: "开始。" },
  });
  const updated = appReducer(running, {
    type: "run/status",
    runId: "run-status",
    conversationId: "conversation-launch",
    status: "runtime.messaging.status.generating",
  });
  const stale = appReducer(updated, {
    type: "run/status",
    runId: "run-stale",
    conversationId: "conversation-launch",
    status: "不应出现",
  });
  assert.equal(stale.runStatus, "runtime.messaging.status.generating");
});

test("a stale completion cannot stop a newer run", () => {
  const first = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-old",
    conversationId: "conversation-launch",
    message: { id: "user-old", role: "user", content: "旧任务" },
  });
  const cancelled = appReducer(first, {
    type: "run/cancel",
    runId: "run-old",
    conversationId: "conversation-launch",
  });
  const newer = appReducer(cancelled, {
    type: "run/start",
    runId: "run-new",
    conversationId: "conversation-launch",
    message: { id: "user-new", role: "user", content: "新任务" },
  });
  const completedOld = appReducer(newer, {
    type: "run/complete",
    runId: "run-old",
    conversationId: "conversation-launch",
    message: { id: "assistant-old", role: "assistant", content: "旧回复" },
  });

  assert.equal(completedOld.isRunning, true);
  assert.equal(completedOld.activeRunId, "run-new");
  assert.equal(completedOld.messages.at(-1)?.id, "user-new");
});

test("image drafts are isolated from a sent message", () => {
  const attached = appReducer(initialAppState, {
    type: "attachment/add",
    attachment: {
      id: "image-one",
      kind: "image",
      uri: "file:///image.png",
      name: "image.png",
      mimeType: "image/png",
      base64: "aW1hZ2U=",
    },
  });
  const running = appReducer(attached, {
    type: "run/start",
    runId: "run-image",
    conversationId: "conversation-launch",
    message: {
      id: "user-image",
      role: "user",
      content: "分析图片",
      attachments: attached.draftAttachments,
    },
  });

  assert.equal(running.draftAttachments.length, 0);
  assert.equal(running.messages.at(-1)?.attachments?.[0]?.id, "image-one");
});

test("steering appends the queued message without replacing the active run", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-steering",
    conversationId: "conversation-launch",
    message: { id: "user-start", role: "user", content: "开始" },
  });
  const next = appReducer(running, {
    type: "run/steer-queued",
    runId: "run-steering",
    conversationId: "conversation-launch",
    message: { id: "user-steer", role: "user", content: "先检查风险" },
  });

  assert.equal(next.isRunning, true);
  assert.equal(next.activeRunId, "run-steering");
  assert.equal(next.messages.at(-1)?.id, "user-steer");
  assert.equal(next.runStatus, "runtime.messaging.steer.queued");

  const stale = appReducer(next, {
    type: "run/steer-queued",
    runId: "run-cancelled",
    conversationId: "conversation-launch",
    message: { id: "user-stale-steer", role: "user", content: "不应加入" },
  });
  assert.equal(stale, next);
});

test("a failed run can retry without duplicating its user message", () => {
  const started = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-retry",
    conversationId: "conversation-launch",
    message: {
      id: "user-run-retry",
      role: "user",
      content: "继续未完成的任务",
    },
  });
  const failed = appReducer(started, {
    type: "run/fail",
    runId: "run-retry",
    conversationId: "conversation-launch",
    message: "网络暂时不可用",
  });
  assert.equal(failed.retryableRun?.content, "继续未完成的任务");
  const retried = appReducer(failed, {
    type: "run/start",
    runId: "run-retry-2",
    conversationId: "conversation-launch",
    request: failed.retryableRun!,
  });
  assert.equal(
    retried.messagesByConversation["conversation-launch"]?.filter(
      (message) => message.id === "user-run-retry",
    ).length,
    1,
  );
  assert.equal(retried.retryableRun, null);
});

test("failed runs retain their visible execution record in the conversation", () => {
  const started = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-partial",
    conversationId: "conversation-launch",
  });
  const failed = appReducer(started, {
    type: "run/fail",
    runId: "run-partial",
    conversationId: "conversation-launch",
    message: "工具执行失败",
    partialMessage: {
      id: "assistant-run-partial",
      role: "assistant",
      content: "",
      execution: {
        status: "failed",
        durationMs: 2_000,
        activity: [
          {
            id: "activity-text-0",
            kind: "text",
            content: "已经定位到配置文件。",
          },
          {
            id: "activity-tool-1",
            kind: "tool",
            label: "编辑：/project/config.ts",
            status: "failed",
          },
        ],
      },
    },
  });

  assert.equal(failed.messages.at(-1)?.id, "assistant-run-partial");
  assert.equal(failed.messages.at(-1)?.execution?.status, "failed");
  assert.equal(failed.messages.at(-1)?.execution?.activity.length, 2);
  assert.equal(failed.runError, "工具执行失败");
});

test("navigation preserves a failed run only for its originating conversation", () => {
  const started = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-retry-navigation",
    conversationId: "conversation-launch",
    message: {
      id: "user-retry-navigation",
      role: "user",
      content: "稍后继续",
    },
  });
  const failed = appReducer(started, {
    type: "run/fail",
    runId: "run-retry-navigation",
    conversationId: "conversation-launch",
    message: "网络暂时不可用",
  });
  const away = appReducer(failed, {
    type: "chat/new",
    conversationId: "conversation-other",
  });

  assert.equal(away.retryableRun, null);
  assert.equal(
    away.retryableRunsByConversation["conversation-launch"]?.conversationId,
    "conversation-launch",
  );
  assert.equal(away.runError, null);

  const returned = appReducer(away, {
    type: "chat/open-project",
    projectId: "launch",
  });
  assert.equal(returned.retryableRun?.content, "稍后继续");
  assert.equal(returned.runError, "网络暂时不可用");
});

test("project Skill switches are bound to real workspace files", () => {
  const projectSkillId = "rewrite";
  const projectChanged = appReducer(initialAppState, {
    type: "skill/set-enabled",
    scope: "project",
    projectId: "launch",
    skillId: projectSkillId,
    enabled: false,
  });
  assert.equal(
    projectChanged.projectSkillEnabledByProjectId.launch?.[projectSkillId],
    false,
  );

  const unknownGlobal = appReducer(projectChanged, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: "planning",
    enabled: false,
  });
  assert.equal(unknownGlobal, projectChanged);
  const supportChanged = appReducer(projectChanged, {
    type: "skill/set-enabled",
    scope: "project",
    projectId: "support",
    skillId: projectSkillId,
    enabled: false,
  });
  assert.equal(
    supportChanged.projectSkillEnabledByProjectId.support?.[projectSkillId],
    false,
  );

  const inheritedGlobalOverride = appReducer(initialAppState, {
    type: "skill/set-enabled",
    scope: "project",
    projectId: "launch",
    skillId: "build-h5",
    enabled: false,
  });
  assert.equal(
    inheritedGlobalOverride.projectSkillEnabledByProjectId.launch?.["build-h5"],
    false,
  );
});

test("user-created global memory and Skill become real Agent catalog entries", () => {
  const memory = {
    id: "global-memory-user-1",
    text: "优先给出可以直接执行的结论。",
    scope: "global" as const,
    source: "手动添加",
    sourceMessage: { key: "library.screen.memory.source.manual" as const },
    projectIds: [],
    pinned: true,
  };
  const skill = {
    id: "global-skill-user-1",
    name: "校对",
    description: "校对文字",
    content: "# 校对\n\n检查错别字并保持原意。",
    risk: "propose" as const,
    enabled: true,
    scope: "global" as const,
    projectIds: [],
  };
  const withMemory = appReducer(productionInitialAppState, {
    type: "memory/create-global",
    memory,
  });
  const withSkill = appReducer(withMemory, {
    type: "skill/create-global",
    skill,
  });

  assert.equal(getMemoryCatalog(withSkill).at(-1)?.text, memory.text);
  assert.deepEqual(
    getMemoryCatalog(withSkill).at(-1)?.sourceMessage,
    memory.sourceMessage,
  );
  assert.equal(getSkillCatalog(withSkill).at(-1)?.content, skill.content);
  assert.equal(withSkill.skillEnabledById[skill.id], true);

  const edited = appReducer(withSkill, {
    type: "skill/update-global",
    skillId: skill.id,
    content: "# 校对\n\n只修正明确错误。",
  });
  const disabled = appReducer(edited, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: skill.id,
    enabled: false,
  });
  assert.equal(
    getSkillCatalog(disabled).find((item) => item.id === skill.id)?.content,
    "# 校对\n\n只修正明确错误。",
  );
  assert.equal(disabled.skillEnabledById[skill.id], false);
});

test("a project workspace Skill is added once and enabled only in that project", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-custom-skill",
    name: "Custom Skill",
  });
  const created = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  const custom = createProjectWorkspaceSkillResource({
    projectId: bundle.project.id,
    slug: "review-copy",
    name: "文案检查",
    content: "# 文案检查\n\n检查表达是否清楚。",
  });
  const added = appReducer(created, {
    type: "project/workspace-skill-created",
    projectId: bundle.project.id,
    ...custom,
  });

  assert.equal(added.resources[custom.resource.id]?.path, custom.resource.path);
  assert.equal(
    added.connections[bundle.connection.id]?.resourceCount,
    bundle.resources.length + 1,
  );
  assert.equal(
    added.projectSkillEnabledByProjectId[bundle.project.id]?.[custom.skillId],
    true,
  );
  assert.equal(
    appReducer(added, {
      type: "project/workspace-skill-created",
      projectId: bundle.project.id,
      ...custom,
    }),
    added,
  );
});

test("a quick conversation can be claimed without losing its history", () => {
  const bundle = createProjectWithWorkspace({
    id: "claim-project",
    name: "Claim project",
  });
  let state = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  state = appReducer(state, {
    type: "chat/new",
    conversationId: "quick-to-claim",
  });
  state = {
    ...state,
    messages: [{ id: "claim-message", role: "user", content: "保留我" }],
    messagesByConversation: {
      ...state.messagesByConversation,
      "quick-to-claim": [
        { id: "claim-message", role: "user", content: "保留我" },
      ],
    },
  };
  const claimed = appReducer(state, {
    type: "conversation/claim-project",
    conversationId: "quick-to-claim",
    projectId: bundle.project.id,
  });

  assert.equal(
    claimed.conversationProjectIds["quick-to-claim"],
    bundle.project.id,
  );
  assert.equal(
    claimed.conversationIdsByProject[bundle.project.id],
    "quick-to-claim",
  );
  assert.equal(claimed.selectedProjectId, bundle.project.id);
  assert.equal(
    claimed.messagesByConversation["quick-to-claim"]?.[0]?.content,
    "保留我",
  );
});

test("conversation deletion removes its review graph and always leaves a usable chat", () => {
  const state = {
    ...initialAppState,
    proposals: { [proposal.id]: { ...proposal, status: "applied" as const } },
  };
  const deleted = appReducer(state, {
    type: "conversation/delete",
    conversationId: "conversation-launch",
    replacementConversationId: "conversation-replacement",
  });

  assert.equal(deleted.activeConversationId, "conversation-replacement");
  assert.equal(
    deleted.conversationProjectIds["conversation-launch"],
    undefined,
  );
  assert.equal(
    deleted.conversationProjectIds["conversation-replacement"],
    null,
  );
  assert.deepEqual(
    deleted.messagesByConversation["conversation-replacement"],
    [],
  );
  assert.equal(deleted.proposals[proposal.id], undefined);
  assert.equal(deleted.selectedProjectId, null);
});
