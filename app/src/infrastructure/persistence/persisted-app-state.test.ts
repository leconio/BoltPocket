import assert from "node:assert/strict";
import test from "node:test";

import {
  appReducer,
  getMemoryCatalog,
  getProjectConversationIds,
  getSkillCatalog,
  initialAppState as productionInitialAppState,
} from "../../domain/app-state.ts";
import type {
  GeneratedImageAttachment,
  GeneratedVideoAttachment,
  ImageAttachment,
} from "../../domain/models.ts";
import {
  proposal,
  seededAppState as initialAppState,
} from "../../testing/app-state-fixtures.ts";
import {
  createProjectWorkspaceBinaryFileResource,
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  createProjectWorkspaceSkillResource,
} from "../../domain/project-workspace.ts";
import { projectWorkspaceSkills } from "../../application/project-workspace-context.ts";
import { builtInProjectResourceFile } from "../../domain/builtin-project-resources.ts";
import { InMemoryDurableDocumentStore } from "./document-store.ts";
import {
  createPersistedAppState,
  decodePersistedAppState,
  PersistedAppStateError,
  PersistedAppStateRepository,
  restorePersistedAppState,
} from "./persisted-app-state.ts";

const attachment: ImageAttachment = {
  id: "attachment-1",
  kind: "image",
  uri: "file:///private/image.png",
  name: "image.png",
  mimeType: "image/png",
  base64: "sensitive-image-bytes",
  sizeBytes: 21,
};

test("conversation model pins survive encrypted persistence", () => {
  const state = appReducer(productionInitialAppState, {
    type: "conversation/set-model",
    conversationId: productionInitialAppState.activeConversationId,
    modelProfileId: "profile-agent-main",
  });
  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(state)),
  );
  assert.equal(snapshot.conversations[0]?.modelProfileId, "profile-agent-main");
  const restored = restorePersistedAppState(
    productionInitialAppState,
    snapshot,
  );
  assert.equal(
    restored.conversationModelProfileIds[
      productionInitialAppState.activeConversationId
    ],
    "profile-agent-main",
  );
});

test("encrypted app snapshot round-trips history and strips image payloads", async () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-persist",
    conversationId: "conversation-launch",
    message: {
      id: "user-run-persist",
      role: "user",
      content: "分析图片",
      attachments: [attachment],
    },
  });
  const snapshot = createPersistedAppState(
    {
      ...running,
      conversationCheckpoints: {
        "conversation-launch": {
          id: "checkpoint-persist",
          conversationId: "conversation-launch",
          projectId: "launch",
          createdAt: "2026-08-03T08:00:00.000Z",
          baselineResources: {
            "launch-instructions":
              initialAppState.resources["launch-instructions"]!,
          },
          latestResources: {
            "launch-instructions":
              initialAppState.resources["launch-instructions"]!,
          },
        },
      },
    },
    "2026-08-03T09:00:00.000Z",
  );
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes(attachment.base64 ?? "missing-base64"), false);
  assert.equal(encoded.includes(attachment.uri), false);

  const store = new InMemoryDurableDocumentStore();
  const repository = new PersistedAppStateRepository(store);
  await repository.save(running, "2026-08-03T09:00:00.000Z");
  const loaded = await repository.load();
  assert.ok(loaded);
  const restored = restorePersistedAppState(initialAppState, snapshot);
  assert.equal(restored.isRunning, false);
  assert.equal(restored.retryableRun?.content, "分析图片");
  assert.equal(restored.retryableRun?.requiresAttachmentReselection, true);
  assert.equal(restored.retryableRun?.retryReason, "interrupted");
  assert.deepEqual(restored.retryableRun?.attachments, []);
  assert.equal(
    restored.messagesByConversation["conversation-launch"]?.at(-1)?.attachments,
    undefined,
  );
  assert.equal(
    restored.conversationCheckpoints["conversation-launch"]?.id,
    "checkpoint-persist",
  );
});

test("host-generated image attachments keep only durable local metadata", () => {
  const generated: GeneratedImageAttachment = {
    id: "generated-image-persisted",
    kind: "generated-image",
    uri: "file:///documents/boltpocket/generated-images/result.png",
    name: "result.png",
    mimeType: "image/png",
    sizeBytes: 96,
    providerName: "Fixture Images",
    modelId: "image-model-1",
    createdAt: "2026-08-09T12:00:00.000Z",
  };
  const assistant = {
    id: "assistant-generated-image",
    role: "assistant" as const,
    content: "图片已生成。",
    attachments: [generated],
  };
  const state = {
    ...initialAppState,
    messages: [...initialAppState.messages, assistant],
    messagesByConversation: {
      ...initialAppState.messagesByConversation,
      "conversation-launch": [
        ...(initialAppState.messagesByConversation["conversation-launch"] ??
          []),
        assistant,
      ],
    },
  };
  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(state)),
  );
  const saved = snapshot.conversations
    .find((conversation) => conversation.id === "conversation-launch")
    ?.messages.at(-1)?.attachments?.[0];
  assert.deepEqual(saved, generated);
  const restored = restorePersistedAppState(initialAppState, snapshot);
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"]?.at(-1)?.attachments,
    [generated],
  );
});

