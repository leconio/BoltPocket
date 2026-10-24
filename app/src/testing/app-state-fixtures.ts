import type { AppState } from "../domain/app-state-model.ts";
import type {
  ChangeProposal,
  ChatMessage,
  ConnectionItem,
  MemoryItem,
  Project,
  SkillItem,
  WorkspaceResource,
} from "../domain/models.ts";
import { createProjectWorkspaceBundle } from "../domain/project-workspace.ts";
import { createTextDiffLines } from "../domain/text-diff.ts";

export const projects: Project[] = [
  {
    id: "launch",
    name: "Q3 产品发布",
    symbol: "Q3",
    description: "长期维护产品发布计划",
    instructions:
      "使用简体中文；优先给出结论；修改自动落盘并保留文字 Diff 供审查。",
    memoryCount: 4,
    skillCount: 2,
    connectionCount: 3,
    resourceCount: 2,
  },
  {
    id: "support",
    name: "客户支持",
    symbol: "CS",
    description: "统一处理知识与回复策略",
    instructions: "语气友好、准确；不确定时明确说明。",
    memoryCount: 2,
    skillCount: 1,
    connectionCount: 0,
    resourceCount: 0,
  },
  {
    id: "research",
    name: "个人研究",
    symbol: "R",
    description: "收集观点并追踪长期问题",
    instructions: "区分事实与推断，保留引用。",
    memoryCount: 2,
    skillCount: 1,
    connectionCount: 0,
    resourceCount: 0,
  },
];

export const memories: MemoryItem[] = [
  {
    id: "memory-language",
    text: "输出默认使用简体中文。",
    scope: "global",
    source: "用户添加",
    pinned: true,
  },
  {
    id: "memory-diff",
    text: "修改自动落盘，同时保留文字 Diff 供审查与撤销。",
    scope: "project",
    source: "项目指令",
    projectIds: ["launch"],
    pinned: true,
  },
  {
    id: "memory-conclusion",
    text: "优先给出结论，再解释必要过程。",
    scope: "project",
    source: "用户添加",
    projectIds: ["launch", "support"],
  },
  {
    id: "memory-terms",
    text: "术语第一次出现时补充简短解释。",
    scope: "project",
    source: "Agent 学习",
    projectIds: ["launch", "research"],
  },
];

export const skills: SkillItem[] = [
  {
    id: "planning",
    name: "项目规划",
    description: "把目标拆分为可执行阶段，并指出依赖关系。",
    content: [
      "# 项目规划",
      "先读取当前项目上下文，只在需要时读取明确授权的资源。",
      "明确目标、约束、依赖和验收标准，再按依赖顺序拆成可执行阶段。",
      "区分已知事实、合理假设和待确认事项；不要虚构资源内容或完成状态。",
      "此 Skill 只给出规划，不修改任何外部状态。",
    ].join("\n\n"),
    risk: "read",
    enabled: true,
    scope: "global",
    projectIds: [],
  },
  {
    id: "rewrite",
    name: "内容改写",
    description: "生成可审阅的 TextPatch，由宿主校验后自动写入。",
    content: [
      "# 内容改写",
      "修改前读取每个目标资源的当前版本和完整正文。",
      "保留原意、事实和未要求变更的结构，并清楚说明每项改写原因。",
      "所有修改必须形成一个确定性的文字 Diff；Agent 不得绕过宿主直接写入连接器，宿主完成版本检查、恢复点和自动应用后才能报告已保存。",
    ].join("\n\n"),
    risk: "propose",
    enabled: true,
    scope: "project",
    projectIds: ["launch", "support"],
  },
  {
    id: "extract",
    name: "信息提取",
    description: "从本次已授权的资源中提取结构化信息。",
    content: [
      "# 信息提取",
      "只从本轮明确授权且实际读取的资源提取信息。",
      "输出字段稳定的结构化结果，并为每项结论标明对应资源。",
      "缺失信息保持为空或明确标注未知，不进行推测；不得修改资源。",
    ].join("\n\n"),
    risk: "read",
    enabled: false,
    scope: "global",
    projectIds: [],
  },
  {
    id: "checks",
    name: "自动化检查",
    description: "运行只读检查并解释结果。",
    content: [
      "# 自动化检查",
      "先确认检查范围，再使用项目内有界命令读取或分析已授权文本资源。",
      "报告执行的检查、观察到的证据、失败项和可复现步骤。",
      "不得创建、删除或覆盖文件；需要修复时只提出文字 Diff，由宿主校验后自动应用。",
    ].join("\n\n"),
    risk: "read",
    enabled: false,
    scope: "project",
    projectIds: ["launch"],
  },
];

export const connections: ConnectionItem[] = [
  {
    id: "cloud-drive",
    projectId: "launch",
    name: "Cloud Drive",
    account: "work@example.com",
    scope: "/Q3 Launch",
    status: "connected",
    resourceCount: 4,
    access: "persistent",
    writeMode: "recoverable",
  },
  {
    id: "workspace",
    projectId: "launch",
    name: "Workspace",
    account: "Product Space",
    scope: "Q3 项目范围",
    status: "connected",
    resourceCount: 2,
    access: "persistent",
    writeMode: "atomic",
  },
  {
    id: "remote-files",
    projectId: "launch",
    name: "Remote Files",
    account: "production-docs",
    scope: "受限工作区",
    status: "connected",
    resourceCount: 6,
    access: "persistent",
    writeMode: "recoverable",
  },
];

