import type { SkillCapability } from "@/application/ports/capability-catalog";
import {
  normalizeSkillBundlePath,
  validateSkillBundleMetadata,
} from "@/application/skill-bundle";
import { validateProjectSkillDocument } from "@/domain/project-skill-document";

export type SkillAssessmentStatus = "full" | "partial" | "unsupported";

export type SkillAssessmentCheck = Readonly<{
  available: boolean;
  id: string;
  kind:
    | "document"
    | "host-tool"
    | "mcp-server"
    | "source-audit"
    | "source-bundle"
    | "source-compatibility"
    | "source-license"
    | "source-repository"
    | "source-trust"
    | "runtime";
  label: string;
  required: boolean;
}>;

export type SkillAssessment = Readonly<{
  checks: readonly SkillAssessmentCheck[];
  status: SkillAssessmentStatus;
}>;

const HOST_TOOLS = new Set([
  "project_context_read",
  "project-files",
  "read",
  "write",
  "edit",
  "ls",
  "find",
  "grep",
  "bash",
]);

const NODE_RUNTIME_REFERENCE =
  /(?:^|[\n`])\s*(?:[-*+]\s*)?(?:\$\s*)?(?:node(?:\.js)?|npm|npx|pnpm|yarn|bun|deno|tsx|ts-node)(?:\s|`|$)|(?:\b(?:requires?|requirement)|需要|依赖)\s*(?::|：)?\s*(?:Node(?:\.js)?|npm|npx|pnpm|yarn|bun|deno)\b/imu;
const PYTHON_RUNTIME_REFERENCE =
  /(?:^|[\n`])\s*(?:[-*+]\s*)?(?:\$\s*)?(?:python3?|pip3?|poetry|pytest|uv\s+run)(?:\s|`|$)|(?:\b(?:requires?|requirement)|需要|依赖)\s*(?::|：)?\s*(?:Python|pip|poetry|pytest)\b/imu;
const SUPPORTING_FILE_REFERENCE =
  /(?:^|[\s(`'"=])(?:\.\/)?((?:scripts|references|assets)\/[A-Za-z0-9._/-]+)/gimu;
const NODE_PACKAGE_FILE =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/iu;
const PYTHON_PACKAGE_FILE =
  /(?:^|\/)(?:pyproject\.toml|requirements(?:-[^/]+)?\.txt|Pipfile|poetry\.lock)$/iu;
const PYTHON_FILE = /\.py$/iu;

export function assessSkillCapability(input: {
  capability: SkillCapability;
  connectedMcpServerUrls: readonly string[];
  locale: "zh-CN" | "en";
}): SkillAssessment {
  const { capability } = input;
  const validation = validateProjectSkillDocument(
    `skills/${capability.id}/SKILL.md`,
    capability.skillDocument,
  );
  const bundleMetadataValid = validateSkillBundleMetadata(capability);
  const bundlePaths = new Set(capability.bundle.files.map((file) => file.path));
  const referencedFiles = referencedSupportingFiles(capability.skillDocument);
  const missingReferencedFiles = referencedFiles.filter(
    (path) => !bundlePaths.has(path),
  );
  const runtimeText = capability.bundle.files
    .filter((file) => file.encoding === "utf8")
    .map((file) => `${file.path}\n${file.content}`)
    .join("\n");
  const checks: SkillAssessmentCheck[] = [
    {
      id: "skill-document",
      kind: "document",
      label:
        input.locale === "zh-CN"
          ? "Skill 文档结构、大小与风险声明"
          : "Skill document structure, size, and risk declaration",
      required: true,
      available:
        validation.valid && validation.document.risk === capability.risk,
    },
    {
      id: "complete-skill-package",
      kind: "source-bundle",
      label:
        input.locale === "zh-CN"
          ? `完整包包含 ${capability.bundle.files.length} 个文件、共 ${capability.bundle.totalBytes} 字节；安装要么写入全部文件，要么一个也不写`
          : `The complete package contains ${capability.bundle.files.length} files and ${capability.bundle.totalBytes} bytes; installation writes every file or none`,
      required: true,
      available: bundleMetadataValid,
    },
    {
      id: "boltpocket-js-exec-runtime",
      kind: "runtime",
      label:
        input.locale === "zh-CN"
          ? "本应用仅提供受限只读 js_exec（QuickJS）；没有 Node.js、Python、模块加载、网络或持久化"
          : "This app provides only bounded read-only js_exec (QuickJS), without Node.js, Python, module loading, network, or persistence",
      required: true,
      available: true,
    },
    ...unsupportedRuntimeChecks(
      runtimeText,
      capability.bundle.files.map((file) => file.path),
      input.locale,
    ),
    ...(referencedFiles.length > 0
      ? [
          {
            available: missingReferencedFiles.length === 0,
            id: "referenced-supporting-files",
            kind: "source-bundle" as const,
            label:
              input.locale === "zh-CN"
                ? missingReferencedFiles.length === 0
                  ? `文档引用的 ${referencedFiles.length} 个配套文件都在完整包中`
                  : `完整包缺少文档引用的文件：${missingReferencedFiles.join("、")}`
                : missingReferencedFiles.length === 0
                  ? `All ${referencedFiles.length} supporting files referenced by the document are present in the complete package`
                  : `The complete package is missing referenced files: ${missingReferencedFiles.join(", ")}`,
            required: true,
          },
        ]
      : []),
    ...capability.requirements.map((requirement) => ({
      id: requirement.id,
      kind: requirement.kind,
      label:
        input.locale === "zh-CN"
          ? requirement.label.zhCN
          : requirement.label.en,
      required: requirement.required,
      available:
        requirement.kind === "host-tool"
          ? HOST_TOOLS.has(requirement.id)
          : input.connectedMcpServerUrls.includes(requirement.serverUrl),
    })),
    ...(capability.provenance
      ? provenanceChecks(
          capability.provenance,
          capability.bundle.files.length - 1,
          input.locale,
        )
      : []),
    ...(capability.source.kind === "catalog-json"
      ? [
          {
            available: false,
            id: "direct-url-review",
            kind: "source-trust" as const,
            label:
              input.locale === "zh-CN"
                ? "此 URL 的内容未经BoltPocket独立核验"
                : "Content at this URL is not independently verified by BoltPocket",
            required: true,
          },
        ]
      : []),
  ];
  if (!checks[0]!.available) return { checks, status: "unsupported" };
  const missingRequired = checks.filter(
    (check) => check.required && !check.available,
  );
  if (
    missingRequired.some(
      (check) =>
        check.kind === "host-tool" ||
        check.id === "complete-skill-package" ||
        check.id === "complete-upstream-bundle" ||
        check.id === "referenced-supporting-files",
    )
  ) {
    return { checks, status: "unsupported" };
  }
  if (
    capability.provenance &&
    (capability.provenance.archived ||
      capability.provenance.license === null ||
      capability.provenance.audit === "fail")
  ) {
    return { checks, status: "unsupported" };
  }
  return {
    checks,
    status: missingRequired.length ? "partial" : "full",
  };
}

function unsupportedRuntimeChecks(
  bundleText: string,
  bundlePaths: readonly string[],
  locale: "zh-CN" | "en",
): readonly SkillAssessmentCheck[] {
  const runtimes = [
    ...(NODE_RUNTIME_REFERENCE.test(bundleText) ||
    bundlePaths.some((path) => NODE_PACKAGE_FILE.test(path))
      ? ["Node.js"]
      : []),
    ...(PYTHON_RUNTIME_REFERENCE.test(bundleText) ||
    bundlePaths.some(
      (path) => PYTHON_FILE.test(path) || PYTHON_PACKAGE_FILE.test(path),
    )
      ? ["Python"]
      : []),
  ];
  if (runtimes.length === 0) return [];
  const names = runtimes.join(locale === "zh-CN" ? "、" : " and ");
  return [
    {
      available: false,
      id: "unavailable-runtime",
      kind: "runtime",
      label:
        locale === "zh-CN"
          ? `完整包要求 ${names} 运行时；本应用会保留这些文件，但不能执行脚本或安装依赖`
          : `The package requires the ${names} runtime; this app preserves those files but cannot execute the scripts or install their dependencies`,
      required: true,
    },
  ];
}

function referencedSupportingFiles(document: string) {
  const paths = new Set<string>();
  for (const match of document.matchAll(SUPPORTING_FILE_REFERENCE)) {
    const normalized = normalizeSkillBundlePath(
      (match[1] ?? "").replace(/[.,;:]+$/u, ""),
    );
    if (normalized) paths.add(normalized);
  }
  return [...paths].sort();
}

function provenanceChecks(
  provenance: NonNullable<SkillCapability["provenance"]>,
  capabilitySupportingFileCount: number,
  locale: "zh-CN" | "en",
): readonly SkillAssessmentCheck[] {
  const chinese = locale === "zh-CN";
  return [
    {
      available: !provenance.archived,
      id: "active-repository",
      kind: "source-repository",
      label: chinese ? "上游仓库仍在维护" : "Upstream repository is active",
      required: true,
    },
    {
      available: provenance.license !== null,
      id: "open-source-license",
      kind: "source-license",
      label: provenance.license
        ? chinese
          ? `可识别的开源许可：${provenance.license}`
          : `Recognized open-source license: ${provenance.license}`
        : chinese
          ? "可识别的开源许可"
          : "Recognized open-source license",
      required: true,
    },
    {
      available: provenance.audit === "pass",
      id: "upstream-audit",
      kind: "source-audit",
      label: chinese
        ? `上游安全审计：${auditLabel(provenance.audit, locale)}`
        : `Upstream security audit: ${auditLabel(provenance.audit, locale)}`,
      required: true,
    },
    {
      available:
        provenance.supportingFileCount === capabilitySupportingFileCount,
      id: "complete-upstream-bundle",
      kind: "source-bundle",
      label:
        provenance.supportingFileCount === capabilitySupportingFileCount
          ? chinese
            ? `已取得并校验 SKILL.md 与全部 ${provenance.supportingFileCount} 个上游配套文件`
            : `SKILL.md and all ${provenance.supportingFileCount} upstream supporting files were acquired and verified`
          : chinese
            ? `上游声明 ${provenance.supportingFileCount} 个配套文件，但完整包内有 ${capabilitySupportingFileCount} 个`
            : `Upstream declares ${provenance.supportingFileCount} supporting files, but the complete package contains ${capabilitySupportingFileCount}`,
      required: true,
    },
    {
      available: provenance.compatibility === null,
      id: "upstream-compatibility",
      kind: "source-compatibility",
      label: provenance.compatibility
        ? chinese
          ? `上游兼容条件：${provenance.compatibility}`
          : `Upstream compatibility condition: ${provenance.compatibility}`
        : chinese
          ? "没有额外兼容条件"
          : "No additional compatibility condition",
      required: true,
    },
  ];
}

function auditLabel(
  value: NonNullable<SkillCapability["provenance"]>["audit"],
  locale: "zh-CN" | "en",
) {
  const labels =
    locale === "zh-CN"
      ? {
          fail: "未通过",
          pass: "通过",
          unavailable: "暂无结果",
          warn: "有提醒",
        }
      : {
          fail: "failed",
          pass: "passed",
          unavailable: "unavailable",
          warn: "warnings",
        };
  return labels[value];
}