test("host-generated video attachments survive encrypted persistence as local metadata", () => {
  const generated: GeneratedVideoAttachment = {
    id: "generated-video-persisted",
    kind: "generated-video",
    uri: "file:///documents/boltpocket/generated-videos/result.mp4",
    name: "result.mp4",
    mimeType: "video/mp4",
    sizeBytes: 4_096,
    durationSeconds: 4,
    providerName: "Fixture Video",
    modelId: "doubao-seedance-2-5-260628",
    createdAt: "2026-08-09T12:00:00.000Z",
  };
  const assistant = {
    id: "assistant-generated-video",
    role: "assistant" as const,
    content: "视频已生成。",
    attachments: [generated],
  };
  const state = {
    ...initialAppState,
    messagesByConversation: {
      ...initialAppState.messagesByConversation,
      "conversation-launch": [
        ...(initialAppState.messagesByConversation["conversation-launch"] ??
          []),
        assistant,
      ],
    },
  };
  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(state)),
  );
  const saved = snapshot.conversations
    .find((conversation) => conversation.id === "conversation-launch")
    ?.messages.at(-1)?.attachments?.[0];
  assert.deepEqual(saved, generated);
  const restored = restorePersistedAppState(initialAppState, snapshot);
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"]?.at(-1)?.attachments,
    [generated],
  );
});

test("visible execution activity is encrypted without model reasoning", () => {
  const assistant = {
    id: "assistant-thinking",
    role: "assistant" as const,
    content: "最终回答。",
    thinking: "先检查上下文。",
    toolActivity: ["读取项目上下文", "读取项目文件"],
    execution: {
      status: "completed" as const,
      durationMs: 1_250,
      activity: [
        {
          id: "activity-thinking-legacy",
          kind: "thinking" as const,
          content: "不会进入新的持久化快照。",
        },
        {
          id: "activity-text-0",
          kind: "text" as const,
          content: "我先检查上下文。",
        },
        {
          id: "activity-tool-1",
          kind: "tool" as const,
          label: "读取项目上下文",
          status: "failed" as const,
          durationMs: 250,
          failureReason: "MCP 连接超时。",
        },
        {
          id: "activity-context-2",
          kind: "context" as const,
          operation: "automatic_compaction" as const,
          status: "completed" as const,
          tokensBefore: 118_000,
          tokensAfter: 24_000,
          durationMs: 800,
        },
      ],
    },
    collaboration: [
      {
        id: "child-review",
        role: "reviewer" as const,
        description: "审查权限边界",
        status: "completed" as const,
        startedAt: 100,
        durationMs: 250,
        summary: "权限边界正确。",
        toolActivity: ["读取项目文件"],
      },
    ],
  };
  const state = {
    ...initialAppState,
    messages: [...initialAppState.messages, assistant],
    messagesByConversation: {
      ...initialAppState.messagesByConversation,
      "conversation-launch": [
        ...(initialAppState.messagesByConversation["conversation-launch"] ??
          []),
        assistant,
      ],
    },
  };

  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(state))),
  );

  assert.equal(
    restored.messagesByConversation["conversation-launch"]?.at(-1)?.thinking,
    undefined,
  );
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"]?.at(-1)
      ?.toolActivity,
    ["读取项目上下文", "读取项目文件"],
  );
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"]?.at(-1)
      ?.collaboration,
    assistant.collaboration,
  );
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"]?.at(-1)?.execution,
    {
      ...assistant.execution,
      activity: assistant.execution.activity.filter(
        ({ kind }) => kind !== "thinking",
      ),
    },
  );
});

test("project Skill settings round-trip against their workspace file", () => {
  const projectSkillId = "rewrite";
  const changed = appReducer(initialAppState, {
    type: "skill/set-enabled",
    scope: "project",
    projectId: "launch",
    skillId: projectSkillId,
    enabled: false,
  });
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(changed))),
  );

  assert.equal(
    restored.projectSkillEnabledByProjectId.launch?.[projectSkillId],
    false,
  );
});

test("project built-in resource settings round-trip without changing defaults", () => {
  const changed = appReducer(initialAppState, {
    type: "project-resource/set-enabled",
    projectId: "launch",
    packId: "kenney-ui",
    enabled: false,
  });
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(changed))),
  );

  assert.equal(
    restored.projectResourcePackEnabledByProjectId.launch?.["kenney-ui"],
    false,
  );
  assert.equal(
    restored.projectResourcePackEnabledByProjectId.launch?.[
      "bootstrap-icons"
    ] ?? true,
    true,
  );
});

