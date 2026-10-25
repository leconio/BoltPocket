import assert from "node:assert/strict";
import test from "node:test";

import {
  PiAgentRuntime,
  type CreateSessionInput,
  type RuntimeSessionPersistencePort,
} from "@boltpocket/agent-runtime";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { AGENT_TEXT_LIMITS } from "../../application/bounded-text.ts";
import type { AgentRunInput } from "../../application/ports/agent-runtime.ts";
import type { AgentBrowserControlPort } from "../../application/ports/browser-control.ts";
import type { AgentMediaAnalysisPort } from "../../application/ports/media-analysis.ts";
import type { AgentImageGenerationPort } from "../../application/ports/image-generation.ts";
import type { AgentVideoGenerationPort } from "../../application/ports/video-generation.ts";
import type {
  AgentCredentialAccessPort,
  CredentialVaultItem,
} from "../../application/ports/credential-vault.ts";
import type { ProjectPreviewSnapshotPort } from "../../application/ports/project-preview.ts";
import type { AgentSshCredentialConnectionPort } from "../../application/ports/ssh-command-sessions.ts";
import { builtInProjectResourcePack } from "../../domain/builtin-project-resources.ts";
import type { Project, WorkspaceResource } from "../../domain/models.ts";
import { builtInSkills } from "../../domain/library-catalog.ts";
import { createProjectWithWorkspace } from "../../domain/project-workspace.ts";
import {
  SNAKE_H5_HTML,
  SNAKE_H5_SCRIPT,
} from "../../testing/snake-h5-fixture.ts";
import type { SshProjectShellTransport } from "../shell/index.ts";
import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

function openAiTextResponse(content: string, sequence: number) {
  const chunk = (
    delta: Record<string, unknown>,
    finishReason: string | null,
  ) => ({
    id: `chatcmpl-mobile-${sequence}`,
    object: "chat.completion.chunk",
    created: sequence,
    model: "mobile-reasoning-fixture",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  const body = [chunk({ role: "assistant", content }, null), chunk({}, "stop")]
    .map((value) => `data: ${JSON.stringify(value)}\n\n`)
    .concat("data: [DONE]\n\n")
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function runInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    runId: "run-workflow",
    conversationId: "conversation-workflow",
    prompt: "完成目标",
    project: null,
    memories: [],
    skills: [],
    resources: [],
    attachments: [],
    ...overrides,
  };
}

const shellProject: Project = {
  id: "shell-project",
  name: "Shell project",
  symbol: "S",
  description: "bash integration fixture",
  instructions: "只处理当前项目资源。",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 1,
  resourceCount: 1,
};

function shellResource(
  overrides: Partial<WorkspaceResource> = {},
): WorkspaceResource {
  return {
    id: "shell-notes",
    projectId: shellProject.id,
    connectionId: "workspace",
    path: "notes.txt",
    content: "alpha\nsecond\n",
    version: "1",
    storage: { kind: "memory" },
    ...overrides,
  };
}

function registryFor(
  resources: readonly WorkspaceResource[],
  onRead?: (resourceId: string) => void,
) {
  const refs = resources.map((resource) => ({
    connectorId: resource.connectionId,
    accountId: `project-${resource.projectId}`,
    resourceId: resource.id,
    projectId: resource.projectId,
    kind: "text",
    displayName: resource.path,
    locator: resource.path,
  }));
  return {
    descriptors: () => [
      {
        id: "workspace",
        label: "Workspace",
        kind: "fixture",
        accountId: `project-${shellProject.id}`,
        accountLabel: shellProject.name,
        status: "connected",
        projectIds: [shellProject.id],
        capabilities: ["list", "read-text"],
      },
    ],
    listResources: async () => refs,
    read: async (ref: (typeof refs)[number]) => {
      onRead?.(ref.resourceId);
      const resource = resources.find((item) => item.id === ref.resourceId);
      if (!resource) throw new Error("fixture resource missing");
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

class MemorySessionPersistence implements RuntimeSessionPersistencePort {
  readonly values = new Map<string, string>();

  async load(sessionId: string) {
    return this.values.get(sessionId);
  }

  async save(sessionId: string, value: string) {
    this.values.set(sessionId, value);
  }

  async delete(sessionId: string) {
    this.values.delete(sessionId);
  }
}

test("the parent Agent delegates selected current-turn images to a read-only specialist", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("analyze_media", {
        question: "读取截图中的错误提示",
        attachmentIds: ["image-one"],
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      assert.equal(text, "画面显示 TIMEOUT。");
      return fauxAssistantMessage("截图中的错误是 TIMEOUT。");
    },
  ]);
  const calls: Parameters<AgentMediaAnalysisPort["analyze"]>[0][] = [];
  const mediaAnalysis: AgentMediaAnalysisPort = {
    analyze: async (input) => {
      calls.push(input);
      return {
        content: "画面显示 TIMEOUT。",
        modelRef: "provider-vision:model-vision",
      };
    },
  };
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    mediaAnalysis,
    registryFactory: () => ({}) as never,
  });

  try {
    const output = await runtime.run(
      runInput({
        prompt: "这张图显示了什么错误？",
        attachments: [
          {
            id: "image-one",
            kind: "image",
            uri: "file:///image-one.png",
            name: "image-one.png",
            mimeType: "image/png",
            base64: "aW1hZ2U=",
          },
          {
            id: "image-two",
            kind: "image",
            uri: "file:///image-two.png",
            name: "image-two.png",
            mimeType: "image/png",
            base64: "aW1hZ2Uy",
          },
        ],
      }),
      new AbortController().signal,
    );
    assert.equal(output.content, "截图中的错误是 TIMEOUT。");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.attachments.length, 1);
    assert.equal(calls[0]?.attachments[0]?.id, "image-one");
    assert.equal(calls[0]?.projectId, null);
    assert.equal(calls[0]?.question, "读取截图中的错误提示");
  } finally {
    await runtime.dispose();
  }
});

