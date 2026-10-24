import assert from "node:assert/strict";
import test from "node:test";

import { PiAgentRuntime } from "@boltpocket/agent-runtime";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";

import type {
  AgentRunEvent,
  AgentRunInput,
} from "../../application/ports/agent-runtime.ts";
import type { AgentThirdPartyCapabilityPort } from "../../application/ports/third-party-capabilities.ts";
import type { AgentSkillMarketPublicationPort } from "../../application/ports/skill-market-publication.ts";
import type { Project, WorkspaceResource } from "../../domain/models.ts";
import { builtInProjectResourceFile } from "../../domain/builtin-project-resources.ts";
import { builtInSkills } from "../../domain/library-catalog.ts";
import { createProjectWithWorkspace } from "../../domain/project-workspace.ts";
import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

const TOOL_NAMES = [
  "project_context_read",
  "document_create",
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "skill_read",
] as const;

const REMOVED_TOOL_NAMES = [
  "project_resource_read",
  "project_shell",
  "project_propose_text_change",
  "goal_plan_set",
  "task_update",
  "delegate_readonly_task",
] as const;

const project: Project = {
  id: "release-project",
  name: "Release",
  symbol: "R",
  description: "Review a release checklist.",
  instructions: "所有内容修改必须停在文字 Diff，再由宿主检查并自动应用。",
  memoryCount: 1,
  skillCount: 1,
  connectionCount: 1,
  resourceCount: 2,
};

const checklistBefore = [
  "# Release Checklist",
  "",
  "- [ ] Run regression",
  "- [ ] Preserve approval",
  "- [ ] Verify rollback",
  "",
].join("\n");

const checklistAfter = checklistBefore.replace(
  "- [ ] Run regression",
  "- [x] Run regression",
);
const checklistFinal = checklistAfter.replace(
  "- [ ] Verify rollback",
  "- [x] Verify rollback",
);

const resources: WorkspaceResource[] = [
  {
    id: "release-checklist",
    projectId: project.id,
    connectionId: "workspace",
    path: "docs/release-checklist.md",
    content: checklistBefore,
    version: "release-v7",
    storage: { kind: "memory" },
  },
  {
    id: "announcement",
    projectId: project.id,
    connectionId: "workspace",
    path: "marketing/announcement.md",
    content: "Unrelated launch copy.\n",
    version: "marketing-v2",
    storage: { kind: "memory" },
  },
];

function requiredBuiltInSkill(id: string) {
  const skill = builtInSkills.find((candidate) => candidate.id === id);
  if (!skill) throw new Error(`${id} fixture missing`);
  return skill;
}

const installCapabilitiesSkill = requiredBuiltInSkill("install-capabilities");
const publishSkill = requiredBuiltInSkill("publish-skill");
const bootstrapIconsSkill = requiredBuiltInSkill("use-bootstrap-icons");
const kenneyUiSkill = requiredBuiltInSkill("use-kenney-ui");

type ResourceRead = { runId: string; resourceId: string };

function registryForRun(input: AgentRunInput, reads: ResourceRead[]) {
  const scopedResources = input.resources.filter(
    (resource) => resource.projectId === input.project?.id,
  );
  const resourcesById = new Map(
    scopedResources.map((resource) => [resource.id, resource]),
  );
  const refs = scopedResources.map((resource) => ({
    connectorId: resource.connectionId,
    accountId: `project-${resource.projectId}`,
    resourceId: resource.id,
    projectId: resource.projectId,
    kind: "text" as const,
    displayName: resource.path,
    locator: resource.path,
  }));
  return {
    descriptors: () => [
      {
        id: "workspace",
        label: "Project workspace",
        kind: "fixture",
        accountId: `project-${project.id}`,
        accountLabel: project.name,
        status: "connected",
        projectIds: [project.id],
        capabilities: ["list", "read-text"],
      },
    ],
    listResources: async () => refs,
    read: async (ref: (typeof refs)[number]) => {
      reads.push({ runId: input.runId, resourceId: ref.resourceId });
      const resource = resourcesById.get(ref.resourceId);
      if (!resource) throw new Error("integration fixture resource missing");
      return {
        ref,
        mediaType: "text/plain",
        text: resource.content,
        version: resource.version,
        metadata: {},
      };
    },
  } as never;
}

