import type {
  McpRemoteClient,
  McpServerRuntimeDefinition,
} from "@boltpocket/mcp-client";

import type { SkillCapability } from "@/application/ports/capability-catalog";
import type {
  McpConnection,
  McpConnectionInput,
} from "@/application/ports/mcp-connections";
import type {
  AgentThirdPartyCapabilityPort,
  AssessThirdPartyCapabilityInput,
  InstallThirdPartyCapabilityInput,
  ThirdPartyCapabilityAssessment,
  ThirdPartyCapabilityCheck,
  ThirdPartyCapabilityInstallResult,
  ThirdPartyCapabilityRisk,
  ThirdPartyCapabilityRuntimeProfile,
  ThirdPartyMcpAuthentication,
} from "@/application/ports/third-party-capabilities";
import type { SkillAssessment } from "@/application/skill-assessment";
import { SKILL_BUNDLE_LIMITS } from "@/application/skill-bundle";
import { isExplicitCapabilityInstallConfirmation } from "@/application/capability-install-confirmation";
import type { AppLocale } from "@/i18n/translate";
import { isHttpsOrLocalNetworkHttpUrl } from "@boltpocket/connector-core";

const ASSESSMENT_TTL_MS = 30 * 60 * 1_000;
const EXPIRED_ASSESSMENT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_PENDING_ASSESSMENTS = 4;
const MAX_REVALIDATION_AUTHORIZATIONS = 4;
const MAX_MCP_TOOLS = 2_000;
const SAFE_MCP_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REPORT_FORMAT = "boltpocket-capability-diagnostic/v1" as const;

const SKILL_RUNTIME_PROFILE = Object.freeze({
  bundleInstallation: "complete-or-reject",
  inspection: "static-document-analysis",
  instructionsExecuted: false,
  javascript: Object.freeze({
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
  }),
  kind: "skill",
  maxBundleBytes: SKILL_BUNDLE_LIMITS.maxTotalBytes,
  maxBundleFiles: SKILL_BUNDLE_LIMITS.maxFiles,
  supportingFilesInstalled: true,
  unsupportedRuntimes: ["node", "python"] as const,
}) satisfies ThirdPartyCapabilityRuntimeProfile;

const MCP_RUNTIME_PROFILE = Object.freeze({
  businessToolsCalled: false,
  inspection: "handshake-ping-tools-list",
  kind: "mcp",
  supportedTransport: "streamable-http",
  unsupportedTransports: ["stdio", "legacy-sse", "websocket"] as const,
}) satisfies ThirdPartyCapabilityRuntimeProfile;

function diagnosticEnvironment(kind: "skill" | "mcp") {
  return {
    reportFormat: REPORT_FORMAT,
    runtime: kind === "skill" ? SKILL_RUNTIME_PROFILE : MCP_RUNTIME_PROFILE,
  } as const;
}

type SkillInstallResult = Readonly<{
  receiptId?: string;
  updateTracking: "saved" | "unavailable";
}>;

type ThirdPartyCapabilityServiceDependencies = Readonly<{
  authorizeMcpOAuth: (
    serverUrl: string,
  ) => Promise<Readonly<{ authorizationId: string }> | null>;
  connectMcp: (
    server: McpServerRuntimeDefinition,
    signal?: AbortSignal,
  ) => Promise<McpRemoteClient>;
  createAssessmentId: () => string;
  createMcpConnection: (input: McpConnectionInput) => Promise<McpConnection>;
  digest: (value: string) => Promise<string>;
  disconnectMcpOAuth: (authorizationId: string) => Promise<void>;
  installSkill: (
    capability: SkillCapability,
    projectId: string,
  ) => Promise<SkillInstallResult>;
  listMcpConnections: () => Promise<readonly McpConnection[]>;
  locale: AppLocale;
  now?: () => Date;
  probeMcpConnection: (connectionId: string) => Promise<unknown>;
  removeMcpConnection: (connectionId: string) => Promise<void>;
  resolveSkill: (url: string, signal?: AbortSignal) => Promise<SkillCapability>;
  skillAssessment: (
    capability: SkillCapability,
    projectId: string,
  ) => SkillAssessment;
  skillExists: (projectId: string, skillId: string) => boolean;
}>;

type PendingAssessment = Readonly<{
  assessedRunId: string;
  conversationId: string;
  createdAt: number;
  payload:
    | Readonly<{ kind: "skill"; capability: SkillCapability }>
    | Readonly<{
        kind: "mcp";
        authentication: ThirdPartyMcpAuthentication;
        name: string;
        serverUrl: string;
        toolNames: readonly string[];
      }>
    | null;
  projectId: string;
  report: ThirdPartyCapabilityAssessment;
  sameRunInstallAuthorized: boolean;
}>;

