import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { McpRemoteClient, McpRemoteTool } from "@boltpocket/mcp-client";

import type { SkillCapability } from "@/application/ports/capability-catalog";
import { isExplicitCapabilityInstallConfirmation } from "@/application/capability-install-confirmation";
import { skillBundleFingerprintInput } from "@/application/skill-bundle";
import type {
  McpConnection,
  McpConnectionInput,
} from "@/application/ports/mcp-connections";
import { ThirdPartyCapabilityService } from "./third-party-capability-service.ts";

const skillDocument = [
  "---",
  "name: release-check",
  'title: "Release check"',
  'description: "Verify a release before publishing."',
  "risk: read",
  "---",
  "",
  "# Steps",
  "",
  "Verify the project.",
  "",
].join("\n");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function skillCapability(
  source: SkillCapability["source"] = {
    entryId: "owner/repo/release-check",
    id: "skills-sh",
    kind: "skills-sh",
    name: "Skills.sh",
  },
): SkillCapability {
  const skillFile = {
    byteLength: new TextEncoder().encode(skillDocument).byteLength,
    content: skillDocument,
    encoding: "utf8" as const,
    executable: false,
    mimeType: "text/markdown",
    path: "SKILL.md",
    sha256: sha256(skillDocument),
  };
  return {
    bundle: {
      complete: true,
      files: [skillFile],
      sha256: sha256(skillBundleFingerprintInput([skillFile])),
      totalBytes: skillFile.byteLength,
    },
    description: { en: "Verify a release.", zhCN: "检查发布。" },
    documentationUrl: "https://skills.sh/owner/repo/release-check",
    id: "release-check",
    kind: "skill",
    name: { en: "Release check", zhCN: "发布检查" },
    provider: { en: "owner/repo", zhCN: "owner/repo" },
    requirements: [],
    revision: sha256(skillDocument),
    risk: "read",
    sha256: sha256(skillDocument),
    skillDocument,
    source,
  };
}

function remoteClient(
  tools: readonly McpRemoteTool[],
  onCallTool: () => void = () => undefined,
): McpRemoteClient {
  return {
    serverInfo: () => ({
      protocolVersion: "2025-06-18",
      serverVersion: { name: "fixture", version: "1.2.3" },
    }),
    setToolsChangedHandler: () => undefined,
    listTools: async () => tools,
    callTool: async () => {
      onCallTool();
      return {};
    },
    ping: async () => ({ ok: true }),
    listPrompts: async () => [],
    getPrompt: async () => ({}),
    listResources: async () => [],
    listResourceTemplates: async () => [],
    readResource: async () => ({}),
    complete: async () => ({}),
    close: async () => undefined,
  };
}

type Dependencies = ConstructorParameters<
  typeof ThirdPartyCapabilityService
>[0];