test("the parent Agent sees only a configured image-output capability and returns its saved attachment", async () => {
  const attachment = {
    id: "generated-image-fixture",
    kind: "generated-image" as const,
    uri: "file:///documents/generated-image-fixture.png",
    name: "generated-image-fixture.png",
    mimeType: "image/png" as const,
    sizeBytes: 128,
    providerName: "Fixture Images",
    modelId: "image-model-1",
    createdAt: "2026-08-09T12:00:00.000Z",
  };
  const calls: Parameters<AgentImageGenerationPort["generate"]>[0][] = [];
  const imageGeneration: AgentImageGenerationPort = {
    capability: async () => ({
      providerId: "provider-images",
      providerName: "Fixture Images",
      modelProfileId: "profile-image-model-1",
      modelId: "image-model-1",
    }),
    generate: async (input) => {
      calls.push(input);
      return {
        attachment,
        capability: {
          providerId: "provider-images",
          providerName: "Fixture Images",
          modelProfileId: "profile-image-model-1",
          modelId: "image-model-1",
        },
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(context.systemPrompt ?? "", /generate_image/u);
      assert.match(context.systemPrompt ?? "", /Fixture Images/u);
      assert.match(context.systemPrompt ?? "", /image-model-1/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /api[_ -]?key|Bearer/u);
      return fauxAssistantMessage(
        fauxToolCall("generate_image", {
          prompt: "一只戴红围巾的橘猫，白色背景",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      assert.match(text, /generated-image-fixture/u);
      assert.doesNotMatch(text, /file:\/\//u);
      return fauxAssistantMessage("图片已经生成并附在本条回复中。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    imageGeneration,
    registryFactory: () => ({}) as never,
  });

  try {
    const output = await runtime.run(
      runInput({ prompt: "帮我画一只戴红围巾的橘猫。" }),
      new AbortController().signal,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.prompt, "一只戴红围巾的橘猫，白色背景");
    assert.equal(output.content, "图片已经生成并附在本条回复中。");
    assert.deepEqual(output.attachments, [attachment]);
  } finally {
    await runtime.dispose();
  }
});

test("the parent Agent invokes the configured Seedance route and returns a saved video attachment", async () => {
  const attachment = {
    id: "generated-video-fixture",
    kind: "generated-video" as const,
    uri: "file:///documents/generated-video-fixture.mp4",
    name: "generated-video-fixture.mp4",
    mimeType: "video/mp4" as const,
    sizeBytes: 4_096,
    durationSeconds: 4,
    providerName: "Fixture Seedance",
    modelId: "doubao-seedance-2-5-260628",
    createdAt: "2026-08-09T12:00:00.000Z",
  };
  const calls: Parameters<AgentVideoGenerationPort["generate"]>[0][] = [];
  const videoGeneration: AgentVideoGenerationPort = {
    capability: async () => ({
      providerId: "provider-video",
      providerName: "Fixture Seedance",
      modelProfileId: "profile-seedance",
      modelId: "doubao-seedance-2-5-260628",
    }),
    generate: async (input) => {
      calls.push(input);
      return {
        attachment,
        providerTaskId: "cgt-fixture-video",
        capability: {
          providerId: "provider-video",
          providerName: "Fixture Seedance",
          modelProfileId: "profile-seedance",
          modelId: "doubao-seedance-2-5-260628",
        },
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(context.systemPrompt ?? "", /generate_video/u);
      assert.match(context.systemPrompt ?? "", /Fixture Seedance/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /api[_ -]?key|Bearer/u);
      return fauxAssistantMessage(
        fauxToolCall("generate_video", {
          prompt: "深色背景中一枚青绿色玻璃球缓慢旋转",
          ratio: "16:9",
          durationSeconds: 4,
          generateAudio: false,
          referenceUrls: [
            {
              type: "audio_url",
              url: "https://media.example/reference.mp3",
            },
          ],
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      assert.match(text, /cgt-fixture-video/u);
      assert.doesNotMatch(text, /file:\/\//u);
      return fauxAssistantMessage("视频已经生成并保存在本条回复中。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    videoGeneration,
    registryFactory: () => ({}) as never,
  });

  try {
    const output = await runtime.run(
      runInput({
        prompt:
          "生成一个玻璃球旋转的 4 秒短视频，使用 https://media.example/reference.mp3 作为参考音频。",
      }),
      new AbortController().signal,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.durationSeconds, 4);
    assert.equal(calls[0]?.generateAudio, false);
    assert.deepEqual(calls[0]?.referenceUrls, [
      {
        type: "audio_url",
        url: "https://media.example/reference.mp3",
      },
    ]);
    assert.equal(output.content, "视频已经生成并保存在本条回复中。");
    assert.deepEqual(output.attachments, [attachment]);
  } finally {
    await runtime.dispose();
  }
});

const credentialFixture = {
  id: "credential-01234567-89ab-4def-8123-456789abcdef",
  label: "Production password",
  kind: "password" as const,
  username: "deploy",
  projectIds: [shellProject.id],
  source: "manual" as const,
  createdAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T12:00:00.000Z",
};

function credentialAccessFixture(
  secret: string,
  onRequest?: () => void,
): AgentCredentialAccessPort {
  return {
    listAuthorized: async (projectId) =>
      projectId === shellProject.id ? [credentialFixture] : [],
    requestAccess: async (input) => {
      onRequest?.();
      assert.equal(input.projectId, shellProject.id);
      assert.equal(input.credentialId, credentialFixture.id);
      return {
        approved: true,
        item: credentialFixture,
        secret: { kind: "password", password: secret },
      };
    },
  };
}

test("sshpass resolves an authorized SSH vault entry without revealing its secret", async () => {
  const operateSshSkill = builtInSkills.find(
    (skill) => skill.id === "operate-ssh",
  );
  assert.ok(operateSshSkill);
  const sshCredential: CredentialVaultItem = {
    id: "credential-ssh-01234567-89ab-4def-8123-456789abcdef",
    label: "Raspberry Pi",
    kind: "ssh",
    username: "pi",
    endpoint: "ssh://raspi.local:22/home/pi/project",
    sshAuthentication: "private-key",
    sshHostKey: { algorithm: "ssh-ed25519", fingerprint: "SHA256:fixture" },
    projectIds: [shellProject.id],
    source: "manual",
    createdAt: "2026-08-06T12:00:00.000Z",
    updatedAt: "2026-08-06T12:00:00.000Z",
  };
  const credentialAccess: AgentCredentialAccessPort = {
    listAuthorized: async (projectId) =>
      projectId === shellProject.id ? [sshCredential] : [],
    requestAccess: async () => {
      throw new Error("SSH secret must not enter the model approval path");
    },
  };
  const connectionCalls: string[] = [];
  const sshCredentialConnection: AgentSshCredentialConnectionPort = {
    connect: async (project, credentialId) => {
      connectionCalls.push(`${project.id}:${credentialId}`);
      return {
        profileId: "profile-raspi",
        credentialId,
        projectId: project.id,
        alias: "raspi-fixture",
        sessionId: "session-raspi",
        root: "/home/pi/project",
        account: "pi@raspi.local:22",
        access: "persistent",
        verification: "ssh-ed25519 SHA256:fixture",
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "sshpass"),
        false,
      );
      assert.match(context.systemPrompt ?? "", /load operate-ssh/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /ssh <alias> --/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "operate-ssh" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "sshpass"),
        true,
      );
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, /ssh <alias> --/u);
      assert.match(transcript, /App 不限制远端命令类别/u);
      return fauxAssistantMessage(fauxToolCall("credential_vault_list", {}), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      const content = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const listed = JSON.parse(content) as {
        credentials: { label: string; sshReady: boolean }[];
      };
      assert.equal(listed.credentials.length, 1);
      assert.equal(listed.credentials[0]?.label, "Raspberry Pi");
      assert.equal(listed.credentials[0]?.sshReady, true);
      assert.doesNotMatch(content, /PRIVATE KEY|password/u);
      return fauxAssistantMessage(
        fauxToolCall("sshpass", { credentialId: sshCredential.id }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, /raspi-fixture/u);
      assert.match(transcript, /pi@raspi\.local:22/u);
      assert.doesNotMatch(transcript, /PRIVATE KEY|passphrase/u);
      return fauxAssistantMessage("已通过项目授权凭据建立 SSH 连接。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    credentialAccess,
    sshCredentialConnection,
    registryFactory: () => registryFor([]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-ssh-vault",
      project: shellProject,
      skills: [operateSshSkill],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已通过项目授权凭据建立 SSH 连接。");
  assert.deepEqual(connectionCalls, [`${shellProject.id}:${sshCredential.id}`]);

  faux.appendResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "sshpass"),
        true,
      );
      return fauxAssistantMessage("当前会话继续保留已加载的 SSH 工具。");
    },
  ]);
  const next = await runtime.run(
    runInput({
      runId: "run-after-ssh",
      conversationId: "conversation-ssh-vault",
      prompt: "总结项目名称。",
      project: shellProject,
      skills: [operateSshSkill],
    }),
    new AbortController().signal,
  );
  assert.equal(next.content, "当前会话继续保留已加载的 SSH 工具。");
  await runtime.dispose();
});

test("the project Agent opens, reads, and closes its own temporary browser page", async () => {
  const operateBrowserSkill = builtInSkills.find(
    (skill) => skill.id === "operate-browser",
  );
  assert.ok(operateBrowserSkill);
  const calls: Parameters<AgentBrowserControlPort["execute"]>[0][] = [];
  const cleanupCalls: string[] = [];
  const taskId = "browser-agent-runtime";
  const browserControl: AgentBrowserControlPort = {
    execute: async (input) => {
      calls.push(input);
      if (input.action === "open") {
        return {
          action: "open",
          completed: true,
          managed: true,
          taskId,
          mode: "minimized",
          url: "https://example.com/account",
          title: "",
          canGoBack: false,
          canGoForward: false,
          loading: true,
        };
      }
      if (input.action === "snapshot") {
        return {
          action: "snapshot",
          taskId,
          snapshot: {
            revision: "page-one",
            url: "https://example.com/account",
            title: "Account",
            text: "Visible account overview",
            controls: [
              {
                id: "control-1",
                kind: "link",
                label: "Orders",
                actions: ["click"],
                href: "https://example.com/orders",
              },
            ],
          },
          untrusted: true,
        };
      }
      if (input.action === "close") {
        return { action: "close", completed: true, taskId, url: null };
      }
      throw new Error("unexpected browser action");
    },
    closeRun: (projectId, runId) => {
      cleanupCalls.push(`${projectId}:${runId}`);
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      assert.match(context.systemPrompt ?? "", /load operate-browser/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /read_text\(offset=0\)/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "operate-browser" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        true,
      );
      assert.match(JSON.stringify(context.messages), /read_text\(offset=0\)/u);
      return fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "open",
          url: "https://example.com/account",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("browser", { action: "snapshot", taskId }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, /Visible account overview/u);
      assert.match(transcript, /untrusted/u);
      return fauxAssistantMessage(
        fauxToolCall("browser", { action: "close", taskId }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("已通过临时网页读取当前信息。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    browserControl,
    registryFactory: () => registryFor([]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-browser-control",
      project: shellProject,
      skills: [operateBrowserSkill],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已通过临时网页读取当前信息。");
  assert.deepEqual(calls, [
    {
      action: "open",
      projectId: shellProject.id,
      runId: "run-workflow",
      url: "https://example.com/account",
    },
    {
      action: "snapshot",
      projectId: shellProject.id,
      runId: "run-workflow",
      taskId,
    },
    {
      action: "close",
      projectId: shellProject.id,
      runId: "run-workflow",
      taskId,
    },
  ]);
  assert.deepEqual(cleanupCalls, [`${shellProject.id}:run-workflow`]);
  await runtime.dispose();
});

test("a disabled specialized Skill cannot expose or activate its tool group", async () => {
  const operateBrowserSkill = builtInSkills.find(
    (skill) => skill.id === "operate-browser",
  );
  assert.ok(operateBrowserSkill);
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      assert.doesNotMatch(context.systemPrompt ?? "", /load operate-browser/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "operate-browser" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.toolName, "skill_read");
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /不存在或未在当前项目启用/u);
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      return fauxAssistantMessage("已停用的浏览器 Skill 不可使用。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    browserControl: {
      execute: async () => {
        throw new Error("disabled browser tool must not execute");
      },
    },
    registryFactory: () => registryFor([]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-disabled-browser-skill",
      project: shellProject,
      skills: [{ ...operateBrowserSkill, enabled: false }],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已停用的浏览器 Skill 不可使用。");
  await runtime.dispose();
});

test("build-h5 exposes preview without also exposing browser controls", async () => {
  const buildH5Skill = builtInSkills.find((skill) => skill.id === "build-h5");
  assert.ok(buildH5Skill);
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "preview_project"),
        false,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "build-h5" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "preview_project"),
        true,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      return fauxAssistantMessage("H5 预览工具已按需加载。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    browserControl: {
      execute: async () => {
        throw new Error("browser must not execute in this fixture");
      },
    },
    projectPreview: {
      create: async () => {
        throw new Error("preview must not execute in this fixture");
      },
      release: () => undefined,
    },
    registryFactory: () => registryFor([]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-build-h5-tools",
      project: shellProject,
      skills: [buildH5Skill],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "H5 预览工具已按需加载。");
  await runtime.dispose();
});

test("the project Agent hands off and smoke-tests an isolated Snake H5 preview", async () => {
  const buildH5Skill = builtInSkills.find((skill) => skill.id === "build-h5");
  const operateBrowserSkill = builtInSkills.find(
    (skill) => skill.id === "operate-browser",
  );
  const resourceSkill = builtInSkills.find(
    (skill) => skill.id === "use-h5-resources",
  );
  const kenneyResourceSkill = builtInSkills.find(
    (skill) => skill.id === "use-kenney-1bit",
  );
  assert.ok(buildH5Skill);
  assert.ok(operateBrowserSkill);
  assert.ok(resourceSkill);
  assert.ok(kenneyResourceSkill);
  const kenneyPack = builtInProjectResourcePack("kenney-1bit");
  const snakeStyle =
    /<style>([\s\S]*?)<\/style>/u.exec(SNAKE_H5_HTML)?.[1] ?? "";
  const snakeHtml = SNAKE_H5_HTML.replace(
    /<style>[\s\S]*?<\/style>/u,
    '<link rel="stylesheet" href="./styles/app.css">',
  ).replace(
    '<script src="game.js"></script>',
    '<script type="module" src="./scripts/app.js"></script>',
  );
  const workspace = createProjectWithWorkspace({
    id: shellProject.id,
    name: shellProject.name,
  });
  const previewInputs: Parameters<ProjectPreviewSnapshotPort["create"]>[0][] =
    [];
  const browserCalls: Parameters<AgentBrowserControlPort["execute"]>[0][] = [];
  const previewId = "0123456789abcdef0123456789abcdef";
  const projectPreview: ProjectPreviewSnapshotPort = {
    create: async (input) => {
      previewInputs.push(input);
      return {
        id: previewId,
        projectId: shellProject.id,
        entryPath: input.entryPath,
        displayPath: "index.html",
        url: `https://preview-${previewId}.boltpocket.invalid/content/index.html`,
        rootUri: `file:///cache/boltpocket/project-previews/${previewId}/`,
        fileCount: input.files.length,
        byteLength: input.files.reduce(
          (total, file) => total + file.content.length,
          0,
        ),
        contentSha256: "a".repeat(64),
        app: {
          schema: 1,
          title: "贪吃蛇",
          entry: "index.html",
          profile: "vanilla",
          addons: [],
          permissions: [],
          resources: ["kenney-1bit"],
        },
        runtime: { assetCount: 0, byteLength: 0 },
        resources: {
          packCount: 1,
          fileCount: kenneyPack.files.length,
          byteLength: kenneyPack.files.reduce(
            (total, file) => total + file.byteLength,
            0,
          ),
        },
        createdAt: 1,
      };
    },
    release: () => undefined,
  };
  const browserControl: AgentBrowserControlPort = {
    execute: async (input) => {
      browserCalls.push(input);
      if (input.action === "preview") {
        return {
          action: "preview",
          completed: true,
          managed: true,
          handedOff: true,
          taskId: "browser-preview-snake",
          mode: "expanded",
          url: "project-preview://shell-project/index.html",
          title: "本地预览 · index.html",
          canGoBack: false,
          canGoForward: false,
          loading: true,
          entryPath: input.snapshot.entryPath,
          fileCount: input.snapshot.fileCount,
        };
      }
      if (input.action === "snapshot") {
        return {
          action: "snapshot",
          taskId: "browser-preview-snake",
          snapshot: {
            revision: "snake-preview-one",
            url: "project-preview://shell-project/index.html",
            title: "贪吃蛇",
            text:
              browserCalls.some((call) => call.action === "click") &&
              browserCalls.some((call) => call.action === "type")
                ? "游戏已开始"
                : "玩家昵称 开始游戏",
            controls: [
              {
                id: "control-1",
                kind: "input",
                label: "玩家昵称",
                actions: ["type"],
              },
              {
                id: "control-2",
                kind: "button",
                label: "开始游戏",
                actions: ["click"],
              },
            ],
          },
          untrusted: true,
        };
      }
      if (input.action === "type") {
        return {
          action: "type",
          completed: true,
          taskId: "browser-preview-snake",
          url: "project-preview://shell-project/index.html",
          targetId: input.targetId,
          inputLength: input.text.length,
        };
      }
      if (input.action === "click") {
        return {
          action: "click",
          completed: true,
          taskId: "browser-preview-snake",
          url: "project-preview://shell-project/index.html",
          targetId: input.targetId,
        };
      }
      throw new Error(`unexpected browser action: ${input.action}`);
    },
    closeRun: () => undefined,
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(context.systemPrompt ?? "", /preview_project/u);
      assert.match(context.systemPrompt ?? "", /build-h5/u);
      assert.match(context.systemPrompt ?? "", /operate-browser/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /HTTPS APIs and media/u);
      assert.equal(
        context.tools?.some((tool) => tool.name === "preview_project"),
        false,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_catalog"),
        false,
      );
      return fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage(fauxToolCall("skill_read", { name: "build-h5" }), {
      stopReason: "toolUse",
    }),
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "preview_project"),
        true,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_catalog"),
        false,
      );
      assert.match(JSON.stringify(context.messages), /boltpocket\.h5\.json/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "use-h5-resources" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_catalog"),
        true,
      );
      assert.equal(
        context.tools?.some((tool) => tool.name === "project_resource_copy"),
        false,
      );
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "use-kenney-1bit" }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("project_resource_catalog", {
        action: "search",
        packId: "kenney-1bit",
        query: "colored_packed",
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      assert.match(JSON.stringify(context.messages), /小游戏验收/u);
      assert.match(JSON.stringify(context.messages), /write.*创建/u);
      assert.match(
        JSON.stringify(context.messages),
        /\/project\/apps\/<slug>\/index\.html/u,
      );
      assert.match(
        JSON.stringify(context.messages),
        /一个项目可以并存多个 H5/u,
      );
      assert.match(
        JSON.stringify(context.messages),
        /tilesheets\/colored_packed\.png/u,
      );
      return fauxAssistantMessage(
        fauxToolCall("write", {
          path: "/project/apps/snake/boltpocket.h5.json",
          content: JSON.stringify({
            schema: 1,
            title: "贪吃蛇",
            entry: "index.html",
            profile: "vanilla",
            addons: [],
            permissions: [],
            resources: ["kenney-1bit"],
          }),
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("write", {
        path: "/project/apps/snake/index.html",
        content: snakeHtml,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("write", {
        path: "/project/apps/snake/styles/app.css",
        content: snakeStyle,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("write", {
        path: "/project/apps/snake/scripts/app.js",
        content: SNAKE_H5_SCRIPT,
      }),
      { stopReason: "toolUse" },
    ),
    () => {
      return fauxAssistantMessage(
        fauxToolCall("preview_project", {
          entryPath: "/project/apps/snake/index.html",
          present: true,
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("skill_read", { name: "operate-browser" }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        true,
      );
      return fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "snapshot",
          taskId: "browser-preview-snake",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "type",
        taskId: "browser-preview-snake",
        revision: "snake-preview-one",
        targetId: "control-1",
        text: "测试玩家",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "click",
        taskId: "browser-preview-snake",
        revision: "snake-preview-one",
        targetId: "control-2",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "snapshot",
        taskId: "browser-preview-snake",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("贪吃蛇预览已打开。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    browserControl,
    projectPreview,
    registryFactory: () => registryFor(workspace.resources),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-snake-preview",
      project: workspace.project,
      skills: [
        buildH5Skill,
        operateBrowserSkill,
        resourceSkill,
        kenneyResourceSkill,
      ],
      resources: workspace.resources,
      resourcePacks: [
        {
          id: kenneyPack.id,
          skillId: "use-kenney-1bit",
          name: kenneyPack.name,
          description: kenneyPack.description,
          version: kenneyPack.version,
          license: kenneyPack.license,
          fileCount: kenneyPack.files.length,
        },
      ],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "贪吃蛇预览已打开。");
  assert.equal(output.proposal?.hunks.length, 4);
  assert.deepEqual(output.proposal?.hunks.map((hunk) => hunk.target).sort(), [
    "apps/snake/boltpocket.h5.json",
    "apps/snake/index.html",
    "apps/snake/scripts/app.js",
    "apps/snake/styles/app.css",
  ]);
  assert.equal(
    output.proposal?.hunks.every(
      (hunk) => hunk.operation === "create" && hunk.before === "",
    ),
    true,
  );
  assert.equal(
    output.proposal?.hunks.find(
      (hunk) => hunk.target === "apps/snake/index.html",
    )?.after,
    snakeHtml,
  );
  assert.equal(previewInputs.length, 1);
  assert.deepEqual(previewInputs[0]?.enabledResourcePackIds, ["kenney-1bit"]);
  assert.deepEqual(
    previewInputs[0]?.files.map((file) => file.path),
    [
      "/project/apps/snake/boltpocket.h5.json",
      "/project/apps/snake/index.html",
      "/project/apps/snake/scripts/app.js",
      "/project/apps/snake/styles/app.css",
    ],
  );
  assert.equal(
    previewInputs[0]?.files.find((file) => file.path.endsWith("index.html"))
      ?.content,
    snakeHtml,
  );
  assert.equal(browserCalls[0]?.action, "preview");
  if (browserCalls[0]?.action === "preview") {
    assert.equal(browserCalls[0].present, true);
    assert.equal(
      browserCalls[0].snapshot.entryPath,
      previewInputs[0]?.entryPath,
    );
  }
  assert.deepEqual(
    browserCalls.map((call) => call.action),
    ["preview", "snapshot", "type", "click", "snapshot"],
  );
  await runtime.dispose();
});

test("Pi thinking blocks never enter the mobile output", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage([
      fauxThinking("先检查项目约束。"),
      fauxText("约束检查完成。"),
    ]),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: { ...faux.getModel(), reasoning: true },
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => ({}) as never,
    thinkingLevel: "medium",
  });
  let modelActivityEvents = 0;

  const output = await runtime.run(
    runInput(),
    new AbortController().signal,
    (event) => {
      if (event.type === "model-activity") modelActivityEvents += 1;
    },
  );

  assert.equal(output.content, "约束检查完成。");
  assert.equal("thinking" in output, false);
  assert.ok(modelActivityEvents > 0);
  await runtime.dispose();
});

test("visible model text and tool calls survive without exposing reasoning", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxThinking("先分析项目边界。"),
        fauxText("我先读取项目上下文。"),
        fauxToolCall("project_context_read", {}),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("项目上下文检查完成。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: { ...faux.getModel(), reasoning: true },
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => ({}) as never,
    thinkingLevel: "medium",
  });
  const publicTextEvents: string[] = [];

  const output = await runtime.run(
    runInput(),
    new AbortController().signal,
    (event) => {
      if (event.type === "assistant-text") {
        publicTextEvents.push(event.content);
      }
    },
  );

  assert.equal(output.content, "项目上下文检查完成。");
  assert.equal("thinking" in output, false);
  assert.deepEqual(
    output.activity?.map((item) =>
      item.kind === "tool"
        ? { kind: item.kind, label: item.label, status: item.status }
        : item.kind === "context"
          ? { kind: item.kind, operation: item.operation, status: item.status }
          : { kind: item.kind, content: item.content },
    ),
    [
      {
        kind: "text",
        content: "我先读取项目上下文。",
      },
      {
        kind: "tool",
        label: "读取项目上下文",
        status: "completed",
      },
    ],
  );
  assert.deepEqual(publicTextEvents, ["我先读取项目上下文。"]);
  await runtime.dispose();
});

test("long reasoning is discarded while the final answer stays bounded", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage([
      fauxThinking(`THINK-BEGIN-${"t".repeat(90_000)}-THINK-END`),
      fauxText(`ANSWER-BEGIN-${"a".repeat(240_000)}-ANSWER-END`),
    ]),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: { ...faux.getModel(), reasoning: true },
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => ({}) as never,
    thinkingLevel: "max",
  });

  const output = await runtime.run(runInput(), new AbortController().signal);

  assert.ok(
    output.content.length <= AGENT_TEXT_LIMITS.storedResponseCharacters,
  );
  assert.match(output.content, /^ANSWER-BEGIN-/u);
  assert.match(output.content, /-ANSWER-END$/u);
  assert.equal("thinking" in output, false);
  await runtime.dispose();
});

test("configured thinking changes keep the live mobile conversation", async () => {
  let thinkingLevel: NonNullable<CreateSessionInput["thinkingLevel"]> =
    "medium";
  const requests: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    const body = init?.body;
    assert.equal(typeof body, "string");
    requests.push(JSON.parse(body as string) as Record<string, unknown>);
    assert.equal(requests.at(-1)?.stream, true);
    return openAiTextResponse(
      requests.length === 1 ? "first dynamic answer" : "second dynamic answer",
      requests.length,
    );
  };
  globalThis.fetch = fetchMock;
  const runtime = new PiMobileAgentRuntime({
    modelConfigProvider: async () => ({
      baseUrl: "https://fixture.invalid/v1",
      model: "mobile-reasoning-fixture",
      apiKey: "fixture-api-key",
      contextWindow: 128_000,
      thinkingLevel,
    }),
    registryFactory: () => ({}) as never,
  });

  try {
    const first = await runtime.run(
      runInput({ prompt: "first dynamic prompt" }),
      new AbortController().signal,
    );
    assert.equal(first.content, "first dynamic answer");

    thinkingLevel = "high";
    const second = await runtime.run(
      runInput({ prompt: "second dynamic prompt" }),
      new AbortController().signal,
    );
    assert.equal(second.content, "second dynamic answer");

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.reasoning_effort, "medium");
    assert.equal(requests[1]?.reasoning_effort, "high");
    const secondMessages = JSON.stringify(requests[1]?.messages);
    assert.match(secondMessages, /first dynamic prompt/u);
    assert.match(secondMessages, /first dynamic answer/u);
    assert.match(secondMessages, /second dynamic prompt/u);
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("conversation model pins keep independent live Pi sessions", async () => {
  const requests: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    assert.equal(body.stream, true);
    return openAiTextResponse(`answer-${requests.length}`, requests.length);
  };
  const runtime = new PiMobileAgentRuntime({
    modelConfigProvider: async (profileId) => ({
      baseUrl: "https://fixture.invalid/v1",
      model: profileId === "profile-b" ? "model-b" : "model-a",
      apiKey: "fixture-api-key",
      contextWindow: profileId === "profile-b" ? 400_000 : 128_000,
      thinkingLevel: "medium",
      modelProfileId: profileId ?? "profile-a",
      capabilities: { vision: false, reasoning: true },
    }),
    registryFactory: () => ({}) as never,
  });

  try {
    assert.deepEqual(
      await runtime.contextUsage("conversation-b", {
        modelProfileId: "profile-b",
        estimatedUsedTokens: 321,
      }),
      {
        contextWindow: 400_000,
        usedTokens: 321,
        remainingTokens: 399_679,
        compactionThresholdTokens: 383_616,
        estimated: true,
      },
    );
    await runtime.run(
      runInput({
        conversationId: "conversation-a",
        modelProfileId: "profile-a",
        prompt: "prompt-a-one",
      }),
      new AbortController().signal,
    );
    await runtime.run(
      runInput({
        conversationId: "conversation-b",
        modelProfileId: "profile-b",
        prompt: "prompt-b-one",
      }),
      new AbortController().signal,
    );
    await runtime.run(
      runInput({
        conversationId: "conversation-a",
        modelProfileId: "profile-a",
        prompt: "prompt-a-two",
      }),
      new AbortController().signal,
    );

    assert.deepEqual(
      requests.map((request) => request.model),
      ["model-a", "model-b", "model-a"],
    );
    const finalMessages = JSON.stringify(requests[2]?.messages);
    assert.match(finalMessages, /prompt-a-one/u);
    assert.match(finalMessages, /answer-1/u);
    assert.match(finalMessages, /prompt-a-two/u);
    assert.doesNotMatch(finalMessages, /prompt-b-one/u);
    const actualUsage = await runtime.contextUsage("conversation-a", {
      modelProfileId: "profile-a",
      estimatedUsedTokens: 0,
    });
    assert.equal(actualUsage.contextWindow, 128_000);
    assert.equal(actualUsage.estimated, false);
    assert.ok(actualUsage.usedTokens > 0);
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("project Skills use the upstream catalog with a mobile reader", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("skill_read", { name: "project-work" }), {
      stopReason: "toolUse",
    }),
    (context) => {
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, /\\"id\\":\\"project-work\\"/u);
      assert.match(transcript, /SKILL-FULL-INSTRUCTIONS/u);
      return fauxAssistantMessage("已按项目规划 Skill 完成分析。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => ({}) as never,
  });

  const output = await runtime.run(
    runInput({
      skills: [
        {
          id: "project-work",
          name: "项目规划",
          description: "把目标拆分为可执行阶段，并指出依赖关系。",
          content: "SKILL-FULL-INSTRUCTIONS：先识别依赖，再给出验收标准。",
          risk: "read",
          enabled: true,
          scope: "project",
          projectIds: [shellProject.id],
        },
      ],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已按项目规划 Skill 完成分析。");
  assert.equal(faux.state.callCount, 3);
  await runtime.dispose();
});

test("the Agent receives the owning project and shared workspace contract", async () => {
  const resource = shellResource();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(
        context.systemPrompt ?? "",
        /Conversations in the same project share that workspace/u,
      );
      assert.match(
        context.systemPrompt ?? "",
        /isolated message and Agent-session history/u,
      );
      assert.match(context.systemPrompt ?? "", /virtual \/project tree/u);
      assert.match(context.systemPrompt ?? "", /untrusted data/u);
      return fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      const content = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const value = JSON.parse(content) as {
        conversation: {
          id: string;
          projectId: string;
          historySharedWithOtherConversations: boolean;
        };
        project: { id: string; name: string };
        workspace: {
          root: string;
          sharedAcrossProjectConversations: boolean;
          files: string[];
          memory: {
            authority: string;
            durable: string;
            recent: string;
            summaries: string;
            evidence: string;
            writesUseAutomaticDiffApply: boolean;
          };
          learning: {
            rules: string;
            durableRecall: string;
            workingNotes: string;
            reusableWorkflows: string;
            usesAutomaticDiffApplyForRulesAndWorkflows: boolean;
          };
        };
      };
      assert.deepEqual(value.conversation, {
        id: "conversation-project-contract",
        projectId: shellProject.id,
        historySharedWithOtherConversations: false,
      });
      assert.deepEqual(value.project, {
        id: shellProject.id,
        name: shellProject.name,
        description: shellProject.description,
        instructions: shellProject.instructions,
      });
      assert.deepEqual(value.workspace, {
        root: "/project",
        sharedAcrossProjectConversations: true,
        files: [],
        memory: {
          authority: "recall-only",
          durable: "/project/MEMORY.md",
          recent: "/project/memory/RECENT.md",
          summaries: "/project/memory/SUMMARIES.md",
          evidence: "/project/memory/EVIDENCE.md",
          writesUseAutomaticDiffApply: true,
        },
        learning: {
          rules: "/project/AGENTS.md",
          durableRecall: "/project/MEMORY.md",
          workingNotes: "/project/NOTES.md",
          reusableWorkflows: "/project/skills/*/SKILL.md",
          usesAutomaticDiffApplyForRulesAndWorkflows: true,
        },
      });
      return fauxAssistantMessage("已确认当前项目工作区。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-project-contract",
      project: shellProject,
      resources: [resource],
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已确认当前项目工作区。");
  await runtime.dispose();
});

test("a learned project memory is staged at the root and never written silently", async () => {
  const bundle = createProjectWithWorkspace({
    id: "project-memory",
    name: "Memory project",
  });
  const memory = bundle.resources.find(
    (resource) => resource.path === "MEMORY.md",
  )!;
  const before = memory.content;
  const after = `${before.trimEnd()}\n\n- 用户确认发布窗口为每周五。\n`;
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(context.systemPrompt ?? "", /helpful recall layer/u);
      assert.match(context.systemPrompt ?? "", /Do not force a memory update/u);
      return fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage(
      fauxToolCall("edit", {
        path: "/project/MEMORY.md",
        oldText: before,
        newText: after,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已生成记忆更新 Diff，等待审阅。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor(bundle.resources),
    projectShellJavaScriptRuntime: null,
  });

  const output = await runtime.run(
    runInput({
      project: bundle.project,
      prompt: "以后每周五发布。",
      resources: bundle.resources,
    }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 1);
  assert.equal(output.proposal?.hunks[0]?.resourceId, memory.id);
  assert.equal(output.proposal?.hunks[0]?.target, "MEMORY.md");
  assert.equal(output.proposal?.hunks[0]?.after, after);
  assert.equal(memory.content, before);
  await runtime.dispose();
});

test("credential access is approved once, omitted from durable history, and masked in chat", async () => {
  const secret = "MOBILE-CREDENTIAL-FIXTURE";
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("credential_vault_list", {}), {
      stopReason: "toolUse",
    }),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.match(JSON.stringify(result.content), /Production password/u);
      assert.doesNotMatch(
        JSON.stringify(result.content),
        new RegExp(secret, "u"),
      );
      return fauxAssistantMessage(
        fauxToolCall("credential_access_request", {
          credentialId: credentialFixture.id,
          purpose: "Authenticate to the project service for this task",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, new RegExp(secret, "u"));
      assert.doesNotMatch(transcript, /BOLTPOCKET_CREDENTIAL/u);
      return fauxAssistantMessage(`凭据内容是 ${secret}`);
    },
  ]);
  const core = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: core,
    credentialAccess: credentialAccessFixture(secret),
    registryFactory: () => registryFor([]),
  });
  let modelActivityEvents = 0;

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-credential-once",
      project: shellProject,
    }),
    new AbortController().signal,
    (event) => {
      if (event.type === "model-activity") modelActivityEvents += 1;
    },
  );

  assert.equal(
    output.content,
    "密码本读取已完成；敏感内容未显示，也未传入其他工具。",
  );
  assert.ok(modelActivityEvents > 0);
  const persisted =
    persistence.values.get("conversation:conversation-credential-once") ?? "";
  assert.doesNotMatch(persisted, new RegExp(secret, "u"));
  assert.doesNotMatch(persisted, /BOLTPOCKET_CREDENTIAL/u);
  await runtime.dispose();
});

test("a model cannot move or transform an approved credential through another tool call", async () => {
  const secret = "TOOL-ARG-CREDENTIAL-FIXTURE";
  let accessRequests = 0;
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("credential_access_request", {
        credentialId: credentialFixture.id,
        purpose: "Read once for the approved project task",
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      assert.match(JSON.stringify(context.messages), new RegExp(secret, "u"));
      return fauxAssistantMessage(
        fauxToolCall("credential_access_request", {
          credentialId: secret.toLowerCase(),
          purpose: "Attempt to forward a transformed secret",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const transcript = JSON.stringify(context.messages);
      assert.doesNotMatch(transcript, new RegExp(secret, "u"));
      assert.match(transcript, /密码本读取后，本轮不能再调用其他工具/u);
      return fauxAssistantMessage("已阻止秘密进入工具参数。 ");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
      sessionPersistence: persistence,
    }),
    credentialAccess: credentialAccessFixture(secret, () => {
      accessRequests += 1;
    }),
    registryFactory: () => registryFor([]),
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-credential-tool-policy",
      project: shellProject,
    }),
    new AbortController().signal,
  );

  assert.equal(
    output.content,
    "密码本读取已完成；敏感内容未显示，也未传入其他工具。",
  );
  assert.equal(accessRequests, 1);
  assert.doesNotMatch(
    persistence.values.get(
      "conversation:conversation-credential-tool-policy",
    ) ?? "",
    new RegExp(secret, "u"),
  );
  await runtime.dispose();
});

test("a session that used a credential never streams a later exact-value echo", async () => {
  const secret = "LATER-STREAM-CREDENTIAL-FIXTURE";
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("credential_access_request", {
        credentialId: credentialFixture.id,
        purpose: "Read once for the approved project task",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("首次读取已完成。"),
    fauxAssistantMessage(`后续意外回显 ${secret}`),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    credentialAccess: credentialAccessFixture(secret),
    registryFactory: () => registryFor([]),
  });
  const conversationId = "conversation-credential-later-stream";

  await runtime.run(
    runInput({ conversationId, project: shellProject }),
    new AbortController().signal,
  );
  let modelActivityEvents = 0;
  const output = await runtime.run(
    runInput({
      conversationId,
      project: shellProject,
      prompt: "继续这个任务。",
    }),
    new AbortController().signal,
    (event) => {
      if (event.type === "model-activity") modelActivityEvents += 1;
    },
  );

  assert.equal(output.content, "后续意外回显 ••••");
  assert.ok(modelActivityEvents > 0);
  await runtime.dispose();
});

test("a persisted sensitive session is rebuilt without exposing later model deltas", async () => {
  const secret = "ROTATED-SESSION-CREDENTIAL-FIXTURE";
  const persistence = new MemorySessionPersistence();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("credential_access_request", {
        credentialId: credentialFixture.id,
        purpose: "Read once for the approved project task",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("敏感步骤完成。"),
    fauxAssistantMessage("普通后续回复。"),
  ]);
  const core = new PiAgentRuntime({
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    sessionPersistence: persistence,
  });
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: core,
    sessionPersistence: persistence,
    credentialAccess: credentialAccessFixture(secret),
    registryFactory: () => registryFor([]),
  });
  const conversationId = "conversation-credential-session-rotation";

  await runtime.run(
    runInput({ conversationId, project: shellProject }),
    new AbortController().signal,
  );
  let modelActivityEvents = 0;
  const output = await runtime.run(
    runInput({
      conversationId,
      project: shellProject,
      prompt: "继续普通任务。",
    }),
    new AbortController().signal,
    (event) => {
      if (event.type === "model-activity") modelActivityEvents += 1;
    },
  );

  assert.equal(output.content, "普通后续回复。");
  assert.ok(modelActivityEvents > 0);
  assert.doesNotMatch(
    persistence.values.get(`conversation:${conversationId}`) ?? "",
    new RegExp(secret, "u"),
  );
  await runtime.dispose();
});

test("project context rejects connector resources owned by another project", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    (context) => {
      const result = context.messages.at(-1);
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /其他项目的资源/u);
      return fauxAssistantMessage("已拒绝跨项目资源。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () =>
      ({
        descriptors: () => [],
        listResources: async () => [
          {
            connectorId: "foreign-connector",
            accountId: "foreign-account",
            resourceId: "foreign-resource",
            projectId: "another-project",
            kind: "text",
            displayName: "foreign.txt",
            locator: "foreign.txt",
          },
        ],
      }) as never,
  });

  const output = await runtime.run(
    runInput({
      conversationId: "conversation-foreign-ref",
      project: shellProject,
    }),
    new AbortController().signal,
  );

  assert.equal(output.content, "已拒绝跨项目资源。");
  await runtime.dispose();
});

test("one conversation cannot be rebound to another project", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([fauxAssistantMessage("项目 A 会话已建立。")]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([]),
  });
  const conversationId = "conversation-stable-project";

  try {
    await runtime.run(
      runInput({ conversationId, project: shellProject }),
      new AbortController().signal,
    );
    await assert.rejects(
      runtime.run(
        runInput({
          conversationId,
          project: {
            ...shellProject,
            id: "another-project",
            name: "Another project",
          },
        }),
        new AbortController().signal,
      ),
      /同一对话不能切换到另一个项目/u,
    );
    assert.equal(faux.state.callCount, 1);
  } finally {
    await runtime.dispose();
  }
});

test("steering is rejected after the conversation run becomes idle", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([fauxAssistantMessage("任务已经完成。")]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => ({}) as never,
  });
  const conversationId = "conversation-idle-steer";

  try {
    await runtime.run(
      runInput({ conversationId }),
      new AbortController().signal,
    );
    await assert.rejects(
      runtime.steer(conversationId, "不应进入下一轮"),
      /没有正在运行的 Agent 会话/u,
    );
  } finally {
    await runtime.dispose();
  }
});

test("concurrent runs cannot replace one conversation's active tool context", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([fauxAssistantMessage("首个任务完成。")]);
  let signalRegistryEntered: () => void = () => undefined;
  let releaseRegistry: () => void = () => undefined;
  const registryEntered = new Promise<void>((resolve) => {
    signalRegistryEntered = resolve;
  });
  const registryGate = new Promise<void>((resolve) => {
    releaseRegistry = resolve;
  });
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: async () => {
      signalRegistryEntered();
      await registryGate;
      return {} as never;
    },
  });
  const input = runInput({ conversationId: "conversation-concurrent" });
  const first = runtime.run(input, new AbortController().signal);

  try {
    await registryEntered;
    await assert.rejects(
      runtime.run(
        { ...input, runId: "run-concurrent-second" },
        new AbortController().signal,
      ),
      /当前对话已有正在运行的任务/u,
    );
    releaseRegistry();
    assert.equal((await first).content, "首个任务完成。");
    assert.equal(faux.state.callCount, 1);
  } finally {
    releaseRegistry();
    await first.catch(() => undefined);
    await runtime.dispose();
  }
});

test(
  "three different conversations can execute in the upstream core concurrently",
  { timeout: 2_000 },
  async () => {
    const faux = createFauxCore({ tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage("任务一完成。"),
      fauxAssistantMessage("任务二完成。"),
      fauxAssistantMessage("任务三完成。"),
    ]);
    let entered = 0;
    let signalAllEntered: () => void = () => undefined;
    let releaseRegistries: () => void = () => undefined;
    const allEntered = new Promise<void>((resolve) => {
      signalAllEntered = resolve;
    });
    const registryGate = new Promise<void>((resolve) => {
      releaseRegistries = resolve;
    });
    const runtime = new PiMobileAgentRuntime({
      coreRuntime: new PiAgentRuntime({
        model: faux.getModel(),
        streamFn: faux.streamSimple,
      }),
      registryFactory: async () => {
        entered += 1;
        if (entered === 3) signalAllEntered();
        await registryGate;
        return {} as never;
      },
    });
    const runs = ["one", "two", "three"].map((suffix) =>
      runtime.run(
        runInput({
          runId: `run-${suffix}`,
          conversationId: `conversation-${suffix}`,
        }),
        new AbortController().signal,
      ),
    );

    try {
      await allEntered;
      assert.equal(entered, 3);
      releaseRegistries();
      const outputs = await Promise.all(runs);
      assert.deepEqual(
        new Set(outputs.map((output) => output.content)),
        new Set(["任务一完成。", "任务二完成。", "任务三完成。"]),
      );
      assert.equal(faux.state.callCount, 3);
    } finally {
      releaseRegistries();
      await Promise.all(runs.map((run) => run.catch(() => undefined)));
      await runtime.dispose();
    }
  },
);

test("bash reads an authorized resource without creating a proposal", async () => {
  const resource = shellResource();
  const resourceBefore = JSON.stringify(resource);
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "cat /project/workspace/notes.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已读取项目文件。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
  });
  const labels: string[] = [];

  const output = await runtime.run(
    runInput({
      project: shellProject,
      resources: [resource],
    }),
    new AbortController().signal,
    (event) => {
      if (event.type === "tool-started") labels.push(event.label);
    },
  );

  assert.equal(output.proposal, undefined);
  assert.equal(JSON.stringify(resource), resourceBefore);
  assert.deepEqual(labels, [
    "读取项目上下文",
    "运行：cat /project/workspace/notes.txt",
  ]);
  assert.deepEqual(output.toolActivity, [
    "读取项目上下文 · 完成",
    "运行：cat /project/workspace/notes.txt · 完成",
  ]);
  assert.equal(faux.state.callCount, 3);
  await runtime.dispose();
});

test("upstream read refreshes only its target in a larger project", async () => {
  const resources = Array.from({ length: 9 }, (_, index) =>
    shellResource({
      id: `shell-${index}`,
      path: `file-${index}.txt`,
      content: `content-${index}\n`,
    }),
  );
  const connectorReads: string[] = [];
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("read", {
        path: "/project/workspace/file-8.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("只读取了指定资源。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () =>
      registryFor(resources, (resourceId) => connectorReads.push(resourceId)),
    projectShellJavaScriptRuntime: null,
  });

  const output = await runtime.run(
    runInput({
      project: { ...shellProject, resourceCount: resources.length },
      resources,
    }),
    new AbortController().signal,
  );

  assert.equal(output.proposal, undefined);
  assert.deepEqual(connectorReads, ["shell-8"]);
  await runtime.dispose();
});

test("bash stages many text edits as one Diff proposal without writing", async () => {
  const first = shellResource();
  const second = shellResource({
    id: "shell-plan",
    path: "plan.txt",
    content: "alpha plan\n",
  });
  const resourcesBefore = JSON.stringify([first, second]);
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: [
          "sed 's/alpha/beta/' /project/workspace/notes.txt > /project/workspace/notes.txt",
          "sed 's/alpha/beta/' /project/workspace/plan.txt > /project/workspace/plan.txt",
        ].join("; "),
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已生成批量 Diff，等待审阅。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([first, second]),
  });

  const output = await runtime.run(
    runInput({
      project: { ...shellProject, resourceCount: 2 },
      resources: [first, second],
    }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 2);
  assert.deepEqual(
    output.proposal?.hunks.map((hunk) => [hunk.resourceId, hunk.after]),
    [
      ["shell-notes", "beta\nsecond\n"],
      ["shell-plan", "beta plan\n"],
    ],
  );
  assert.equal(JSON.stringify([first, second]), resourcesBefore);
  assert.ok(
    output.proposal?.hunks.every((hunk) =>
      hunk.lines.some((line) => line.kind === "addition"),
    ),
  );
  await runtime.dispose();
});

test("bash refreshes connector snapshots before building a Diff baseline", async () => {
  const cached = shellResource({ content: "stale\n", version: "1" });
  const current = shellResource({ content: "alpha current\n", version: "2" });
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command:
          "sed 's/alpha/beta/' /project/workspace/notes.txt > /project/workspace/notes.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已基于连接器最新版本生成 Diff。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([current]),
  });

  const output = await runtime.run(
    runInput({
      project: shellProject,
      resources: [cached],
    }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks[0]?.before, "alpha current\n");
  assert.equal(output.proposal?.hunks[0]?.after, "beta current\n");
  assert.equal(output.proposal?.hunks[0]?.baseVersion, "2");
  assert.equal(cached.content, "stale\n");
  assert.equal(cached.version, "1");
  await runtime.dispose();
});