test("home pins and recent activity round-trip without accepting unknown IDs", () => {
  let changed = appReducer(initialAppState, {
    type: "project/set-pinned",
    projectId: "support",
    pinned: true,
  });
  changed = appReducer(changed, {
    type: "chat/new-project",
    projectId: "research",
    conversationId: "conversation-research-persisted",
  });
  changed = appReducer(changed, {
    type: "run/start",
    runId: "run-research-persisted",
    conversationId: "conversation-research-persisted",
    message: {
      id: "message-research-persisted",
      role: "user",
      content: "记录这次研究活动",
    },
  });
  const snapshot = createPersistedAppState(changed);
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(snapshot)),
  );

  assert.deepEqual(restored.pinnedProjectIds, ["support", "launch"]);
  assert.equal(restored.recentProjectIds[0], "research");
  assert.deepEqual(
    restored.recentConversationIds,
    changed.recentConversationIds,
  );

  const tampered = structuredClone(snapshot);
  tampered.pinnedProjectIds = ["unknown-project"];
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(tampered)),
    PersistedAppStateError,
  );
});

test("untouched new conversations stay ephemeral in durable snapshots", () => {
  const projectConversation = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-ephemeral",
  });
  const projectSnapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(projectConversation)),
  );

  assert.equal(
    projectSnapshot.conversations.some(
      (conversation) => conversation.id === "conversation-launch-ephemeral",
    ),
    false,
  );
  assert.equal(projectSnapshot.activeConversationId, "conversation-launch");
  assert.equal(projectSnapshot.selectedProjectId, "launch");
  assert.deepEqual(projectSnapshot.projectConversations, [
    { projectId: "launch", conversationId: "conversation-launch" },
  ]);

  const quickConversation = appReducer(initialAppState, {
    type: "chat/new",
    conversationId: "conversation-quick-ephemeral",
  });
  const quickSnapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(quickConversation)),
  );
  assert.equal(
    quickSnapshot.conversations.some(
      (conversation) => conversation.id === "conversation-quick-ephemeral",
    ),
    false,
  );
  assert.equal(quickSnapshot.activeConversationId, "conversation-launch");
  assert.equal(quickSnapshot.selectedProjectId, "launch");
});

test("opening history does not replace the last actively used conversation", () => {
  let state = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-active",
  });
  state = appReducer(state, {
    type: "run/start",
    runId: "run-launch-active",
    conversationId: "conversation-launch-active",
    message: {
      id: "message-launch-active",
      role: "user",
      content: "这条会话才是最近操作的",
    },
  });
  state = appReducer(state, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch",
  });
  assert.equal(state.activeConversationId, "conversation-launch");

  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(state)),
  );
  assert.equal(snapshot.activeConversationId, "conversation-launch-active");
  assert.equal(snapshot.selectedProjectId, "launch");
  assert.equal(
    snapshot.projectConversations.find(
      (mapping) => mapping.projectId === "launch",
    )?.conversationId,
    "conversation-launch-active",
  );
  assert.equal(
    snapshot.recentConversationIds?.[0],
    "conversation-launch-active",
  );
});

test("snapshots saved before home activity existed restore without losing content", () => {
  const snapshot = createPersistedAppState(initialAppState);
  delete snapshot.pinnedProjectIds;
  delete snapshot.recentProjectIds;
  delete snapshot.recentConversationIds;

  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(snapshot)),
  );

  assert.deepEqual(restored.pinnedProjectIds, []);
  assert.deepEqual(restored.recentProjectIds, ["launch"]);
  assert.deepEqual(restored.recentConversationIds, ["conversation-launch"]);
  assert.equal(restored.projects.launch?.name, "Q3 产品发布");
  assert.deepEqual(restored.messages, initialAppState.messages);
});

test("product-owned global catalogs persist without synthesizing sample entries", () => {
  const restored = restorePersistedAppState(
    productionInitialAppState,
    decodePersistedAppState(
      JSON.stringify(createPersistedAppState(productionInitialAppState)),
    ),
  );

  assert.deepEqual(restored.globalMemoryTextById, {});
  assert.deepEqual(restored.globalSkillContentById, {});
  assert.deepEqual(getMemoryCatalog(restored), []);
  assert.deepEqual(
    getSkillCatalog(restored).map((skill) => skill.id),
    [
      "build-h5",
      "manage-calendar-reminders",
      "operate-browser",
      "operate-device",
      "operate-ssh",
      "play-device-audio",
      "read-device-sensors",
      "skill-authoring",
      "use-bootstrap-icons",
      "use-h5-resources",
      "use-kenney-1bit",
      "use-kenney-ui",
    ],
  );
  assert.equal(restored.skillEnabledById["build-h5"], true);
  assert.equal(restored.skillEnabledById["manage-calendar-reminders"], true);
  assert.equal(restored.skillEnabledById["operate-browser"], true);
  assert.equal(restored.skillEnabledById["operate-device"], true);
  assert.equal(restored.skillEnabledById["operate-ssh"], true);
  assert.equal(restored.skillEnabledById["play-device-audio"], true);
  assert.equal(restored.skillEnabledById["read-device-sensors"], true);
  assert.equal(restored.skillEnabledById["use-bootstrap-icons"], true);
  assert.equal(restored.skillEnabledById["use-h5-resources"], true);
  assert.equal(restored.skillEnabledById["use-kenney-1bit"], true);
  assert.equal(restored.skillEnabledById["use-kenney-ui"], true);
});