type ExpiredAssessment = Readonly<{
  assessedRunId: string;
  conversationId: string;
  createdAt: number;
  fingerprint: string;
  installable: boolean;
  kind: ThirdPartyCapabilityAssessment["kind"];
  projectId: string;
  sourceUrl: string;
}>;

type RevalidationAuthorization = Readonly<{
  conversationId: string;
  createdAt: number;
  fingerprint: string;
  kind: ThirdPartyCapabilityAssessment["kind"];
  projectId: string;
  runId: string;
  sourceUrl: string;
}>;

function localized(locale: AppLocale, chinese: string, english: string) {
  return locale === "zh-CN" ? chinese : english;
}

function cleanText(value: string, maximum: number) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function normalizedSourceUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedMcpUrl(value: string) {
  const url = normalizedSourceUrl(value);
  if (!url) return null;
  return isHttpsOrLocalNetworkHttpUrl(url) ? url : null;
}

function normalizedMcpName(value: string | undefined, url: URL) {
  const candidate = cleanText(value ?? "", 160);
  return candidate || `MCP · ${url.hostname}`;
}

function errorText(error: unknown) {
  const values: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) break;
    values.push(current.message);
    current = current.cause;
  }
  return values.join(" ");
}

function looksLikeAuthenticationRequired(error: unknown) {
  return /(?:\b401\b|unauthori[sz]ed|authorization required|oauth|invalid[_ -]?token|missing[_ -]?token)/iu.test(
    errorText(error),
  );
}

function skillRisks(
  capability: SkillCapability,
  locale: AppLocale,
): ThirdPartyCapabilityRisk[] {
  const risks: ThirdPartyCapabilityRisk[] = [
    {
      id: "untrusted-instructions",
      severity: "high",
      label: localized(
        locale,
        "第三方 Skill 是会影响 Agent 行为的不可信指令，不能扩大项目授权。",
        "A third-party Skill contains untrusted instructions that affect Agent behavior and cannot expand project authorization.",
      ),
    },
    {
      id: "declared-risk",
      severity: capability.risk === "propose" ? "high" : "medium",
      label: localized(
        locale,
        capability.risk === "propose"
          ? "该 Skill 声明可提出项目修改；所有修改仍进入 Diff、恢复点和回执。"
          : "该 Skill 声明为只读，但仍需核对其实际工具要求。",
        capability.risk === "propose"
          ? "This Skill declares proposal capability; every change still goes through Diff, recovery, and a receipt."
          : "This Skill declares read-only behavior, but its actual tool requirements still need review.",
      ),
    },
    ...(capability.bundle.files.some((file) => file.executable)
      ? [
          {
            id: "executable-files",
            severity: "high" as const,
            label: localized(
              locale,
              `完整包包含 ${capability.bundle.files.filter((file) => file.executable).length} 个带可执行标记的文件；本应用会保留但不会执行它们。`,
              `The complete package contains ${capability.bundle.files.filter((file) => file.executable).length} executable-marked files; this app preserves but does not execute them.`,
            ),
          },
        ]
      : []),
    {
      id: "complete-package",
      severity: "medium",
      label: localized(
        locale,
        `将完整保存这个不可信 Skill 包的 ${capability.bundle.files.length} 个文件；安装不会执行其中的脚本。`,
        `The complete untrusted Skill package (${capability.bundle.files.length} files) will be stored; installation does not execute its scripts.`,
      ),
    },
    ...(capability.bundle.files.some((file) => file.encoding === "base64")
      ? [
          {
            id: "opaque-binary-files",
            severity: "medium" as const,
            label: localized(
              locale,
              `完整包包含 ${capability.bundle.files.filter((file) => file.encoding === "base64").length} 个无法做文本静态分析的二进制文件。`,
              `The complete package contains ${capability.bundle.files.filter((file) => file.encoding === "base64").length} binary files that cannot receive text static analysis.`,
            ),
          },
        ]
      : []),
    {
      id: "project-scope",
      severity: "low",
      label: localized(
        locale,
        "安装目标仅为当前项目，不会写入其他项目或全局 Skill。",
        "The installation target is only the current project, not other projects or global Skills.",
      ),
    },
  ];
  const severityOrder: Record<ThirdPartyCapabilityRisk["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return risks.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity],
  );
}