function fixture(overrides: Partial<Dependencies> = {}) {
  const connections: McpConnection[] = [];
  const createdInputs: McpConnectionInput[] = [];
  const installedSkills: {
    capability: SkillCapability;
    projectId: string;
  }[] = [];
  let assessmentSequence = 0;
  const dependencies: Dependencies = {
    authorizeMcpOAuth: async () => ({ authorizationId: "oauth-one" }),
    connectMcp: async () => remoteClient([]),
    createAssessmentId: () => `assessment-${++assessmentSequence}`,
    createMcpConnection: async (input) => {
      createdInputs.push(input);
      const timestamp = "2026-08-15T12:00:00.000Z";
      const connection: McpConnection = {
        ...input,
        id: `mcp-${connections.length + 1}`,
        projectId: input.projectId,
        trustToolAnnotations: input.trustToolAnnotations ?? false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      connections.push(connection);
      return connection;
    },
    digest: async (value) => sha256(value),
    disconnectMcpOAuth: async () => undefined,
    installSkill: async (capability, projectId) => {
      installedSkills.push({ capability, projectId });
      return { receiptId: "receipt-one", updateTracking: "saved" };
    },
    listMcpConnections: async () => connections,
    locale: "zh-CN",
    probeMcpConnection: async () => ({ ok: true }),
    removeMcpConnection: async (connectionId) => {
      const index = connections.findIndex(
        (connection) => connection.id === connectionId,
      );
      if (index >= 0) connections.splice(index, 1);
    },
    resolveSkill: async () => skillCapability(),
    skillAssessment: () => ({
      status: "full",
      checks: [
        {
          available: true,
          id: "skill-document",
          kind: "document",
          label: "Skill 文档结构",
          required: true,
        },
      ],
    }),
    skillExists: () => false,
    ...overrides,
  };
  return {
    connections,
    createdInputs,
    installedSkills,
    subject: new ThirdPartyCapabilityService(dependencies),
  };
}

const skillAssessmentInput = {
  conversationId: "conversation-one",
  kind: "skill" as const,
  projectId: "project-one",
  projectName: "Project One",
  runId: "run-assess",
  url: "https://skills.sh/owner/repo/release-check",
};

test("explicit install confirmation accepts affirmative text and rejects cancellation", () => {
  for (const value of [
    "确认",
    "安装",
    "可以安装",
    "请安装到项目吧",
    "yes",
    "Go ahead",
    "I confirm, install this",
  ]) {
    assert.equal(isExplicitCapabilityInstallConfirmation(value), true, value);
  }
  for (const value of [
    "",
    "体检结果怎么样？",
    "不要安装",
    "取消",
    "Do not install this",
  ]) {
    assert.equal(isExplicitCapabilityInstallConfirmation(value), false, value);
  }
});

test("Skill installation is bound to a prior report and a later explicit confirmation", async () => {
  const { installedSkills, subject } = fixture();
  const report = await subject.assess(skillAssessmentInput);

  assert.equal(report.status, "compatible");
  assert.equal(report.installable, true);
  assert.equal(report.fingerprint, skillCapability().bundle.sha256);
  assert.equal(report.reportFormat, "boltpocket-capability-diagnostic/v1");
  assert.deepEqual(report.runtime, {
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
  });
  assert.deepEqual(report.package, {
    binaryFileCount: 0,
    complete: true,
    executableFileCount: 0,
    fileCount: 1,
    sha256: skillCapability().bundle.sha256,
    textFileCount: 1,
    totalBytes: new TextEncoder().encode(skillDocument).byteLength,
  });
  assert.deepEqual(report.plannedInstall, {
    target: "project-skills",
    enabled: true,
  });

  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "确认安装",
        projectId: skillAssessmentInput.projectId,
        runId: skillAssessmentInput.runId,
      }),
    /必须分成两轮/u,
  );
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "不要安装",
        projectId: skillAssessmentInput.projectId,
        runId: "run-cancel",
      }),
    /没有明确确认/u,
  );
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: "another-conversation",
        latestUserPrompt: "确认",
        projectId: skillAssessmentInput.projectId,
        runId: "run-wrong-conversation",
      }),
    /不属于当前项目对话/u,
  );

  const result = await subject.install({
    assessmentId: report.assessmentId,
    conversationId: skillAssessmentInput.conversationId,
    latestUserPrompt: "确认安装",
    projectId: skillAssessmentInput.projectId,
    runId: "run-install",
  });
  assert.deepEqual(result, {
    assessmentId: report.assessmentId,
    enabled: true,
    installed: true,
    itemId: "release-check",
    kind: "skill",
    list: "project-skills",
    name: "发布检查",
    receiptId: "receipt-one",
    updateTracking: "saved",
  });
  assert.equal(installedSkills.length, 1);
  assert.equal(installedSkills[0]?.projectId, "project-one");
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "确认",
        projectId: skillAssessmentInput.projectId,
        runId: "run-replay",
      }),
    /不存在或已过期/u,
  );
});

test("a limited third-party Skill installs disabled but still appears in the project list", async () => {
  const capability = skillCapability({
    entryId: "release-check",
    id: "direct-url",
    kind: "catalog-json",
    name: "URL",
  });
  const { subject } = fixture({
    resolveSkill: async () => capability,
    skillAssessment: () => ({
      status: "partial",
      checks: [
        {
          available: false,
          id: "direct-url-review",
          kind: "source-trust",
          label: "来源未经独立核验",
          required: true,
        },
      ],
    }),
  });
  const report = await subject.assess(skillAssessmentInput);
  assert.equal(report.status, "limited");
  assert.equal(report.installable, true);
  assert.equal(report.plannedInstall.enabled, false);

  const result = await subject.install({
    assessmentId: report.assessmentId,
    conversationId: skillAssessmentInput.conversationId,
    latestUserPrompt: "可以，安装吧",
    projectId: skillAssessmentInput.projectId,
    runId: "run-install",
  });
  assert.equal(result.installed, true);
  assert.equal(result.enabled, false);
  assert.equal(result.list, "project-skills");
});