function runInput(runId: string, prompt: string): AgentRunInput {
  return {
    runId,
    conversationId: "conversation-release",
    prompt,
    project,
    memories: [
      {
        id: "release-memory",
        text: "发布修改必须先生成 Diff，再由宿主检查并自动应用。",
        scope: "project",
        source: "fixture",
        projectIds: [project.id],
      },
    ],
    skills: [
      {
        id: "release-safety",
        name: "发布安全核对",
        description: "核对发布变更保留自动版本校验和回滚步骤。",
        content:
          "核对每项发布变更都包含自动版本校验和回滚步骤，并执行写后校验。",
        risk: "read",
        enabled: true,
        scope: "project",
        projectIds: [project.id],
      },
      installCapabilitiesSkill,
      publishSkill,
      bootstrapIconsSkill,
      kenneyUiSkill,
    ],
    resources,
    resourcePacks: [
      {
        id: "bootstrap-icons",
        skillId: "use-bootstrap-icons",
        name: "Bootstrap Icons",
        description: "网页字体图标",
        version: "1.13.1",
        license: "MIT",
        fileCount: 5,
      },
      {
        id: "kenney-1bit",
        skillId: "use-kenney-1bit",
        name: "Kenney 1-Bit Pack",
        description: "16px 游戏精灵表与示例地图",
        version: "1.2",
        license: "CC0-1.0",
        fileCount: 17,
      },
    ],
    attachments: [],
  };
}

function toolResponse(
  id: string,
  name: string,
  arguments_: Record<string, unknown>,
) {
  return fauxAssistantMessage(fauxToolCall(name, arguments_, { id }), {
    stopReason: "toolUse",
  });
}

