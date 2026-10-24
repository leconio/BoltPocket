import type { SkillCapability } from "@/application/ports/capability-catalog";
import { validateSkillBundleMetadata } from "@/application/skill-bundle";
import type { ChangeProposal } from "@/domain/models";
import {
  createProjectWorkspaceFileResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
  projectWorkspaceConnectionId,
} from "@/domain/project-workspace";
import { createTextDiffLines } from "@/domain/text-diff";

export function buildProjectSkillBundleInstallProposal(input: {
  capability: SkillCapability;
  connectorLabel: string;
  conversationId: string;
  createdAt: string;
  locale: "zh-CN" | "en";
  projectId: string;
  proposalId: string;
}): ChangeProposal {
  const { capability } = input;
  if (!input.conversationId || !validateSkillBundleMetadata(capability)) {
    throw new Error("第三方 Skill 完整包无效。");
  }
  const connectorId = projectWorkspaceConnectionId(input.projectId);
  const hunks = capability.bundle.files.map((file, index) => {
    const target = `skills/${capability.id}/${file.path}`;
    const draft = createProjectWorkspaceFileResource({
      projectId: input.projectId,
      path: target,
      content: "",
      version: PROJECT_WORKSPACE_ABSENT_VERSION,
    });
    const binaryFile =
      file.encoding === "base64"
        ? {
            byteLength: file.byteLength,
            encoding: "base64" as const,
            mimeType: file.mimeType,
            sha256: file.sha256,
            source: {
              bundleSha256: capability.bundle.sha256,
              executable: file.executable,
              kind: "third-party-skill" as const,
              path: file.path,
              skillId: capability.id,
            },
          }
        : undefined;
    const summary =
      input.locale === "zh-CN"
        ? `安装完整 Skill 包文件：${file.path}`
        : `Install complete Skill package file: ${file.path}`;
    return {
      id: `${input.proposalId}-${index + 1}`,
      resourceId: draft.id,
      target,
      operation: "create" as const,
      ...(binaryFile ? { binaryFile } : {}),
      baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
      before: "",
      after: file.content,
      summary,
      lines: binaryFile
        ? [
            { kind: "meta" as const, text: `--- before/${target}` },
            { kind: "meta" as const, text: `+++ after/${target}` },
            { kind: "meta" as const, text: "@@ binary Skill file @@" },
            {
              kind: "addition" as const,
              text: `+${file.mimeType} · ${file.byteLength} bytes · sha256 ${file.sha256}`,
            },
          ]
        : createTextDiffLines(target, "", file.content),
    };
  });
  return {
    id: input.proposalId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    title:
      input.locale === "zh-CN"
        ? `安装完整 Skill 包：${capability.id}`
        : `Install complete Skill package: ${capability.id}`,
    kind: "capability",
    status: "pending",
    connectorId,
    connector: input.connectorLabel || connectorId,
    createdAt: input.createdAt,
    capabilityInstall: {
      bundleSha256: capability.bundle.sha256,
      fileCount: capability.bundle.files.length,
      kind: "skill",
      skillId: capability.id,
      totalBytes: capability.bundle.totalBytes,
    },
    hunks,
  };
}