test("MCP assessment snapshots tools and installs a deny-by-default global connection", async () => {
  let businessToolCalls = 0;
  const tools: readonly McpRemoteTool[] = [
    {
      name: "write_report",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: false },
    },
    {
      name: "delete_report",
      inputSchema: { type: "object" },
      annotations: { destructiveHint: true },
    },
  ];
  const { createdInputs, subject } = fixture({
    connectMcp: async () =>
      remoteClient(tools, () => {
        businessToolCalls += 1;
      }),
  });
  const report = await subject.assess({
    authentication: "none",
    conversationId: "conversation-one",
    kind: "mcp",
    name: "Reports",
    projectId: "project-one",
    projectName: "Project One",
    runId: "run-assess",
    url: "https://mcp.example.com/api",
  });

  assert.equal(report.status, "compatible");
  assert.equal(report.installable, true);
  assert.equal(report.reportFormat, "boltpocket-capability-diagnostic/v1");
  assert.deepEqual(report.runtime, {
    businessToolsCalled: false,
    inspection: "handshake-ping-tools-list",
    kind: "mcp",
    supportedTransport: "streamable-http",
    unsupportedTransports: ["stdio", "legacy-sse", "websocket"],
  });
  assert.equal(businessToolCalls, 0);
  assert.deepEqual(report.discoveredTools, ["delete_report", "write_report"]);
  assert.equal(report.plannedInstall.allToolCallsRequireApproval, true);
  assert.equal(
    report.risks.some((risk) => risk.severity === "high"),
    true,
  );

  const result = await subject.install({
    assessmentId: report.assessmentId,
    conversationId: "conversation-one",
    latestUserPrompt: "确认",
    projectId: "project-one",
    runId: "run-install",
  });
  assert.equal(result.list, "global-mcp");
  assert.equal(result.enabled, true);
  assert.deepEqual(createdInputs, [
    {
      projectId: null,
      name: "Reports",
      serverUrl: "https://mcp.example.com/api",
      authentication: { kind: "none" },
      enabled: true,
      trustToolAnnotations: false,
      approveTools: ["*"],
      allowedToolNames: ["delete_report", "write_report"],
    },
  ]);
});

test("MCP assessment accepts local HTTP but rejects public HTTP", async () => {
  const { subject } = fixture();
  const local = await subject.assess({
    authentication: "none",
    conversationId: "conversation-one",
    kind: "mcp",
    name: "Raspi MCP",
    projectId: "project-one",
    projectName: "Project One",
    runId: "run-local",
    url: "http://raspi.local:8787/mcp",
  });
  assert.equal(local.status, "compatible");
  assert.equal(local.installable, true);

  const publicHttp = await subject.assess({
    authentication: "none",
    conversationId: "conversation-one",
    kind: "mcp",
    name: "Public MCP",
    projectId: "project-one",
    projectName: "Project One",
    runId: "run-public",
    url: "http://mcp.example.com/mcp",
  });
  assert.equal(publicHttp.status, "incompatible");
  assert.equal(publicHttp.installable, false);
  assert.match(publicHttp.checks[0]?.label ?? "", /公网必须使用 HTTPS/u);

  const localOauth = await subject.assess({
    authentication: "oauth",
    conversationId: "conversation-one",
    kind: "mcp",
    name: "Raspi OAuth MCP",
    projectId: "project-one",
    projectName: "Project One",
    runId: "run-local-oauth",
    url: "http://192.168.51.72:8787/mcp",
  });
  assert.equal(localOauth.status, "incompatible");
  assert.equal(localOauth.installable, false);
  assert.match(localOauth.checks[0]?.label ?? "", /OAuth 必须使用 HTTPS/u);
});