test("global Skill edits and app-wide defaults round-trip", () => {
  const content = "# 生成 H5 项目\n\n使用项目文件并在完成后预览。";
  const changed = appReducer(
    appReducer(productionInitialAppState, {
      type: "skill/set-enabled",
      scope: "global",
      skillId: "build-h5",
      enabled: false,
    }),
    {
      type: "skill/update-global",
      skillId: "build-h5",
      content,
    },
  );
  const restored = restorePersistedAppState(
    productionInitialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(changed))),
  );

  assert.equal(restored.skillEnabledById["build-h5"], false);
  assert.equal(restored.globalSkillContentById["build-h5"], content);
  assert.equal(
    getSkillCatalog(restored).find((skill) => skill.id === "build-h5")?.content,
    content,
  );
});

test("project Skill overrides survive restart and win over the global default", () => {
  const bundle = createProjectWithWorkspace({
    id: "persisted-skill-override",
    name: "Persisted Skill Override",
  });
  let changed = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  changed = appReducer(changed, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: "build-h5",
    enabled: false,
  });
  changed = appReducer(changed, {
    type: "skill/set-enabled",
    scope: "project",
    projectId: bundle.project.id,
    skillId: "build-h5",
    enabled: true,
  });

  const restored = restorePersistedAppState(
    productionInitialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(changed))),
  );
  const resolved = projectWorkspaceSkills({
    catalog: getSkillCatalog(restored),
    resources: Object.values(restored.resources),
    enabledById: restored.skillEnabledById,
    projectEnabledById:
      restored.projectSkillEnabledByProjectId[bundle.project.id],
    projectId: bundle.project.id,
  });

  assert.equal(restored.skillEnabledById["build-h5"], false);
  assert.equal(
    restored.projectSkillEnabledByProjectId[bundle.project.id]?.["build-h5"],
    true,
  );
  assert.equal(
    resolved.find((skill) => skill.id === "build-h5")?.enabled,
    true,
  );
});

test("user-created global library entries and project Skills survive restart", () => {
  const bundle = createProjectWithWorkspace({
    id: "persisted-custom-library",
    name: "Custom library",
  });
  let changed = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  changed = appReducer(changed, {
    type: "memory/create-global",
    memory: {
      id: "global-memory-persisted",
      text: "记住这个偏好。",
      scope: "global",
      source: "手动添加",
      sourceMessage: { key: "library.screen.memory.source.manual" },
      projectIds: [],
      pinned: true,
    },
  });
  changed = appReducer(changed, {
    type: "skill/create-global",
    skill: {
      id: "global-skill-persisted",
      name: "整理",
      description: "整理内容",
      content: "# 整理\n\n输出简洁清单。",
      risk: "propose",
      enabled: true,
      scope: "global",
      projectIds: [],
    },
  });
  changed = appReducer(changed, {
    type: "skill/set-enabled",
    scope: "global",
    skillId: "global-skill-persisted",
    enabled: false,
  });
  const projectSkill = createProjectWorkspaceSkillResource({
    projectId: bundle.project.id,
    slug: "persisted-project-skill",
    name: "项目整理",
    content: "# 项目整理\n\n读取项目资料后再整理。",
  });
  changed = appReducer(changed, {
    type: "project/workspace-skill-created",
    projectId: bundle.project.id,
    ...projectSkill,
  });

  const restored = restorePersistedAppState(
    productionInitialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(changed))),
  );

  assert.equal(
    getMemoryCatalog(restored).find(
      (memory) => memory.id === "global-memory-persisted",
    )?.text,
    "记住这个偏好。",
  );
  assert.deepEqual(
    getMemoryCatalog(restored).find(
      (memory) => memory.id === "global-memory-persisted",
    )?.sourceMessage,
    { key: "library.screen.memory.source.manual" },
  );
  assert.equal(
    getSkillCatalog(restored).find(
      (skill) => skill.id === "global-skill-persisted",
    )?.content,
    "# 整理\n\n输出简洁清单。",
  );
  assert.equal(restored.skillEnabledById["global-skill-persisted"], false);
  assert.equal(
    restored.resources[projectSkill.resource.id]?.path,
    projectSkill.resource.path,
  );
});