export const workspaceResources: Record<string, WorkspaceResource> = {
  "launch-instructions": {
    id: "launch-instructions",
    projectId: "launch",
    connectionId: "workspace",
    path: "project/instructions.txt",
    content:
      "使用简体中文。\n回答尽量详细。\n修改现有文本时形成 Diff，由宿主校验后自动写入。\n",
    version: "18",
    storage: { kind: "memory" },
  },
  "launch-release-plan": {
    id: "launch-release-plan",
    projectId: "launch",
    connectionId: "workspace",
    path: "workspace/release-plan.txt",
    content: "完成需求冻结\n完成内部验证\n准备发布\n",
    version: "18",
    storage: { kind: "memory" },
  },
};

const instructions = workspaceResources["launch-instructions"]!;
const releasePlan = workspaceResources["launch-release-plan"]!;
const nextInstructions =
  "使用简体中文。\n优先给出结论，再解释必要过程。\n重要判断附上依据。\n修改现有文本时形成 Diff，由宿主校验后自动写入。\n";
const nextReleasePlan = "完成需求冻结\n完成内部验证\n补充回滚演练\n准备发布\n";

export const proposal: ChangeProposal = {
  id: "proposal-launch-plan",
  projectId: "launch",
  conversationId: "conversation-launch",
  title: "调整项目指令与发布计划",
  kind: "agent",
  status: "pending",
  connectorId: "workspace",
  connector: "Workspace",
  createdAt: "2026-08-03T00:00:00.000Z",
  hunks: [
    {
      id: "instructions",
      resourceId: instructions.id,
      target: instructions.path,
      baseVersion: instructions.version,
      before: instructions.content,
      after: nextInstructions,
      summary: "减少冗余，并明确依据要求",
      lines: createTextDiffLines(
        instructions.path,
        instructions.content,
        nextInstructions,
      ),
    },
    {
      id: "release-plan",
      resourceId: releasePlan.id,
      target: releasePlan.path,
      baseVersion: releasePlan.version,
      before: releasePlan.content,
      after: nextReleasePlan,
      summary: "在发布前补充回滚演练",
      lines: createTextDiffLines(
        releasePlan.path,
        releasePlan.content,
        nextReleasePlan,
      ),
    },
  ],
};

export const launchMessages: ChatMessage[] = [
  {
    id: "message-user-1",
    role: "user",
    content: "根据项目现状整理下一阶段，并把需要调整的内容做成修改提案。",
  },
  {
    id: "message-assistant-1",
    role: "assistant",
    content:
      "下一阶段建议先完成内部验证与回滚演练，再准备发布。修改会自动落盘，并保留文字 Diff 供审查。",
    context: [
      {
        id: "context-memory",
        kind: "memory",
        label: "记忆 2",
        detail: "简体中文；修改自动落盘并可审查",
      },
      {
        id: "context-skill",
        kind: "skill",
        label: "Skill 1",
        detail: "项目规划",
      },
      {
        id: "context-connection",
        kind: "connection",
        label: "连接器 1",
        detail: "Workspace / Q3 项目范围",
      },
    ],
  },
];

const projectWorkspaceBundles = projects.map((project) =>
  createProjectWorkspaceBundle({ project, memories, skills }),
);
const projectWorkspaceResources = Object.fromEntries(
  projectWorkspaceBundles.flatMap((bundle) =>
    bundle.resources.map((resource) => [resource.id, resource]),
  ),
);

/** Explicit seeded state for unit tests only. Production never imports this file. */
export const seededAppState: AppState = {
  isHydrating: true,
  projects: Object.fromEntries(
    projects.map((project) => [project.id, project]),
  ),
  pinnedProjectIds: ["launch"],
  recentProjectIds: ["launch", "support", "research"],
  recentConversationIds: ["conversation-launch"],
  selectedProjectId: "launch",
  activeConversationId: "conversation-launch",
  conversationIdsByProject: { launch: "conversation-launch" },
  conversationProjectIds: { "conversation-launch": "launch" },
  conversationModelProfileIds: {},
  messages: launchMessages,
  messagesByConversation: { "conversation-launch": launchMessages },
  draft: "",
  isRunning: false,
  activeRunId: null,
  activeRunConversationId: null,
  activeRunRequest: null,
  retryableRun: null,
  runStatus: "",
  runError: null,
  activeRunsByConversation: {},
  retryableRunsByConversation: {},
  runErrorsByConversation: {},
  draftAttachments: [],
  autoApplyingProposalId: null,
  autoApplyingProposalIds: [],
  proposals: {},
  resources: { ...workspaceResources, ...projectWorkspaceResources },
  connections: Object.fromEntries(
    [
      ...connections,
      ...projectWorkspaceBundles.map((bundle) => bundle.connection),
    ].map((connection) => [connection.id, connection]),
  ),
  skillEnabledById: Object.fromEntries(
    skills
      .filter((skill) => skill.scope === "global")
      .map((skill) => [skill.id, skill.enabled]),
  ),
  globalMemoryTextById: {},
  globalSkillContentById: {},
  customGlobalMemories: {},
  customGlobalSkills: {},
  projectSkillEnabledByProjectId: Object.fromEntries(
    projects.map((project) => [
      project.id,
      Object.fromEntries(
        skills
          .filter(
            (skill) =>
              skill.scope === "project" &&
              skill.projectIds.includes(project.id),
          )
          .map((skill) => [skill.id, skill.enabled]),
      ),
    ]),
  ),
  projectResourcePackEnabledByProjectId: {},
  receipts: {},
  conversationCheckpoints: {},
  lastReceiptId: null,
  storageError: null,
};