test("bash routes js-exec through the injected isolated runtime", async () => {
  const resource = shellResource();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(
        context.systemPrompt ?? "",
        /bash js-exec command only for an existing project script or a shell pipeline/u,
      );
      assert.match(context.systemPrompt ?? "", /piped data is input\.stdin/u);
      return fauxAssistantMessage(
        fauxToolCall("bash", {
          command:
            "printf payload | js-exec --input-file /project/workspace/notes.txt -c 'input.cwd'",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("隔离 JavaScript 已执行。"),
  ]);
  const calls: {
    source: string;
    cwd: string;
    stdin: string;
    files: { path: string; contents: string }[];
  }[] = [];
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
    projectShellJavaScriptRuntime: {
      async execute(input) {
        calls.push({
          source: input.source,
          cwd: input.cwd,
          stdin: input.stdin,
          files: [...input.files],
        });
        return {
          stdout: "",
          stderr: "",
          result: "/project",
          exitCode: 0,
        };
      },
    },
  });

  const output = await runtime.run(
    runInput({ project: shellProject, resources: [resource] }),
    new AbortController().signal,
  );

  assert.equal(output.proposal, undefined);
  assert.deepEqual(calls, [
    {
      source: "input.cwd",
      cwd: "/project",
      stdin: "payload",
      files: [
        {
          path: "/project/workspace/notes.txt",
          contents: resource.content,
        },
      ],
    },
  ]);
  await runtime.dispose();
});