function mcpRisks(
  locale: AppLocale,
  toolNames: readonly string[],
  destructiveHints: number,
  writeHints: number,
): ThirdPartyCapabilityRisk[] {
  return [
    {
      id: "external-service",
      severity: "high",
      label: localized(
        locale,
        "MCP 是外部服务：后续调用会把明确的工具参数发送给该服务，并接收不可信结果。",
        "MCP is an external service: later calls send explicit tool arguments to it and receive untrusted results.",
      ),
    },
    {
      id: "tool-effects",
      severity:
        destructiveHints > 0 || writeHints > 0 || toolNames.length === 0
          ? "high"
          : "medium",
      label: localized(
        locale,
        destructiveHints > 0 || writeHints > 0
          ? `服务声明了 ${writeHints} 个写入提示和 ${destructiveHints} 个破坏性提示；声明仅作参考。`
          : "服务未声明写入或破坏性工具提示，但这些远端声明不作为本地信任依据。",
        destructiveHints > 0 || writeHints > 0
          ? `The server declares ${writeHints} write hints and ${destructiveHints} destructive hints; these hints are advisory only.`
          : "The server declares no write or destructive hints, but remote annotations are not trusted locally.",
      ),
    },
    {
      id: "approval-policy",
      severity: "low",
      label: localized(
        locale,
        "安装后每次 MCP 工具调用都要求用户审批，且不信任远端只读 annotation。",
        "After installation every MCP tool call requires user approval, and remote read-only annotations remain untrusted.",
      ),
    },
  ];
}

function skillStatus(status: SkillAssessment["status"]) {
  if (status === "full") return "compatible" as const;
  if (status === "partial") return "limited" as const;
  return "incompatible" as const;
}

function reportNextStep(locale: AppLocale, installable: boolean) {
  if (!installable) {
    return localized(
      locale,
      "说明失败项；不要调用安装工具。修正来源、认证方式或依赖后重新体检。",
      "Explain the failed checks and do not call the install tool. Reassess after correcting the source, authentication mode, or dependencies.",
    );
  }
  return localized(
    locale,
    "按简短格式报告结论、异常检查、主要风险、关键运行限制和安装影响，然后停止本轮并询问是否确认安装。不得试用该能力或在本轮调用安装工具。",
    "Briefly report the verdict, exceptional checks, material risks, key runtime limit, and installation effect. Then stop this turn and ask for explicit installation confirmation. Do not trial the capability or call the install tool in this turn.",
  );
}

function revalidatedReportNextStep(locale: AppLocale) {
  return localized(
    locale,
    "重新体检的来源和指纹与用户已确认的版本完全一致；可在本轮直接调用安装工具，无需再次询问。",
    "The reassessed source and fingerprint exactly match the version the user already confirmed. Call the install tool in this turn without asking again.",
  );
}

function serverVersion(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = value as Record<string, unknown>;
  return cleanText(
    [candidate.name, candidate.version]
      .filter((item): item is string => typeof item === "string")
      .join(" "),
    160,
  );
}

export class ThirdPartyCapabilityService implements AgentThirdPartyCapabilityPort {
  readonly #dependencies: ThirdPartyCapabilityServiceDependencies;
  readonly #now: () => Date;
  readonly #pending = new Map<string, PendingAssessment>();
  readonly #expired = new Map<string, ExpiredAssessment>();
  readonly #revalidationAuthorizations = new Map<
    string,
    RevalidationAuthorization
  >();

  constructor(dependencies: ThirdPartyCapabilityServiceDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? (() => new Date());
  }

  hasAssessmentAwaitingConfirmation(
    input: Readonly<{
      conversationId: string;
      projectId: string;
    }>,
  ) {
    this.#prune();
    return [...this.#pending.values(), ...this.#expired.values()].some(
      (assessment) =>
        assessment.conversationId === input.conversationId &&
        assessment.projectId === input.projectId &&
        ("report" in assessment
          ? assessment.report.installable
          : assessment.installable),
    );
  }

  async assess(
    input: AssessThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ): Promise<ThirdPartyCapabilityAssessment> {
    this.#prune();
    if (signal?.aborted) throw new Error("aborted");
    return input.kind === "skill"
      ? this.#assessSkill(input, signal)
      : this.#assessMcp(input, signal);
  }