test("an interrupted run is restored with an explicit retry", () => {
  const running = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-interrupted",
    conversationId: "conversation-launch",
    message: {
      id: "user-interrupted",
      role: "user",
      content: "继续工作",
    },
  });
  const snapshot = createPersistedAppState(running, "2026-08-03T08:02:00.000Z");
  assert.equal(snapshot.pendingRuns[0]?.runId, "run-interrupted");
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(snapshot)),
    "2026-08-03T08:03:00.000Z",
  );

  assert.equal(restored.retryableRun?.content, "继续工作");
  assert.equal(restored.retryableRun?.retryReason, "interrupted");
  assert.equal(restored.runError, "runtime.messaging.retry.interrupted");
});

test("three pending conversations restore as three independent interrupted retries", () => {
  const first = appReducer(initialAppState, {
    type: "run/start",
    runId: "run-pending-one",
    conversationId: "conversation-launch",
    message: { id: "pending-one", role: "user", content: "一" },
  });
  const secondConversation = appReducer(first, {
    type: "chat/new",
    conversationId: "conversation-pending-two",
  });
  const second = appReducer(secondConversation, {
    type: "run/start",
    runId: "run-pending-two",
    conversationId: "conversation-pending-two",
    message: { id: "pending-two", role: "user", content: "二" },
  });
  const thirdConversation = appReducer(second, {
    type: "chat/new",
    conversationId: "conversation-pending-three",
  });
  const third = appReducer(thirdConversation, {
    type: "run/start",
    runId: "run-pending-three",
    conversationId: "conversation-pending-three",
    message: { id: "pending-three", role: "user", content: "三" },
  });

  const snapshot = createPersistedAppState(third);
  assert.equal(snapshot.pendingRuns.length, 3);
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(snapshot)),
  );
  assert.equal(Object.keys(restored.activeRunsByConversation).length, 0);
  assert.equal(Object.keys(restored.retryableRunsByConversation).length, 3);
  assert.equal(
    restored.retryableRunsByConversation["conversation-launch"]?.retryReason,
    "interrupted",
  );
  assert.equal(
    restored.retryableRunsByConversation["conversation-pending-two"]
      ?.retryReason,
    "interrupted",
  );
});

test("version three snapshots migrate without changing project data", () => {
  const snapshot = createPersistedAppState(initialAppState) as unknown as {
    version: number;
  };
  snapshot.version = 3;
  const migrated = decodePersistedAppState(JSON.stringify(snapshot));
  assert.equal(migrated.version, 5);
  assert.deepEqual(
    migrated.projects,
    createPersistedAppState(initialAppState).projects,
  );
});

test("version one snapshots preserve conversations without inventing projects", () => {
  const current = createPersistedAppState(initialAppState);
  const {
    globalMemoryEdits: _globalMemoryEdits,
    globalSkillEdits: _globalSkillEdits,
    projects: _projects,
    projectSkillSettings: _projectSkillSettings,
    workspaceResources: _workspaceResources,
    ...legacyBase
  } = current;
  const workflowId = "legacy-workflow";
  const legacy = {
    ...legacyBase,
    version: 1,
    conversations: current.conversations.map((conversation) => ({
      ...conversation,
      mode: "goal",
      workflowId,
      messages: conversation.messages.map((message) => ({
        ...message,
        workflowId,
      })),
    })),
    workflows: [
      {
        id: workflowId,
        runId: "legacy-run",
        conversationId: "conversation-launch",
        mode: "goal",
        goal: "旧版自建工作流",
        status: "completed",
        tasks: [],
        subagents: [],
        createdAt: "2026-08-03T08:00:00.000Z",
        updatedAt: "2026-08-03T08:01:00.000Z",
      },
    ],
  };

  const migrated = decodePersistedAppState(JSON.stringify(legacy));
  assert.equal(migrated.version, 5);
  assert.deepEqual(migrated.projects, []);
  assert.deepEqual(migrated.workspaceResources, []);
  assert.equal(migrated.selectedProjectId, null);
  assert.deepEqual(migrated.projectConversations, []);
  assert.equal(migrated.conversations[0]?.projectId, null);
  assert.equal(
    migrated.conversations[0]?.messages[0]?.content,
    current.conversations[0]?.messages[0]?.content,
  );
  assert.equal(
    Object.hasOwn(migrated.conversations[0]?.messages[0] ?? {}, "workflowId"),
    false,
  );
  assert.equal(Object.hasOwn(migrated, "workflows"), false);
});