test("first-class js_exec exposes selected input and structured results", async () => {
  const resource = shellResource();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.match(
        context.systemPrompt ?? "",
        /Use the first-class js_exec tool for exact non-trivial calculations/u,
      );
      assert.match(
        context.systemPrompt ?? "",
        /exceed Number\.MAX_SAFE_INTEGER, use BigInt literals/u,
      );
      assert.match(
        context.systemPrompt ?? "",
        /final expression is returned automatically/u,
      );
      return fauxAssistantMessage(
        fauxToolCall("js_exec", {
          code: "(2n ** 127n - 1n) % 97n",
          stdin: "payload",
          files: ["/project/workspace/notes.txt"],
          args: ["exact"],
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("精确结果为 65。"),
  ]);
  const calls: {
    source: string;
    stdin: string;
    args: readonly string[];
    files: readonly { path: string; contents: string }[];
  }[] = [];
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
    projectShellJavaScriptRuntime: {
      async execute(input) {
        calls.push({
          source: input.source,
          stdin: input.stdin,
          args: input.args,
          files: input.files,
        });
        return {
          stdout: "",
          stderr: "",
          result: "65",
          exitCode: 0,
        };
      },
    },
  });

  const output = await runtime.run(
    runInput({ project: shellProject, resources: [resource] }),
    new AbortController().signal,
  );

  assert.equal(output.content, "精确结果为 65。");
  assert.equal(output.proposal, undefined);
  assert.match(output.toolActivity?.[0] ?? "", /^运行计算：/u);
  assert.deepEqual(calls, [
    {
      source: "(2n ** 127n - 1n) % 97n",
      stdin: "payload",
      args: ["exact"],
      files: [
        {
          path: "/project/workspace/notes.txt",
          contents: resource.content,
        },
      ],
    },
  ]);
  await runtime.dispose();
});