function textContent(result: ToolResultMessage) {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function lastUserText(context: Context) {
  const message = [...context.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");
  assert.ok(message && message.role === "user");
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
}

function afterTool(
  expectedTool: string,
  next: ReturnType<typeof fauxAssistantMessage>,
  inspect?: (result: ToolResultMessage, content: string) => void,
) {
  return (context: Context) => {
    const result = context.messages.at(-1);
    assert.ok(result && result.role === "toolResult");
    assert.equal(result.toolName, expectedTool);
    assert.equal(result.isError, false);
    inspect?.(result, textContent(result));
    return next;
  };
}

function startedLabels(events: AgentRunEvent[]) {
  return events.flatMap((event) =>
    event.type === "tool-started" ? [event.label] : [],
  );
}

test("third-party capability tools preserve assessment and confirmation bindings across runs", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const assessmentCalls: Parameters<
    AgentThirdPartyCapabilityPort["assess"]
  >[0][] = [];
  const installCalls: Parameters<
    AgentThirdPartyCapabilityPort["install"]
  >[0][] = [];
  const thirdPartyCapabilities: AgentThirdPartyCapabilityPort = {
    hasAssessmentAwaitingConfirmation: () => assessmentCalls.length > 0,
    assess: async (input) => {
      assessmentCalls.push(input);
      return {
        assessmentId: "assessment-fixture",
        reportFormat: "boltpocket-capability-diagnostic/v1",
        kind: "skill",
        name: "Release check",
        sourceUrl: input.url,
        fingerprint: "a".repeat(64),
        projectId: input.projectId,
        status: "compatible",
        installable: true,
        checks: [
          {
            id: "skill-document",
            label: "Skill document is valid",
            status: "pass",
          },
        ],
        risks: [
          {
            id: "untrusted-instructions",
            label: "Third-party instructions are untrusted",
            severity: "high",
          },
        ],
        runtime: {
          bundleInstallation: "complete-or-reject",
          inspection: "static-document-analysis",
          instructionsExecuted: false,
          javascript: {
            engine: "quickjs",
            maxCodeBytes: 64 * 1024,
            maxExecutionMs: 5_000,
            maxFiles: 8,
            maxInputBytes: 240 * 1024,
            maxMemoryBytes: 16 * 1024 * 1024,
            maxOutputBytes: 128 * 1024,
            mode: "bounded-read-only",
            modules: false,
            network: false,
            persistence: false,
            projectFiles: "explicit-read-only",
            tool: "js_exec",
            writes: false,
          },
          kind: "skill",
          maxBundleBytes: 2 * 1024 * 1024,
          maxBundleFiles: 256,
          supportingFilesInstalled: true,
          unsupportedRuntimes: ["node", "python"],
        },
        plannedInstall: { target: "project-skills", enabled: true },
        expiresAt: "2026-08-15T12:30:00.000Z",
        confirmationRequired: true,
        nextStep: "Explain the report, stop, and ask for confirmation.",
      };
    },
    install: async (input) => {
      installCalls.push(input);
      return {
        assessmentId: input.assessmentId,
        enabled: true,
        installed: true,
        itemId: "release-check",
        kind: "skill",
        list: "project-skills",
        name: "Release check",
        receiptId: "receipt-fixture",
        updateTracking: "saved",
      };
    },
  };

  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some(
          (tool) => tool.name === "third_party_capability_assess",
        ),
        false,
      );
      assert.equal(
        context.tools?.some(
          (tool) => tool.name === "third_party_capability_install",
        ),
        false,
      );
      return toolResponse("capability-skill", "skill_read", {
        name: "install-capabilities",
      });
    },
    (context) => {
      assert.equal(
        context.tools?.some(
          (tool) => tool.name === "third_party_capability_assess",
        ),
        true,
      );
      assert.equal(
        context.tools?.some(
          (tool) => tool.name === "third_party_capability_install",
        ),
        true,
      );
      return toolResponse(
        "capability-assess",
        "third_party_capability_assess",
        {
          kind: "skill",
          url: "https://example.com/SKILL.md",
        },
      );
    },
    afterTool(
      "third_party_capability_assess",
      fauxAssistantMessage("体检完成。是否确认安装？"),
      (_result, content) => {
        const report = JSON.parse(content) as { assessmentId: string };
        assert.equal(report.assessmentId, "assessment-fixture");
      },
    ),
  ]);

  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: (input) => registryForRun(input, []),
    projectShellJavaScriptRuntime: null,
    thirdPartyCapabilities,
  });

  try {
    await runtime.run(
      runInput("run-assess", "安装 https://example.com/SKILL.md"),
      new AbortController().signal,
    );
    assert.deepEqual(assessmentCalls, [
      {
        kind: "skill",
        url: "https://example.com/SKILL.md",
        conversationId: "conversation-release",
        projectId: project.id,
        projectName: project.name,
        runId: "run-assess",
      },
    ]);
    assert.deepEqual(installCalls, []);

    faux.appendResponses([
      (context) => {
        assert.equal(
          context.tools?.some(
            (tool) => tool.name === "third_party_capability_assess",
          ),
          true,
        );
        assert.equal(
          context.tools?.some(
            (tool) => tool.name === "third_party_capability_install",
          ),
          true,
        );
        return toolResponse(
          "capability-install",
          "third_party_capability_install",
          {
            assessmentId: "assessment-fixture",
          },
        );
      },
      afterTool(
        "third_party_capability_install",
        fauxAssistantMessage("安装成功，已出现在项目 Skills 列表。"),
        (_result, content) => {
          const installed = JSON.parse(content) as { list: string };
          assert.equal(installed.list, "project-skills");
        },
      ),
    ]);
    await runtime.run(
      runInput("run-install", "确认安装"),
      new AbortController().signal,
    );
    assert.deepEqual(installCalls, [
      {
        assessmentId: "assessment-fixture",
        conversationId: "conversation-release",
        latestUserPrompt: "确认安装",
        projectId: project.id,
        runId: "run-install",
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});

test("publish-skill gates redacted review and hash-bound publication tools", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const reviewCalls: Parameters<
    AgentSkillMarketPublicationPort["review"]
  >[0][] = [];
  const publishCalls: Parameters<
    AgentSkillMarketPublicationPort["publish"]
  >[0][] = [];
  const review = {
    documentSha256: "a".repeat(64),
    findings: [],
    readmeSha256: "b".repeat(64),
    reviewHash: "c".repeat(64),
    status: "pass" as const,
  };
  const skillMarketPublication: AgentSkillMarketPublicationPort = {
    hasReviewAwaitingPublication: () =>
      reviewCalls.length > publishCalls.length,
    review: async (input) => {
      reviewCalls.push(input);
      return review;
    },
    publish: async (input) => {
      publishCalls.push(input);
      return {
        entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
        patch: {
          sha256: "d".repeat(64),
          text: "publication patch",
        },
        receipt: {
          id: "7b50ba33-e340-4acd-856c-c921e3608002",
          recoveryAvailable: true,
        },
        review,
        revision: "1-aabbccddeeff",
      };
    },
  };

  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "skill_market_review"),
        false,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "skill_market_publish"),
        false,
      );
      return toolResponse("publish-skill-read", "skill_read", {
        name: "publish-skill",
      });
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "skill_market_review"),
        true,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "skill_market_publish"),
        true,
      );
      return toolResponse("market-review", "skill_market_review", {
        skillId: "release-safety",
      });
    },
    afterTool(
      "skill_market_review",
      fauxAssistantMessage("审核通过，可以发布。"),
      (_result, content) => {
        const report = JSON.parse(content) as { reviewHash: string };
        assert.equal(report.reviewHash, review.reviewHash);
      },
    ),
  ]);

  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    projectShellJavaScriptRuntime: null,
    registryFactory: (input) => registryForRun(input, []),
    skillMarketPublication,
  });
  try {
    await runtime.run(
      runInput("run-review-skill", "请审核 release-safety Skill"),
      new AbortController().signal,
    );
    assert.deepEqual(reviewCalls, [
      {
        conversationId: "conversation-release",
        projectId: project.id,
        runId: "run-review-skill",
        skillId: "release-safety",
      },
    ]);
    assert.deepEqual(publishCalls, []);

    faux.appendResponses([
      (context) => {
        assert.equal(
          context.tools?.some((tool) => tool.name === "skill_market_review"),
          true,
        );
        assert.equal(
          context.tools?.some((tool) => tool.name === "skill_market_publish"),
          true,
        );
        return toolResponse("market-publish", "skill_market_publish", {
          category: "operations",
          license: "MIT",
          publisherName: "BoltPocket Creator",
          reviewHash: review.reviewHash,
          skillId: "release-safety",
          tags: ["release", "safety"],
        });
      },
      afterTool(
        "skill_market_publish",
        fauxAssistantMessage("已发布，并保留发布回执。"),
        (_result, content) => {
          const result = JSON.parse(content) as { revision: string };
          assert.equal(result.revision, "1-aabbccddeeff");
        },
      ),
    ]);
    await runtime.run(
      runInput("run-publish-skill", "发布吧"),
      new AbortController().signal,
    );
    assert.deepEqual(publishCalls, [
      {
        category: "operations",
        conversationId: "conversation-release",
        latestUserPrompt: "发布吧",
        license: "MIT",
        projectId: project.id,
        publisherName: "BoltPocket Creator",
        reviewHash: review.reviewHash,
        runId: "run-publish-skill",
        skillId: "release-safety",
        tags: ["release", "safety"],
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});

const fixtureProjectResourceFiles = {
  async readBase64(
    packId: "bootstrap-icons" | "kenney-ui" | "kenney-1bit",
    path: string,
  ) {
    const descriptor = builtInProjectResourceFile(packId, path);
    if (!descriptor) throw new Error("fixture resource missing");
    return Buffer.alloc(descriptor.byteLength).toString("base64");
  },
};

test("scripted Faux acceptance covers every supported mobile tool and no removed tool", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  const reads: ResourceRead[] = [];
  const inspectEvents: AgentRunEvent[] = [];
  const proposalEvents: AgentRunEvent[] = [];
  const resourcesBefore = structuredClone(resources);

  faux.setResponses([
    (context) => {
      assert.equal(lastUserText(context), "检查发布约束，不要修改内容。");
      assert.deepEqual(
        context.tools?.map((tool) => tool.name),
        [...TOOL_NAMES],
      );
      const bashTool = context.tools?.find((tool) => tool.name === "bash");
      const readTool = context.tools?.find((tool) => tool.name === "read");
      assert.match(
        readTool?.description ?? "",
        /continuation notice is normal pagination/u,
      );
      assert.match(
        bashTool?.description ?? "",
        /does not expose a temporary output file/u,
      );
      assert.doesNotMatch(
        bashTool?.description ?? "",
        /full output is saved to a temp file/u,
      );
      for (const removed of REMOVED_TOOL_NAMES) {
        assert.doesNotMatch(context.systemPrompt ?? "", new RegExp(removed));
        assert.equal(
          context.tools?.some((tool) => tool.name === removed),
          false,
        );
      }
      assert.match(context.systemPrompt ?? "", /<available_skills>/u);
      assert.match(
        context.systemPrompt ?? "",
        /follow its next offset automatically/u,
      );
      return toolResponse("inspect-context", "project_context_read", {});
    },
    afterTool(
      "project_context_read",
      toolResponse("inspect-skill", "skill_read", {
        name: "release-safety",
      }),
      (_result, content) => {
        const value = JSON.parse(content) as {
          run: { runId: string; mode?: unknown };
          resources: { id: string }[];
          resourcePacks: { id: string; skillId: string }[];
        };
        assert.deepEqual(value.run, { runId: "inspect-run" });
        assert.deepEqual(
          value.resources.map((resource) => resource.id),
          ["release-checklist", "announcement"],
        );
        assert.deepEqual(
          value.resourcePacks.map((pack) => [pack.id, pack.skillId]),
          [
            ["bootstrap-icons", "use-bootstrap-icons"],
            ["kenney-1bit", "use-kenney-1bit"],
          ],
        );
      },
    ),
    afterTool(
      "skill_read",
      toolResponse("inspect-resource-skill", "skill_read", {
        name: "use-bootstrap-icons",
      }),
      (_result, content) => assert.match(content, /自动版本校验和回滚/u),
    ),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.toolName, "skill_read");
      assert.equal(result.isError, false);
      assert.match(textContent(result), /Bootstrap Icons/u);
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_catalog"),
        true,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_copy"),
        true,
      );
      return toolResponse("inspect-resource", "project_resource_catalog", {
        action: "search",
        packId: "bootstrap-icons",
        query: "qr-code",
        limit: 3,
      });
    },
    afterTool(
      "project_resource_catalog",
      toolResponse("inspect-ls", "ls", { path: "/project" }),
      (_result, content) => {
        assert.match(content, /use-bootstrap-icons/u);
        assert.match(content, /bi bi-qr-code/u);
      },
    ),
    afterTool(
      "ls",
      toolResponse("inspect-find", "find", {
        pattern: "*.md",
        path: "/project/workspace",
      }),
      (_result, content) => assert.match(content, /workspace\//u),
    ),
    afterTool(
      "find",
      toolResponse("inspect-grep", "grep", {
        pattern: "Preserve approval|Verify rollback",
        path: "/project/workspace/docs",
      }),
      (_result, content) => {
        assert.match(content, /docs\/release-checklist\.md/u);
        assert.match(content, /marketing\/announcement\.md/u);
      },
    ),
    afterTool(
      "grep",
      toolResponse("inspect-read", "read", {
        path: "/project/workspace/docs/release-checklist.md",
      }),
      (_result, content) => {
        assert.match(content, /Preserve approval/u);
        assert.match(content, /Verify rollback/u);
      },
    ),
    afterTool(
      "read",
      toolResponse("inspect-bash", "bash", {
        command:
          "grep -n 'Preserve approval\\|Verify rollback' /project/workspace/docs/release-checklist.md",
      }),
      (_result, content) => assert.match(content, /Release Checklist/u),
    ),
    afterTool(
      "bash",
      fauxAssistantMessage("版本校验与回滚项都存在，未创建修改提案。"),
      (_result, content) => {
        assert.match(content, /Preserve approval/u);
        assert.match(content, /Verify rollback/u);
      },
    ),
  ]);

  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: (input) => registryForRun(input, reads),
    projectShellJavaScriptRuntime: null,
    projectResourceFiles: fixtureProjectResourceFiles,
  });

  try {
    const inspected = await runtime.run(
      runInput("inspect-run", "检查发布约束，不要修改内容。"),
      new AbortController().signal,
      (event) => inspectEvents.push(event),
    );
    assert.equal(inspected.proposal, undefined);
    assert.deepEqual(startedLabels(inspectEvents), [
      "读取项目上下文",
      "读取 Skill：release-safety",
      "读取 Skill：use-bootstrap-icons",
      "查找项目内置资源",
      "列出：/project",
      "查找：*.md · /project/workspace",
      "搜索：Preserve approval|Verify rollback · /project/workspace/docs",
      "读取：/project/workspace/docs/release-checklist.md",
      "运行：grep -n 'Preserve approval\\|Verify rollback' /project/workspace/docs/release-checklist.md",
    ]);
    assert.equal(
      reads.some((read) => read.resourceId === "announcement"),
      true,
    );
    assert.deepEqual(resources, resourcesBefore);

    faux.appendResponses([
      toolResponse("proposal-context", "project_context_read", {}),
      afterTool(
        "project_context_read",
        toolResponse("proposal-read", "read", {
          path: "/project/workspace/docs/release-checklist.md",
        }),
      ),
      afterTool(
        "read",
        toolResponse("proposal-edit", "edit", {
          path: "/project/workspace/docs/release-checklist.md",
          oldText: "- [ ] Run regression",
          newText: "- [x] Run regression",
        }),
        (_result, content) => assert.match(content, /Run regression/u),
      ),
      afterTool(
        "edit",
        toolResponse("proposal-read-staged", "read", {
          path: "/project/workspace/docs/release-checklist.md",
        }),
        (result) => {
          const details = result.details as { patch?: string } | undefined;
          assert.match(details?.patch ?? "", /Run regression/u);
        },
      ),
      afterTool(
        "read",
        toolResponse("proposal-write", "write", {
          path: "/project/workspace/docs/release-checklist.md",
          content: checklistFinal,
        }),
        (_result, content) => assert.match(content, /\[x\] Run regression/u),
      ),
      afterTool(
        "write",
        fauxAssistantMessage("Diff 已生成，等待宿主处理。"),
        (_result, content) => assert.match(content, /Successfully wrote/u),
      ),
    ]);

    const proposed = await runtime.run(
      runInput("proposal-run", "把全量回归标记完成，只生成 Diff。"),
      new AbortController().signal,
      (event) => proposalEvents.push(event),
    );
    assert.equal(proposed.proposal?.hunks.length, 1);
    assert.equal(proposed.proposal?.hunks[0]?.before, checklistBefore);
    assert.equal(proposed.proposal?.hunks[0]?.after, checklistFinal);
    assert.deepEqual(startedLabels(proposalEvents), [
      "读取项目上下文",
      "读取：/project/workspace/docs/release-checklist.md",
      "编辑：/project/workspace/docs/release-checklist.md · 1 处",
      "读取：/project/workspace/docs/release-checklist.md",
      "写入：/project/workspace/docs/release-checklist.md",
    ]);
    assert.deepEqual(resources, resourcesBefore);

    faux.appendResponses([
      toolResponse("removed-call", "goal_plan_set", {
        goal: "不应存在",
        tasks: [],
      }),
      (context) => {
        const result = context.messages.at(-1);
        assert.ok(result && result.role === "toolResult");
        assert.equal(result.toolName, "goal_plan_set");
        assert.equal(result.isError, true);
        assert.match(textContent(result), /not found|unknown tool/iu);
        return fauxAssistantMessage("该自建工具不可用。", {
          stopReason: "stop",
        });
      },
    ]);
    const removed = await runtime.run(
      runInput("removed-run", "调用旧的计划工具。"),
      new AbortController().signal,
    );
    assert.equal(removed.proposal, undefined);
    assert.equal(removed.content, "该自建工具不可用。");
  } finally {
    await runtime.dispose();
  }
});