test("multiple conversations in one project survive persistence independently", () => {
  const second = appReducer(initialAppState, {
    type: "chat/new-project",
    projectId: "launch",
    conversationId: "conversation-launch-second",
  });
  const running = appReducer(second, {
    type: "run/start",
    runId: "run-persist-second",
    conversationId: "conversation-launch-second",
    message: {
      id: "user-persist-second",
      role: "user",
      content: "这是第二个项目对话",
    },
  });
  const completed = appReducer(running, {
    type: "run/complete",
    runId: "run-persist-second",
    conversationId: "conversation-launch-second",
    message: {
      id: "assistant-persist-second",
      role: "assistant",
      content: "第二个对话已独立保存。",
    },
  });
  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(completed)),
  );
  const restored = restorePersistedAppState(initialAppState, snapshot);

  assert.deepEqual(getProjectConversationIds(restored, "launch"), [
    "conversation-launch-second",
    "conversation-launch",
  ]);
  assert.equal(
    restored.messagesByConversation["conversation-launch-second"]?.at(-1)?.id,
    "assistant-persist-second",
  );
  assert.deepEqual(
    restored.messagesByConversation["conversation-launch"],
    initialAppState.messages,
  );

  const openedFirst = appReducer(restored, {
    type: "chat/open-conversation",
    projectId: "launch",
    conversationId: "conversation-launch",
  });
  assert.equal(openedFirst.activeConversationId, "conversation-launch");
  assert.deepEqual(openedFirst.messages, initialAppState.messages);
});

test("new projects and approved workspace content survive encrypted persistence", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-persisted-workspace",
    name: "持久项目",
  });
  const created = appReducer(initialAppState, {
    type: "project/created",
    ...bundle,
  });
  const memory = bundle.resources.find(
    (resource) => resource.path === "MEMORY.md",
  )!;
  const updated = {
    ...created,
    resources: {
      ...created.resources,
      [memory.id]: {
        ...memory,
        content: "# 项目记忆\n\n- 用户确认每周五发布。\n",
        version: "2",
      },
    },
  };

  const snapshot = decodePersistedAppState(
    JSON.stringify(createPersistedAppState(updated)),
  );
  const restored = restorePersistedAppState(initialAppState, snapshot);

  assert.equal(restored.projects[bundle.project.id]?.name, "持久项目");
  assert.equal(
    restored.resources[memory.id]?.content,
    "# 项目记忆\n\n- 用户确认每周五发布。\n",
  );
  assert.equal(
    restored.connections[bundle.connection.id]?.resourceCount,
    bundle.resources.length,
  );
});

test("copied binary project resources survive encrypted persistence", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-persisted-binary",
    name: "便携资源项目",
  });
  const created = appReducer(initialAppState, {
    type: "project/created",
    ...bundle,
  });
  const descriptor = builtInProjectResourceFile(
    "kenney-ui",
    "png/blue/arrow_basic_e_small.png",
  );
  assert.ok(descriptor);
  const binary = createProjectWorkspaceBinaryFileResource({
    projectId: bundle.project.id,
    path: "apps/demo/assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png",
    contentBase64: Buffer.alloc(descriptor.byteLength).toString("base64"),
    packId: "kenney-ui",
    sourcePath: descriptor.path,
    mimeType: descriptor.mimeType,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
  });
  const updated = {
    ...created,
    resources: { ...created.resources, [binary.id]: binary },
    projects: {
      ...created.projects,
      [bundle.project.id]: {
        ...created.projects[bundle.project.id]!,
        resourceCount: created.projects[bundle.project.id]!.resourceCount + 1,
      },
    },
    connections: {
      ...created.connections,
      [bundle.connection.id]: {
        ...created.connections[bundle.connection.id]!,
        resourceCount:
          created.connections[bundle.connection.id]!.resourceCount + 1,
      },
    },
  };

  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(updated))),
  );
  const restoredBinary = restored.resources[binary.id];
  assert.equal(restoredBinary?.content, binary.content);
  assert.equal(restoredBinary?.storage.kind, "project-workspace");
  assert.equal(
    restoredBinary?.storage.kind === "project-workspace"
      ? restoredBinary.storage.binary?.sha256
      : undefined,
    descriptor.sha256,
  );
});

test("version two snapshots preserve global conversations safely", () => {
  const current = createPersistedAppState(initialAppState);
  const {
    globalMemoryEdits: _globalMemoryEdits,
    globalSkillEdits: _globalSkillEdits,
    projects: _projects,
    projectSkillSettings: _projectSkillSettings,
    workspaceResources: _workspaceResources,
    ...previous
  } = current;
  const migrated = decodePersistedAppState(
    JSON.stringify({ ...previous, version: 2 }),
  );
  assert.equal(migrated.version, 5);
  assert.equal(migrated.selectedProjectId, null);
  assert.equal(migrated.conversations[0]?.projectId, null);
  assert.deepEqual(migrated.projects, []);
});