test("bash registers mobile yq and turns its in-place edit into one Diff", async () => {
  const resource = shellResource({
    path: "config.yaml",
    content: "value: 1\n",
  });
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "yq -i '.value = 2' /project/workspace/config.yaml",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已生成 YAML 修改 Diff。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
    projectShellJavaScriptRuntime: null,
  });

  const output = await runtime.run(
    runInput({ project: shellProject, resources: [resource] }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 1);
  assert.equal(output.proposal?.hunks[0]?.before, "value: 1\n");
  assert.equal(output.proposal?.hunks[0]?.after, "value: 2\n");
  assert.equal(resource.content, "value: 1\n");
  await runtime.dispose();
});

test("bash forwards SSH commands and still stages local project downloads", async () => {
  const resource = shellResource();
  const calls: string[] = [];
  const transport: SshProjectShellTransport = {
    async execute(sessionId, command, options) {
      calls.push(
        `execute:${sessionId}:${command}:${options.maxOutputBytes}:${options.timeoutMs}`,
      );
      return { stdout: "updated\n", stderr: "", exitCode: 0 };
    },
    async diagnose(sessionId) {
      calls.push(`diagnose:${sessionId}`);
      return { stdout: "healthy\n", stderr: "", exitCode: 0 };
    },
    async stat(sessionId, path) {
      calls.push(`stat:${sessionId}:${path}`);
      if (path === "/srv") {
        return { path, name: "srv", type: "directory", size: 0 };
      }
      if (path === "/srv/project") {
        return {
          path,
          name: "project",
          type: "directory",
          size: 0,
        };
      }
      if (path === "/srv/project/notes.txt") {
        return { path, name: "notes.txt", type: "file", size: 6 };
      }
      return null;
    },
    async list() {
      return [];
    },
    async readText(sessionId, path) {
      calls.push(`read:${sessionId}:${path}`);
      return "remote\n";
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "sftp production cat notes.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "scp production:notes.txt /project/workspace/notes.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "ssh production -- 'touch marker'",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("远程检查完成。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
    projectShellJavaScriptRuntime: null,
    sshProjectShellTransportFactory: () => transport,
    sshProjectShellSessionsProvider: () => [
      {
        profileId: "ssh-0123456789abcdef",
        credentialId: credentialFixture.id,
        projectId: shellProject.id,
        alias: "production",
        sessionId: "session-main",
        root: "/srv/project",
        account: "deploy@server.internal:22",
        access: "session",
        verification: "ssh-ed25519 SHA256:fixture",
      },
    ],
  });

  const output = await runtime.run(
    runInput({ project: shellProject, resources: [resource] }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 1);
  assert.equal(output.proposal?.hunks[0]?.before, "alpha\nsecond\n");
  assert.equal(output.proposal?.hunks[0]?.after, "remote\n");
  assert.ok(calls.includes("read:session-main:/srv/project/notes.txt"));
  assert.ok(calls.includes("execute:session-main:touch marker:1000000:60000"));
  await runtime.dispose();
});

test("bash-created project files become create Diff hunks without mutating input", async () => {
  const workspace = createProjectWithWorkspace({
    id: shellProject.id,
    name: shellProject.name,
  });
  const resourcesBefore = JSON.stringify(workspace.resources);
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "printf '<h1>Created</h1>\\n' > /project/index.html",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("已创建 /project/index.html。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor(workspace.resources),
  });

  const output = await runtime.run(
    runInput({
      project: workspace.project,
      resources: workspace.resources,
    }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 1);
  assert.equal(output.proposal?.hunks[0]?.operation, "create");
  assert.equal(output.proposal?.hunks[0]?.target, "index.html");
  assert.equal(output.proposal?.hunks[0]?.before, "");
  assert.equal(output.proposal?.hunks[0]?.after, "<h1>Created</h1>\n");
  assert.equal(JSON.stringify(workspace.resources), resourcesBefore);
  assert.equal(output.content, "已创建 /project/index.html。");
  await runtime.dispose();
});

test("an empty model ending after tools continues once for a real summary", async () => {
  const resource = shellResource();
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("project_context_read", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "sed -i 's/alpha/beta/' /project/workspace/notes.txt",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(""),
    fauxAssistantMessage("已修改 notes.txt，可在 Diff 中审查。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([resource]),
  });

  const output = await runtime.run(
    runInput({ project: shellProject, resources: [resource] }),
    new AbortController().signal,
  );

  assert.equal(output.proposal?.hunks.length, 1);
  assert.equal(output.content, "已修改 notes.txt，可在 Diff 中审查。");
  assert.equal(faux.state.callCount, 4);
  await runtime.dispose();
});

test("a completely empty model turn fails clearly instead of claiming success", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([fauxAssistantMessage("")]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    registryFactory: () => registryFor([]),
  });

  await assert.rejects(
    runtime.run(runInput(), new AbortController().signal),
    /模型没有返回有效回答/u,
  );
  await runtime.dispose();
});