test("Agent can copy a catalog asset into the project and immediately see it with ls", async () => {
  const bundle = createProjectWithWorkspace({
    id: project.id,
    name: project.name,
  });
  const input: AgentRunInput = {
    ...runInput("resource-copy-run", "给 H5 复制一个向右箭头素材。"),
    resources: bundle.resources,
    resourcePacks: [
      {
        id: "kenney-ui",
        skillId: "use-kenney-ui",
        name: "Kenney UI",
        description: "游戏 UI",
        version: "2.0",
        license: "CC0-1.0",
        fileCount: 110,
      },
    ],
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    toolResponse("copy-context", "project_context_read", {}),
    afterTool(
      "project_context_read",
      toolResponse("copy-resource-skill", "skill_read", {
        name: "use-kenney-ui",
      }),
    ),
    afterTool(
      "skill_read",
      toolResponse("copy-search", "project_resource_catalog", {
        action: "search",
        packId: "kenney-ui",
        query: "arrow_basic_e_small",
      }),
    ),
    afterTool(
      "project_resource_catalog",
      toolResponse("copy-file", "project_resource_copy", {
        appRoot: "/project/apps/demo",
        packId: "kenney-ui",
        paths: ["png/blue/arrow_basic_e_small.png"],
      }),
      (_result, content) => {
        assert.match(content, /copyRequired/u);
        assert.match(content, /assets\/vendor\/kenney-ui/u);
      },
    ),
    afterTool(
      "project_resource_copy",
      toolResponse("copy-ls", "ls", {
        path: "/project/apps/demo/assets/vendor/kenney-ui/png/blue",
      }),
      (_result, content) => {
        assert.match(content, /arrow_basic_e_small\.png/u);
        assert.match(content, /projectPath/u);
      },
    ),
    afterTool(
      "ls",
      fauxAssistantMessage("资源已复制到项目目录，可直接使用相对路径引用。"),
      (_result, content) => assert.match(content, /arrow_basic_e_small\.png/u),
    ),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: (run) => registryForRun(run, []),
    projectShellJavaScriptRuntime: null,
    projectResourceFiles: fixtureProjectResourceFiles,
  });

  try {
    const output = await runtime.run(input, new AbortController().signal);
    assert.equal(output.proposal?.hunks.length, 1);
    const hunk = output.proposal?.hunks[0];
    assert.equal(
      hunk?.target,
      "apps/demo/assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png",
    );
    assert.equal(hunk?.operation, "create");
    assert.equal(hunk?.binaryFile?.source.kind, "builtin-h5-resource");
    assert.equal(
      hunk?.binaryFile?.source.kind === "builtin-h5-resource"
        ? hunk.binaryFile.source.packId
        : undefined,
      "kenney-ui",
    );
    assert.match(hunk?.lines.at(-1)?.text ?? "", /image\/png/u);
  } finally {
    await runtime.dispose();
  }
});