  async install(
    input: InstallThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ): Promise<ThirdPartyCapabilityInstallResult> {
    this.#prune();
    if (signal?.aborted) throw new Error("aborted");
    const pending = this.#pending.get(input.assessmentId);
    if (!pending) {
      const expired = this.#expired.get(input.assessmentId);
      if (!expired) {
        throw new Error(
          localized(
            this.#dependencies.locale,
            "体检记录不存在或已过期，请重新体检。",
            "The assessment does not exist or has expired. Reassess it.",
          ),
        );
      }
      if (
        expired.conversationId !== input.conversationId ||
        expired.projectId !== input.projectId
      ) {
        throw new Error(
          localized(
            this.#dependencies.locale,
            "体检记录不属于当前项目对话。",
            "The assessment does not belong to this project conversation.",
          ),
        );
      }
      if (expired.assessedRunId === input.runId) {
        throw new Error(
          localized(
            this.#dependencies.locale,
            "体检和安装必须分成两轮，先向用户说明风险并等待确认。",
            "Assessment and installation require separate turns so the risks can be shown before confirmation.",
          ),
        );
      }
      if (!isExplicitCapabilityInstallConfirmation(input.latestUserPrompt)) {
        throw new Error(
          localized(
            this.#dependencies.locale,
            "当前用户消息没有明确确认安装。",
            "The latest user message does not explicitly confirm installation.",
          ),
        );
      }
      if (!expired.installable || !SHA256.test(expired.fingerprint)) {
        throw new Error(
          localized(
            this.#dependencies.locale,
            "过期的体检结果不允许安装，请重新体检并解决失败项。",
            "The expired assessment did not permit installation. Reassess and resolve its failed checks.",
          ),
        );
      }
      this.#rememberRevalidationAuthorization(input, expired);
      this.#expired.delete(input.assessmentId);
      throw new Error(
        localized(
          this.#dependencies.locale,
          "体检已过期；本轮安装确认已绑定到原来源和指纹。请立即重新体检同一来源：若指纹一致，可在本轮直接安装；若不一致，必须重新确认。",
          "The assessment expired, but this turn's installation confirmation is now bound to its original source and fingerprint. Reassess the same source now: an exact fingerprint match may install in this turn; a change requires confirmation again.",
        ),
      );
    }
    if (
      pending.conversationId !== input.conversationId ||
      pending.projectId !== input.projectId
    ) {
      throw new Error("体检记录不属于当前项目对话。");
    }
    if (
      pending.assessedRunId === input.runId &&
      !pending.sameRunInstallAuthorized
    ) {
      throw new Error("体检和安装必须分成两轮，先向用户说明风险并等待确认。");
    }
    if (!isExplicitCapabilityInstallConfirmation(input.latestUserPrompt)) {
      throw new Error("当前用户消息没有明确确认安装。");
    }
    if (!pending.report.installable || !pending.payload) {
      throw new Error("该体检结果不允许安装，请先解决失败项并重新体检。");
    }

    const result =
      pending.payload.kind === "skill"
        ? await this.#installSkill(input.assessmentId, pending)
        : await this.#installMcp(input.assessmentId, pending, signal);
    this.#pending.delete(input.assessmentId);
    return result;
  }