test("deleting a conversation purges its encrypted Pi session tree", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([fauxAssistantMessage("已完成")]);
  const persistence = new MemorySessionPersistence();
  const core = new PiAgentRuntime({
    model: faux.getModel(),
    sessionPersistence: persistence,
    streamFn: faux.streamSimple,
  });
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: core,
    registryFactory: () => registryFor([]),
    sessionPersistence: persistence,
  });

  await runtime.run(runInput(), new AbortController().signal);
  assert.ok(persistence.values.has("conversation:conversation-workflow"));

  await runtime.deleteConversation("conversation-workflow");

  assert.equal(
    persistence.values.has("conversation:conversation-workflow"),
    false,
  );
  await runtime.deleteConversation("conversation-workflow");
  await runtime.dispose();
});

test("releasing conversation resources drops plaintext context but keeps encrypted history", async () => {
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage("第一次完成"),
    fauxAssistantMessage("第二次完成"),
  ]);
  const persistence = new MemorySessionPersistence();
  const core = new PiAgentRuntime({
    model: faux.getModel(),
    sessionPersistence: persistence,
    streamFn: faux.streamSimple,
  });
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: core,
    registryFactory: () => registryFor([]),
    sessionPersistence: persistence,
  });

  await runtime.run(runInput(), new AbortController().signal);
  await runtime.releaseConversationResources("conversation-workflow");
  assert.ok(persistence.values.has("conversation:conversation-workflow"));

  const output = await runtime.run(
    runInput({ runId: "run-workflow-2" }),
    new AbortController().signal,
  );
  assert.equal(output.content, "第二次完成");
  await runtime.dispose();
});