test("repository keeps an exact recovery copy before migrating current legacy state", async () => {
  const current = createPersistedAppState(initialAppState);
  const legacy = JSON.stringify({ ...current, version: 3 });
  const store = new InMemoryDurableDocumentStore();
  await store.write("app-state:v2", legacy);

  const migrated = await new PersistedAppStateRepository(store).load();

  assert.equal(migrated?.version, 5);
  assert.equal(await store.read("app-state:v2:before-v4-recovery"), legacy);
  assert.equal(
    JSON.parse((await store.read("app-state:v2")) ?? "null")?.version,
    5,
  );
});

test("a project file edit proposal and its owning conversation survive persistence", () => {
  const sourceProposal = proposal;
  const manualProposal = {
    ...sourceProposal,
    id: "manual-file-persist",
    kind: "manual" as const,
    conversationId: "conversation-project-files",
    titleMessage: {
      key: "changes.generated.manualTitle" as const,
      values: { path: "notes.md" },
    },
    hunks: [
      {
        ...sourceProposal.hunks[0]!,
        id: "manual-file-persist-content",
        summaryMessage: {
          key: "changes.generated.manualSummary" as const,
        },
      },
    ],
  };
  const created = appReducer(initialAppState, {
    type: "proposal/manual-created",
    proposal: manualProposal,
  });
  const restored = restorePersistedAppState(
    initialAppState,
    decodePersistedAppState(JSON.stringify(createPersistedAppState(created))),
  );

  assert.equal(restored.proposals[manualProposal.id]?.kind, "manual");
  assert.deepEqual(
    restored.proposals[manualProposal.id]?.titleMessage,
    manualProposal.titleMessage,
  );
  assert.deepEqual(
    restored.proposals[manualProposal.id]?.hunks[0]?.summaryMessage,
    manualProposal.hunks[0]?.summaryMessage,
  );
  assert.equal(
    restored.conversationProjectIds["conversation-project-files"],
    "launch",
  );
  assert.deepEqual(
    restored.messagesByConversation["conversation-project-files"],
    [],
  );
});

test("saved state rejects unknown references and unexpected secret fields", () => {
  const snapshot = createPersistedAppState({
    ...initialAppState,
    proposals: { [proposal.id]: proposal },
  });
  const dangling = structuredClone(snapshot);
  Object.assign(dangling.conversations[0]!.messages[0]!, {
    workflowId: "removed-field",
  });
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(dangling)),
    PersistedAppStateError,
  );

  const secretField = JSON.parse(JSON.stringify(snapshot)) as Record<
    string,
    unknown
  >;
  (
    secretField.conversations as { messages: Record<string, unknown>[] }[]
  )[0]!.messages[0]!.apiKey = "must-not-be-accepted";
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(secretField)),
    PersistedAppStateError,
  );

  const unknownMessageKey = structuredClone(snapshot) as unknown as {
    proposals: { titleMessage?: { key: string } }[];
  };
  unknownMessageKey.proposals[0]!.titleMessage = {
    key: "changes.generated.unknown",
  };
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(unknownMessageKey)),
    PersistedAppStateError,
  );

  const missingMessageValues = structuredClone(snapshot) as unknown as {
    proposals: { titleMessage?: { key: string } }[];
  };
  missingMessageValues.proposals[0]!.titleMessage = {
    key: "changes.generated.manualTitle",
  };
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(missingMessageValues)),
    PersistedAppStateError,
  );

  const duplicateMapping = structuredClone(snapshot);
  duplicateMapping.projectConversations.push({
    ...duplicateMapping.projectConversations[0]!,
  });
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(duplicateMapping)),
    PersistedAppStateError,
  );

  const unknownGlobalMemory = structuredClone(snapshot);
  unknownGlobalMemory.globalMemoryEdits = [
    { memoryId: "unknown-global-memory", text: "不应被接受。" },
  ];
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(unknownGlobalMemory)),
    PersistedAppStateError,
  );

  const wrongSelectedProject = structuredClone(snapshot);
  wrongSelectedProject.selectedProjectId = null;
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(wrongSelectedProject)),
    PersistedAppStateError,
  );

  const wrongProjectMapping = structuredClone(snapshot);
  wrongProjectMapping.projectConversations[0]!.projectId = "support";
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(wrongProjectMapping)),
    PersistedAppStateError,
  );

  const wrongProposalOwner = structuredClone(snapshot);
  wrongProposalOwner.proposals[0]!.projectId = "support";
  assert.throws(
    () => decodePersistedAppState(JSON.stringify(wrongProposalOwner)),
    PersistedAppStateError,
  );
});

test("repository keeps the most recent bounded conversation history", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new PersistedAppStateRepository(store);
  const messages = Array.from({ length: 2_001 }, (_, index) => ({
    id: `message-${index}`,
    role: "user" as const,
    content: `message ${index}`,
  }));

  await repository.save({
    ...initialAppState,
    messages,
    messagesByConversation: {
      ...initialAppState.messagesByConversation,
      "conversation-launch": messages,
    },
  });

  const restored = await repository.load();
  const restoredMessages = restored?.conversations.find(
    (conversation) => conversation.id === "conversation-launch",
  )?.messages;
  assert.equal(restoredMessages?.length, 2_000);
  assert.equal(restoredMessages?.[0]?.id, "message-1");
  assert.equal(restoredMessages?.at(-1)?.id, "message-2000");
});