test("an authenticated MCP is reassessed as OAuth and authorized only after confirmation", async () => {
  let authorized = 0;
  const { createdInputs, subject } = fixture({
    connectMcp: async () => {
      throw new Error("401 Unauthorized");
    },
    authorizeMcpOAuth: async () => {
      authorized += 1;
      return { authorizationId: "oauth-secure" };
    },
  });
  const base = {
    conversationId: "conversation-one",
    kind: "mcp" as const,
    name: "Secure MCP",
    projectId: "project-one",
    projectName: "Project One",
    runId: "run-assess-none",
    url: "https://secure.example.com/mcp",
  };
  const withoutAuth = await subject.assess({
    ...base,
    authentication: "none",
  });
  assert.equal(withoutAuth.status, "incompatible");
  assert.equal(withoutAuth.installable, false);
  assert.equal(withoutAuth.suggestedAuthentication, "oauth");

  const oauth = await subject.assess({
    ...base,
    authentication: "oauth",
    runId: "run-assess-oauth",
  });
  assert.equal(oauth.status, "limited");
  assert.equal(oauth.installable, true);
  assert.equal(authorized, 0);

  await subject.install({
    assessmentId: oauth.assessmentId,
    conversationId: base.conversationId,
    latestUserPrompt: "Yes, proceed",
    projectId: base.projectId,
    runId: "run-install",
  });
  assert.equal(authorized, 1);
  assert.deepEqual(createdInputs[0]?.authentication, {
    kind: "oauth",
    authorizationId: "oauth-secure",
  });
  assert.deepEqual(createdInputs[0]?.approveTools, ["*"]);
  assert.equal(createdInputs[0]?.trustToolAnnotations, false);
});

test("an expired confirmed assessment installs in the same run after an exact fingerprint match", async () => {
  let now = new Date("2026-08-15T12:00:00.000Z");
  const { installedSkills, subject } = fixture({ now: () => now });
  const report = await subject.assess(skillAssessmentInput);
  now = new Date("2026-08-15T12:31:00.000Z");
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "确认",
        projectId: skillAssessmentInput.projectId,
        runId: "run-install",
      }),
    /若指纹一致，可在本轮直接安装/u,
  );

  const revalidated = await subject.assess({
    ...skillAssessmentInput,
    runId: "run-install",
  });
  assert.equal(revalidated.fingerprint, report.fingerprint);
  assert.equal(revalidated.confirmationRequired, false);
  assert.equal(revalidated.confirmationCarriedForward, true);
  assert.match(revalidated.nextStep, /本轮直接调用安装工具/u);

  const result = await subject.install({
    assessmentId: revalidated.assessmentId,
    conversationId: skillAssessmentInput.conversationId,
    latestUserPrompt: "确认",
    projectId: skillAssessmentInput.projectId,
    runId: "run-install",
  });
  assert.equal(result.installed, true);
  assert.equal(installedSkills.length, 1);
});

test("a changed fingerprint after expiry requires a new confirmation turn", async () => {
  let now = new Date("2026-08-15T12:00:00.000Z");
  let capability = skillCapability();
  const { subject } = fixture({
    now: () => now,
    resolveSkill: async () => capability,
  });
  const report = await subject.assess(skillAssessmentInput);
  now = new Date("2026-08-15T12:31:00.000Z");
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: report.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "确认安装",
        projectId: skillAssessmentInput.projectId,
        runId: "run-install",
      }),
    /若指纹一致/u,
  );

  capability = {
    ...capability,
    bundle: {
      ...capability.bundle,
      sha256: "b".repeat(64),
    },
  };
  const changed = await subject.assess({
    ...skillAssessmentInput,
    runId: "run-install",
  });
  assert.notEqual(changed.fingerprint, report.fingerprint);
  assert.equal(changed.confirmationRequired, true);
  assert.equal(changed.confirmationCarriedForward, undefined);
  await assert.rejects(
    () =>
      subject.install({
        assessmentId: changed.assessmentId,
        conversationId: skillAssessmentInput.conversationId,
        latestUserPrompt: "确认安装",
        projectId: skillAssessmentInput.projectId,
        runId: "run-install",
      }),
    /必须分成两轮/u,
  );
});