test("one source-analysis task reads a generic snapshot and proposes only the Markdown report", async () => {
  const sourceProject: Project = {
    id: "source-analysis-project",
    name: "Source analysis",
    symbol: "S",
    description: "Analyze a project source snapshot.",
    instructions: "来源快照只读；结论写入现有 Markdown 报告并交给宿主处理。",
    memoryCount: 0,
    skillCount: 0,
    connectionCount: 2,
    resourceCount: 4,
  };
  const revision = "a".repeat(40);
  const sourceStorage = {
    kind: "source-file" as const,
    locator: "fixture://source",
    snapshotId: "snapshot-fixture",
    sourceKind: "github-public" as const,
    sourceLabel: "Example/Fixture",
    mountPath: "Example/Fixture",
    revision,
    versionLabel: "main@aaaaaaaaaaaa",
    manifestPath: ".boltpocket-source-aaaaaaaaaaaa.md",
    access: "persistent" as const,
  };
  const authoritativeContent = new Map<string, string>([
    [
      "source-readme",
      "# Fixture\n\nThis project exposes an analyze function.\n",
    ],
    [
      "source-analyzer",
      "export function analyze(value: string) {\n  return value.trim();\n}\n",
    ],
    [
      "source-manifest",
      "# BoltPocket Source Snapshot\n\nThis source is read-only.\n",
    ],
    ["source-report", "# Fixture 分析报告\n\n等待分析。\n"],
  ]);
  const sourceResources: WorkspaceResource[] = [
    {
      id: "source-readme",
      projectId: sourceProject.id,
      connectionId: "source-fixture",
      path: "Example/Fixture/README.md",
      content: "",
      version: "readme-v1",
      storage: { ...sourceStorage, locator: "fixture://source/readme" },
    },
    {
      id: "source-analyzer",
      projectId: sourceProject.id,
      connectionId: "source-fixture",
      path: "Example/Fixture/src/analyzer.ts",
      content: "",
      version: "analyzer-v1",
      storage: { ...sourceStorage, locator: "fixture://source/analyzer" },
    },
    {
      id: "source-manifest",
      projectId: sourceProject.id,
      connectionId: "source-fixture",
      path: "Example/Fixture/.boltpocket-source-aaaaaaaaaaaa.md",
      content: "",
      version: "manifest-v1",
      storage: { ...sourceStorage, locator: "fixture://source/manifest" },
    },
    {
      id: "source-report",
      projectId: sourceProject.id,
      connectionId: "source-reports",
      path: "reports/Example-Fixture-analysis.md",
      content: authoritativeContent.get("source-report")!,
      version: "report-v1",
      storage: { kind: "memory" },
    },
  ];
  const reads: string[] = [];
  const refs = sourceResources.map((resource) => ({
    connectorId: resource.connectionId,
    accountId: `project-${resource.projectId}`,
    resourceId: resource.id,
    projectId: resource.projectId,
    kind: "text" as const,
    displayName: resource.path,
    locator: resource.path,
  }));
  const registry = {
    descriptors: () => [
      {
        id: "source-fixture",
        label: "Project Source Snapshot",
        kind: "source",
        accountId: "fixture-source",
        accountLabel: "Example/Fixture",
        status: "connected",
        projectIds: [sourceProject.id],
        capabilities: ["list", "read-text"],
      },
      {
        id: "source-reports",
        label: "Project reports",
        kind: "fixture",
        accountId: "fixture-reports",
        accountLabel: "reports",
        status: "connected",
        projectIds: [sourceProject.id],
        capabilities: ["list", "read-text"],
      },
    ],
    listResources: async () => refs,
    read: async (ref: (typeof refs)[number]) => {
      reads.push(ref.resourceId);
      const resource = sourceResources.find(
        (candidate) => candidate.id === ref.resourceId,
      );
      assert.ok(resource);
      return {
        ref,
        mediaType: "text/plain",
        text: authoritativeContent.get(resource.id)!,
        version: resource.version,
        metadata: {},
      };
    },
  } as never;
  const reportAfter = [
    "# Fixture 分析报告",
    "",
    "## 结论",
    "",
    "`analyze` 会对字符串执行 `trim()`。",
    "",
  ].join("\n");
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    toolResponse("source-context", "project_context_read", {}),
    afterTool(
      "project_context_read",
      toolResponse("source-ls", "ls", {
        path: "/project/source-fixture/Example/Fixture",
      }),
      (_result, content) => {
        const value = JSON.parse(content) as {
          sourceTrees: {
            sourceKind: string;
            sourceLabel: string;
            shellPath: string;
            fileCount: number;
            readOnly: boolean;
          }[];
          resources: { id: string }[];
        };
        assert.deepEqual(value.sourceTrees, [
          {
            connectorId: "source-fixture",
            sourceKind: "github-public",
            sourceLabel: "Example/Fixture",
            mountPath: "Example/Fixture",
            revision,
            versionLabel: "main@aaaaaaaaaaaa",
            manifestPath: ".boltpocket-source-aaaaaaaaaaaa.md",
            fileCount: 3,
            shellPath: "/project/source-fixture/Example/Fixture",
            manifestShellPath:
              "/project/source-fixture/Example/Fixture/.boltpocket-source-aaaaaaaaaaaa.md",
            readOnly: true,
          },
        ]);
        assert.deepEqual(
          value.resources.map((item) => item.id),
          ["source-report"],
        );
      },
    ),
    afterTool(
      "ls",
      toolResponse("source-find", "find", {
        pattern: "*.ts",
        path: "/project/source-fixture/Example/Fixture",
      }),
      (_result, content) => assert.match(content, /src\//u),
    ),
    afterTool(
      "find",
      toolResponse("source-grep", "grep", {
        pattern: "function analyze",
        path: "/project/source-fixture/Example/Fixture",
      }),
      (_result, content) => assert.match(content, /analyzer\.ts/u),
    ),
    afterTool(
      "grep",
      toolResponse("source-read", "read", {
        path: "/project/source-fixture/Example/Fixture/README.md",
      }),
      (_result, content) => assert.match(content, /function analyze/u),
    ),
    afterTool(
      "read",
      toolResponse("source-bash", "bash", {
        command:
          "grep -n 'return value.trim' /project/source-fixture/Example/Fixture/src/analyzer.ts",
      }),
      (_result, content) => assert.match(content, /Fixture/u),
    ),
    afterTool(
      "bash",
      toolResponse("source-edit-denied", "edit", {
        path: "/project/source-fixture/Example/Fixture/src/analyzer.ts",
        oldText: "return value.trim();",
        newText: "return value;",
      }),
      (_result, content) => assert.match(content, /value\.trim/u),
    ),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.toolName, "edit");
      assert.equal(result.isError, true);
      assert.match(textContent(result), /read-only|只读/iu);
      return toolResponse("source-report-read", "read", {
        path: "/project/source-reports/reports/Example-Fixture-analysis.md",
      });
    },
    afterTool(
      "read",
      toolResponse("source-report-write", "write", {
        path: "/project/source-reports/reports/Example-Fixture-analysis.md",
        content: reportAfter,
      }),
      (_result, content) => assert.match(content, /等待分析/u),
    ),
    afterTool(
      "write",
      fauxAssistantMessage("已分析来源并生成报告 Diff，等待宿主处理。"),
      (_result, content) => assert.match(content, /Successfully wrote/u),
    ),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registry,
    projectShellJavaScriptRuntime: null,
  });

  try {
    const output = await runtime.run(
      {
        runId: "source-analysis-run",
        conversationId: "source-analysis-conversation",
        prompt: "分析这个来源，写入现有 Markdown 报告；不要改来源。",
        project: sourceProject,
        memories: [],
        skills: [],
        resources: sourceResources,
        attachments: [],
      },
      new AbortController().signal,
    );

    assert.equal(output.proposal?.hunks.length, 1);
    assert.equal(output.proposal?.hunks[0]?.resourceId, "source-report");
    assert.equal(
      output.proposal?.hunks[0]?.before,
      authoritativeContent.get("source-report"),
    );
    assert.equal(output.proposal?.hunks[0]?.after, reportAfter);
    assert.equal(reads.includes("source-analyzer"), true);
    assert.deepEqual(
      sourceResources.slice(0, 3).map((resource) => resource.content),
      ["", "", ""],
    );
  } finally {
    await runtime.dispose();
  }
});