test("an iOS-style overwrite recovers version four data and drops obsolete output metadata", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new PersistedAppStateRepository(store);
  const bundle = createProjectWithWorkspace({
    id: "upgrade-project",
    name: "覆盖安装保留",
  });
  let legacyState = appReducer(productionInitialAppState, {
    type: "project/created",
    ...bundle,
  });
  legacyState = appReducer(legacyState, {
    type: "chat/new-project",
    projectId: bundle.project.id,
    conversationId: "upgrade-conversation",
  });
  const entry = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "apps/snake/index.html",
    content: "<title>升级前的贪吃蛇</title>",
  });
  const appliedProposal = {
    id: "upgrade-proposal",
    projectId: bundle.project.id,
    conversationId: "upgrade-conversation",
    title: "生成升级测试页面",
    kind: "agent" as const,
    status: "applied" as const,
    connectorId: entry.connectionId,
    connector: "Project workspace",
    createdAt: "2026-08-05T00:00:00.000Z",
    hunks: [
      {
        id: "upgrade-hunk",
        resourceId: entry.id,
        target: entry.path,
        baseVersion: entry.version,
        before: entry.content,
        after: entry.content,
        summary: "保存页面",
        lines: [],
      },
    ],
  };
  legacyState = {
    ...legacyState,
    proposals: { [appliedProposal.id]: appliedProposal },
    resources: { ...legacyState.resources, [entry.id]: entry },
  };
  const currentShape = createPersistedAppState(
    legacyState,
    "2026-08-05T00:01:00.000Z",
  );
  const {
    customGlobalMemories: _customGlobalMemories,
    customGlobalSkills: _customGlobalSkills,
    ...versionFourBase
  } = currentShape;
  const versionFour = {
    ...versionFourBase,
    version: 4,
    projectArtifacts: [
      {
        id: entry.id,
        projectId: bundle.project.id,
        entryResourceId: entry.id,
        resourceIds: [entry.id],
        kind: "web",
        title: "升级前的贪吃蛇",
        addedAt: "2026-08-05T00:01:00.000Z",
        sourceConversationId: "upgrade-conversation",
        sourceProposalId: appliedProposal.id,
      },
    ],
  };
  await store.write("app-state:v1", JSON.stringify(versionFour));
  const postUpgradeMessage = {
    id: "message-created-after-upgrade",
    role: "user" as const,
    content: "这条消息是在第二次安装后发送的。",
  };
  const postUpgradeState = {
    ...productionInitialAppState,
    messages: [postUpgradeMessage],
    messagesByConversation: {
      ...productionInitialAppState.messagesByConversation,
      [productionInitialAppState.activeConversationId]: [postUpgradeMessage],
    },
  };
  await store.write(
    "app-state:v2",
    JSON.stringify(
      createPersistedAppState(postUpgradeState, "2026-08-06T00:00:00.000Z"),
    ),
  );

  const restored = await repository.load();
  assert.equal(restored?.version, 5);
  assert.equal(restored?.projects[0]?.name, "覆盖安装保留");
  assert.ok(
    restored?.conversations.some((conversation) =>
      conversation.messages.some(
        (message) => message.id === postUpgradeMessage.id,
      ),
    ),
  );
  assert.equal(Object.hasOwn(restored ?? {}, "projectArtifacts"), false);
  assert.ok(await store.read("app-state:v1"));
  assert.ok(await store.read("app-state:v2:before-v4-recovery"));
  assert.equal(
    JSON.parse((await store.read("app-state:v2")) ?? "null")?.version,
    5,
  );
  assert.ok(await store.read("app-state:v1:migrated-to-v2"));
  assert.deepEqual(await repository.load(), restored);
});

test("repository never replaces a valid snapshot with an unreadable one", async () => {
  const store = new InMemoryDurableDocumentStore();
  const repository = new PersistedAppStateRepository(store);
  await repository.save(initialAppState, "2026-08-03T09:00:00.000Z");
  const invalidMessage = {
    id: "oversized-message",
    role: "user" as const,
    content: "x".repeat(200_001),
  };

  await assert.rejects(
    repository.save({
      ...initialAppState,
      messages: [invalidMessage],
      messagesByConversation: {
        ...initialAppState.messagesByConversation,
        "conversation-launch": [invalidMessage],
      },
    }),
    PersistedAppStateError,
  );

  const restored = await repository.load();
  assert.equal(restored?.updatedAt, "2026-08-03T09:00:00.000Z");
});