  async #assessSkill(
    input: AssessThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ) {
    const assessmentId = this.#dependencies.createAssessmentId();
    const expiresAt = new Date(
      this.#now().getTime() + ASSESSMENT_TTL_MS,
    ).toISOString();
    let capability: SkillCapability;
    try {
      capability = await this.#dependencies.resolveSkill(input.url, signal);
    } catch {
      const report: ThirdPartyCapabilityAssessment = {
        assessmentId,
        ...diagnosticEnvironment("skill"),
        kind: "skill",
        name: localized(
          this.#dependencies.locale,
          "未知 Skill",
          "Unknown Skill",
        ),
        sourceUrl: cleanText(input.url, 2_048),
        fingerprint: "unavailable",
        projectId: input.projectId,
        status: "incompatible",
        installable: false,
        checks: [
          {
            id: "source-resolution",
            label: localized(
              this.#dependencies.locale,
              "URL、安全传输、文档结构与完整性校验",
              "URL, secure transport, document structure, and integrity",
            ),
            status: "fail",
          },
        ],
        risks: [],
        plannedInstall: {
          target: "project-skills",
          enabled: false,
        },
        expiresAt,
        confirmationRequired: true,
        nextStep: reportNextStep(this.#dependencies.locale, false),
      };
      return this.#remember(input, report, null);
    }

    const assessment = this.#dependencies.skillAssessment(
      capability,
      input.projectId,
    );
    const duplicate = this.#dependencies.skillExists(
      input.projectId,
      capability.id,
    );
    const status = duplicate ? "incompatible" : skillStatus(assessment.status);
    const installable = status !== "incompatible";
    const checks: ThirdPartyCapabilityCheck[] = assessment.checks.map(
      (check) => ({
        id: check.id,
        label: check.label,
        status: check.available
          ? "pass"
          : check.required
            ? assessment.status === "unsupported"
              ? "fail"
              : "warn"
            : "warn",
      }),
    );
    if (duplicate) {
      checks.unshift({
        id: "already-installed",
        label: localized(
          this.#dependencies.locale,
          "当前项目已经存在同名 Skill",
          "A Skill with this name already exists in the current project",
        ),
        status: "fail",
      });
    }
    const sourceUrl = cleanText(capability.documentationUrl, 2_048);
    const report: ThirdPartyCapabilityAssessment = {
      assessmentId,
      ...diagnosticEnvironment("skill"),
      kind: "skill",
      name:
        this.#dependencies.locale === "zh-CN"
          ? capability.name.zhCN
          : capability.name.en,
      sourceUrl,
      fingerprint: capability.bundle.sha256,
      projectId: input.projectId,
      status,
      installable,
      checks,
      risks: skillRisks(capability, this.#dependencies.locale),
      package: {
        binaryFileCount: capability.bundle.files.filter(
          (file) => file.encoding === "base64",
        ).length,
        complete: true,
        executableFileCount: capability.bundle.files.filter(
          (file) => file.executable,
        ).length,
        fileCount: capability.bundle.files.length,
        sha256: capability.bundle.sha256,
        textFileCount: capability.bundle.files.filter(
          (file) => file.encoding === "utf8",
        ).length,
        totalBytes: capability.bundle.totalBytes,
      },
      plannedInstall: {
        target: "project-skills",
        enabled: assessment.status === "full" && !duplicate,
      },
      expiresAt,
      confirmationRequired: true,
      nextStep: reportNextStep(this.#dependencies.locale, installable),
    };
    return this.#remember(
      input,
      report,
      installable ? { kind: "skill", capability } : null,
    );
  }

  async #assessMcp(
    input: AssessThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ) {
    const locale = this.#dependencies.locale;
    const assessmentId = this.#dependencies.createAssessmentId();
    const expiresAt = new Date(
      this.#now().getTime() + ASSESSMENT_TTL_MS,
    ).toISOString();
    const url = normalizedMcpUrl(input.url);
    if (!url) {
      const report: ThirdPartyCapabilityAssessment = {
        assessmentId,
        ...diagnosticEnvironment("mcp"),
        kind: "mcp",
        name: localized(locale, "未知 MCP", "Unknown MCP"),
        sourceUrl: cleanText(input.url, 2_048),
        fingerprint: "unavailable",
        projectId: input.projectId,
        status: "incompatible",
        installable: false,
        checks: [
          {
            id: "endpoint",
            label: localized(
              locale,
              "MCP 地址不能内嵌凭据或片段；公网必须使用 HTTPS，局域网可使用 HTTP",
              "The MCP endpoint cannot embed credentials or fragments; public endpoints require HTTPS and local network endpoints may use HTTP",
            ),
            status: "fail",
          },
        ],
        risks: [],
        plannedInstall: {
          target: "global-mcp",
          enabled: false,
          authentication: input.authentication ?? "none",
          allToolCallsRequireApproval: true,
        },
        expiresAt,
        confirmationRequired: true,
        nextStep: reportNextStep(locale, false),
      };
      return this.#remember(input, report, null);
    }

    const serverUrl = url.toString();
    const name = normalizedMcpName(input.name, url);
    const authentication = input.authentication ?? "none";
    if (authentication === "oauth" && url.protocol !== "https:") {
      const report = await this.#mcpFailureReport({
        assessmentId,
        authentication,
        expiresAt,
        input,
        name,
        serverUrl,
        label: localized(
          locale,
          "局域网 HTTP 可使用无需登录或密码本 Token；OAuth 必须使用 HTTPS",
          "Local HTTP supports no sign-in or password-book tokens; OAuth requires HTTPS",
        ),
      });
      return this.#remember(input, report, null);
    }
    const duplicate = (await this.#dependencies.listMcpConnections()).some(
      (connection) =>
        connection.projectId === input.projectId &&
        connection.serverUrl === serverUrl,
    );
    if (duplicate) {
      const report = await this.#mcpFailureReport({
        assessmentId,
        authentication,
        expiresAt,
        input,
        name,
        serverUrl,
        label: localized(
          locale,
          "当前项目已经安装这个 MCP 地址",
          "This MCP endpoint is already installed in the current project",
        ),
      });
      return this.#remember(input, report, null);
    }

    let client: McpRemoteClient | undefined;
    try {
      client = await this.#dependencies.connectMcp(
        {
          id: "mcp-assessment",
          name,
          url: serverUrl,
          revision: "assessment",
        },
        signal,
      );
      const [tools, ping] = await Promise.all([
        client.listTools({ refresh: true, signal }),
        client.ping(signal),
      ]);
      void ping;
      if (
        tools.length > MAX_MCP_TOOLS ||
        tools.some((tool) => !SAFE_MCP_TOOL_NAME.test(tool.name)) ||
        new Set(tools.map((tool) => tool.name)).size !== tools.length
      ) {
        throw new Error("MCP tool catalog is invalid or too large.");
      }
      const info = client.serverInfo();
      const toolNames = tools.map((tool) => tool.name).sort();
      const writeHints = tools.filter(
        (tool) => tool.annotations?.readOnlyHint === false,
      ).length;
      const destructiveHints = tools.filter(
        (tool) => tool.annotations?.destructiveHint === true,
      ).length;
      const protocolVersion = cleanText(info.protocolVersion ?? "", 80);
      const version = serverVersion(info.serverVersion);
      const fingerprint = await this.#dependencies.digest(
        JSON.stringify({
          serverUrl,
          protocolVersion,
          version,
          toolNames,
        }),
      );
      if (!SHA256.test(fingerprint)) {
        throw new Error("MCP assessment digest is invalid.");
      }
      const limited = authentication === "oauth";
      const checks: ThirdPartyCapabilityCheck[] = [
        {
          id: "endpoint",
          label: localized(locale, "安全的 MCP 服务地址", "Safe MCP endpoint"),
          status: "pass",
        },
        {
          id: "streamable-http",
          label: localized(
            locale,
            "Streamable HTTP 握手、ping 与工具目录",
            "Streamable HTTP handshake, ping, and tool catalog",
          ),
          status: "pass",
        },
        {
          id: "protocol",
          label: protocolVersion
            ? localized(
                locale,
                `协商协议版本：${protocolVersion}`,
                `Negotiated protocol version: ${protocolVersion}`,
              )
            : localized(
                locale,
                "服务没有返回可显示的协议版本",
                "The server did not return a displayable protocol version",
              ),
          status: protocolVersion ? "pass" : "warn",
        },
        {
          id: "tool-catalog",
          label: localized(
            locale,
            `发现 ${toolNames.length} 个工具${version ? `；服务版本 ${version}` : ""}`,
            `Discovered ${toolNames.length} tools${version ? `; server version ${version}` : ""}`,
          ),
          status: "pass",
        },
        ...(limited
          ? [
              {
                id: "oauth-pending",
                label: localized(
                  locale,
                  "OAuth 尚未授权；安装时会打开授权流程并在保存后重新探测",
                  "OAuth is not authorized yet; installation opens authorization and reprobes after saving",
                ),
                status: "warn" as const,
              },
            ]
          : []),
      ];
      const report: ThirdPartyCapabilityAssessment = {
        assessmentId,
        ...diagnosticEnvironment("mcp"),
        kind: "mcp",
        name,
        sourceUrl: serverUrl,
        fingerprint,
        projectId: input.projectId,
        status: limited ? "limited" : "compatible",
        installable: true,
        checks,
        risks: mcpRisks(locale, toolNames, destructiveHints, writeHints),
        plannedInstall: {
          target: "global-mcp",
          enabled: true,
          authentication,
          allToolCallsRequireApproval: true,
        },
        expiresAt,
        confirmationRequired: true,
        nextStep: reportNextStep(locale, true),
        discoveredTools: toolNames.slice(0, 100),
      };
      return this.#remember(input, report, {
        kind: "mcp",
        authentication,
        name,
        serverUrl,
        toolNames,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (
        authentication === "oauth" &&
        looksLikeAuthenticationRequired(error)
      ) {
        const fingerprint = await this.#dependencies.digest(
          JSON.stringify({ serverUrl, authentication }),
        );
        const report: ThirdPartyCapabilityAssessment = {
          assessmentId,
          ...diagnosticEnvironment("mcp"),
          kind: "mcp",
          name,
          sourceUrl: serverUrl,
          fingerprint: SHA256.test(fingerprint) ? fingerprint : "unavailable",
          projectId: input.projectId,
          status: "limited",
          installable: true,
          checks: [
            {
              id: "endpoint",
              label: localized(
                locale,
                "安全的 MCP 服务地址",
                "Safe MCP endpoint",
              ),
              status: "pass",
            },
            {
              id: "authentication",
              label: localized(
                locale,
                "服务要求认证；OAuth 授权和完整兼容性只能在确认安装后验证",
                "The server requires authentication; OAuth and full compatibility can only be verified after installation is confirmed",
              ),
              status: "warn",
            },
          ],
          risks: mcpRisks(locale, [], 0, 0),
          plannedInstall: {
            target: "global-mcp",
            enabled: true,
            authentication: "oauth",
            allToolCallsRequireApproval: true,
          },
          expiresAt,
          confirmationRequired: true,
          nextStep: reportNextStep(locale, true),
        };
        return this.#remember(input, report, {
          kind: "mcp",
          authentication: "oauth",
          name,
          serverUrl,
          toolNames: [],
        });
      }
      const report = await this.#mcpFailureReport({
        assessmentId,
        authentication,
        expiresAt,
        input,
        name,
        serverUrl,
        label:
          authentication === "none" && looksLikeAuthenticationRequired(error)
            ? localized(
                locale,
                "服务要求认证；请确认使用 OAuth 后重新体检",
                "The server requires authentication; reassess after choosing OAuth",
              )
            : localized(
                locale,
                "无法完成 Streamable HTTP 握手、ping 或工具目录校验",
                "Could not complete the Streamable HTTP handshake, ping, or tool catalog validation",
              ),
        suggestedAuthentication:
          authentication === "none" && looksLikeAuthenticationRequired(error)
            ? "oauth"
            : undefined,
      });
      return this.#remember(input, report, null);
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  async #mcpFailureReport(input: {
    assessmentId: string;
    authentication: ThirdPartyMcpAuthentication;
    expiresAt: string;
    input: AssessThirdPartyCapabilityInput;
    label: string;
    name: string;
    serverUrl: string;
    suggestedAuthentication?: ThirdPartyMcpAuthentication;
  }): Promise<ThirdPartyCapabilityAssessment> {
    const fingerprint = await this.#dependencies
      .digest(
        JSON.stringify({
          serverUrl: input.serverUrl,
          authentication: input.authentication,
        }),
      )
      .catch(() => "unavailable");
    return {
      assessmentId: input.assessmentId,
      ...diagnosticEnvironment("mcp"),
      kind: "mcp",
      name: input.name,
      sourceUrl: input.serverUrl,
      fingerprint: SHA256.test(fingerprint) ? fingerprint : "unavailable",
      projectId: input.input.projectId,
      status: "incompatible",
      installable: false,
      checks: [
        {
          id: "mcp-compatibility",
          label: input.label,
          status: "fail",
        },
      ],
      risks: [],
      plannedInstall: {
        target: "global-mcp",
        enabled: false,
        authentication: input.authentication,
        allToolCallsRequireApproval: true,
      },
      expiresAt: input.expiresAt,
      confirmationRequired: true,
      nextStep: reportNextStep(this.#dependencies.locale, false),
      ...(input.suggestedAuthentication
        ? { suggestedAuthentication: input.suggestedAuthentication }
        : {}),
    };
  }

  async #installSkill(
    assessmentId: string,
    pending: PendingAssessment,
  ): Promise<ThirdPartyCapabilityInstallResult> {
    if (pending.payload?.kind !== "skill") {
      throw new Error("Skill 体检记录无效。");
    }
    const capability = pending.payload.capability;
    if (this.#dependencies.skillExists(pending.projectId, capability.id)) {
      throw new Error("当前项目已经存在同名 Skill。");
    }
    const installed = await this.#dependencies.installSkill(
      capability,
      pending.projectId,
    );
    return {
      assessmentId,
      enabled: pending.report.plannedInstall.enabled,
      installed: true,
      itemId: capability.id,
      kind: "skill",
      list: "project-skills",
      name: pending.report.name,
      ...(installed.receiptId ? { receiptId: installed.receiptId } : {}),
      updateTracking: installed.updateTracking,
    };
  }

  async #installMcp(
    assessmentId: string,
    pending: PendingAssessment,
    signal?: AbortSignal,
  ): Promise<ThirdPartyCapabilityInstallResult> {
    if (pending.payload?.kind !== "mcp") {
      throw new Error("MCP 体检记录无效。");
    }
    const payload = pending.payload;
    if (
      (await this.#dependencies.listMcpConnections()).some(
        (connection) => connection.serverUrl === payload.serverUrl,
      )
    ) {
      throw new Error("全局 MCP 服务中已经存在这个地址。");
    }
    if (signal?.aborted) throw new Error("aborted");

    let authorizationId: string | undefined;
    let connection: McpConnection | undefined;
    try {
      if (payload.authentication === "oauth") {
        const authorization = await this.#dependencies.authorizeMcpOAuth(
          payload.serverUrl,
        );
        if (!authorization) throw new Error("MCP OAuth 授权已取消。");
        authorizationId = authorization.authorizationId;
      }
      connection = await this.#dependencies.createMcpConnection({
        projectId: null,
        name: payload.name,
        serverUrl: payload.serverUrl,
        authentication: authorizationId
          ? { kind: "oauth", authorizationId }
          : { kind: "none" },
        enabled: true,
        trustToolAnnotations: false,
        approveTools: ["*"],
        ...(payload.toolNames.length > 0
          ? { allowedToolNames: payload.toolNames }
          : {}),
      });
      await this.#dependencies.probeMcpConnection(connection.id);
    } catch (error) {
      if (connection) {
        await this.#dependencies
          .removeMcpConnection(connection.id)
          .catch(() => undefined);
      } else if (authorizationId) {
        await this.#dependencies
          .disconnectMcpOAuth(authorizationId)
          .catch(() => undefined);
      }
      throw error;
    }
    return {
      assessmentId,
      enabled: true,
      installed: true,
      itemId: connection.id,
      kind: "mcp",
      list: "global-mcp",
      name: payload.name,
    };
  }

  #remember(
    input: AssessThirdPartyCapabilityInput,
    report: ThirdPartyCapabilityAssessment,
    payload: PendingAssessment["payload"],
  ): ThirdPartyCapabilityAssessment {
    const authorizationKey = this.#revalidationAuthorizationKey(input);
    const authorization =
      this.#revalidationAuthorizations.get(authorizationKey);
    const sameSource =
      authorization?.kind === report.kind &&
      authorization.sourceUrl === report.sourceUrl;
    const confirmationCarriedForward = Boolean(
      sameSource &&
      payload &&
      report.installable &&
      SHA256.test(report.fingerprint) &&
      authorization?.fingerprint === report.fingerprint,
    );
    if (sameSource) {
      this.#revalidationAuthorizations.delete(authorizationKey);
    }
    const finalReport: ThirdPartyCapabilityAssessment =
      confirmationCarriedForward
        ? {
            ...report,
            confirmationRequired: false,
            confirmationCarriedForward: true,
            nextStep: revalidatedReportNextStep(this.#dependencies.locale),
          }
        : report;
    this.#pending.set(finalReport.assessmentId, {
      assessedRunId: input.runId,
      conversationId: input.conversationId,
      createdAt: this.#now().getTime(),
      payload,
      projectId: input.projectId,
      report: finalReport,
      sameRunInstallAuthorized: confirmationCarriedForward,
    });
    while (this.#pending.size > MAX_PENDING_ASSESSMENTS) {
      const first = this.#pending.keys().next().value as string | undefined;
      if (!first) break;
      this.#pending.delete(first);
    }
    return finalReport;
  }

  #rememberRevalidationAuthorization(
    input: InstallThirdPartyCapabilityInput,
    expired: ExpiredAssessment,
  ) {
    const key = this.#revalidationAuthorizationKey(input);
    this.#revalidationAuthorizations.set(key, {
      conversationId: input.conversationId,
      createdAt: this.#now().getTime(),
      fingerprint: expired.fingerprint,
      kind: expired.kind,
      projectId: input.projectId,
      runId: input.runId,
      sourceUrl: expired.sourceUrl,
    });
    while (
      this.#revalidationAuthorizations.size > MAX_REVALIDATION_AUTHORIZATIONS
    ) {
      const first = this.#revalidationAuthorizations.keys().next().value as
        string | undefined;
      if (!first) break;
      this.#revalidationAuthorizations.delete(first);
    }
  }

  #revalidationAuthorizationKey(
    input: AssessThirdPartyCapabilityInput | InstallThirdPartyCapabilityInput,
  ) {
    return JSON.stringify([input.conversationId, input.projectId, input.runId]);
  }

  #prune() {
    const now = this.#now().getTime();
    const cutoff = now - ASSESSMENT_TTL_MS;
    for (const [id, pending] of this.#pending) {
      if (pending.createdAt > cutoff) continue;
      this.#expired.set(id, {
        assessedRunId: pending.assessedRunId,
        conversationId: pending.conversationId,
        createdAt: pending.createdAt,
        fingerprint: pending.report.fingerprint,
        installable: pending.report.installable,
        kind: pending.report.kind,
        projectId: pending.projectId,
        sourceUrl: pending.report.sourceUrl,
      });
      this.#pending.delete(id);
    }
    const retentionCutoff = now - EXPIRED_ASSESSMENT_RETENTION_MS;
    for (const [id, expired] of this.#expired) {
      if (expired.createdAt <= retentionCutoff) this.#expired.delete(id);
    }
    for (const [key, authorization] of this.#revalidationAuthorizations) {
      if (authorization.createdAt <= cutoff) {
        this.#revalidationAuthorizations.delete(key);
      }
    }
    while (this.#expired.size > MAX_PENDING_ASSESSMENTS) {
      const first = this.#expired.keys().next().value as string | undefined;
      if (!first) break;
      this.#expired.delete(first);
    }
  }
}
