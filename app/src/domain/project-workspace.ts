import type {
  ConnectionItem,
  MemoryItem,
  Project,
  ProjectWorkspaceBinaryFile,
  SkillItem,
  WorkspaceResource,
} from "./models.ts";
import {
  builtInProjectResourceFile,
  isBuiltInProjectResourcePackId,
  type BuiltInProjectResourcePackId,
} from "./builtin-project-resources.ts";
import { validateEditableLibraryContent } from "./library-content.ts";
import { translateMessage } from "../i18n/messages.ts";
import type { AppLocale } from "../i18n/translate.ts";

const PROJECT_WORKSPACE_CONNECTION_PREFIX = "project-workspace-";
const SAFE_ID = /^[a-zA-Z0-9._-]{1,120}$/u;

export const PROJECT_WORKSPACE_ABSENT_VERSION = "absent";

export const DEFAULT_PROJECT_INSTRUCTIONS = translateMessage(
  "project.workspace.default.instructions",
  "zh-CN",
);
export const DEFAULT_PROJECT_INSTRUCTIONS_EN = translateMessage(
  "project.workspace.default.instructions",
  "en",
);

type ProjectWorkspaceLocale = AppLocale;

function defaultProjectSkill(locale: ProjectWorkspaceLocale): SkillItem {
  return {
    id: "project-work",
    name: translateMessage("project.workspace.default.skill.name", locale),
    description: translateMessage(
      "project.workspace.default.skill.description",
      locale,
    ),
    content: translateMessage(
      "project.workspace.default.skill.content",
      locale,
    ),
    risk: "propose",
    enabled: true,
    scope: "project",
    projectIds: [],
  };
}

function assertSafeId(value: string, label: string) {
  if (!SAFE_ID.test(value)) {
    throw new Error(`${label} 不能用于项目工作区。`);
  }
  return value;
}

function normalizedSkillSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return assertSafeId(slug, "Skill ID");
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function workspaceResource(input: {
  id: string;
  projectId: string;
  path: string;
  content: string;
}): WorkspaceResource {
  return {
    id: input.id,
    projectId: input.projectId,
    connectionId: projectWorkspaceConnectionId(input.projectId),
    path: input.path,
    content: input.content.endsWith("\n")
      ? input.content
      : `${input.content}\n`,
    version: "1",
    storage: { kind: "project-workspace" },
  };
}

function projectMemoryMarkdown(
  items: readonly MemoryItem[],
  locale: ProjectWorkspaceLocale,
) {
  const lines = items.map(
    (item) => `- ${item.text.replace(/\s+/gu, " ").trim()}`,
  );
  return [
    translateMessage("project.workspace.heading.memory", locale),
    "",
    ...lines,
  ].join("\n");
}

function projectSkillMarkdown(skill: SkillItem, slug: string) {
  return [
    "---",
    `name: ${slug}`,
    `title: ${yamlString(skill.name)}`,
    `description: ${yamlString(skill.description)}`,
    `risk: ${skill.risk}`,
    "---",
    "",
    skill.content.trim(),
  ].join("\n");
}

export function createProjectWorkspaceSkillResource(input: {
  projectId: string;
  slug: string;
  name: string;
  content: string;
  locale?: ProjectWorkspaceLocale;
}) {
  const locale = input.locale ?? "zh-CN";
  const projectId = assertSafeId(input.projectId, "项目 ID");
  const slug = normalizedSkillSlug(input.slug);
  const name = input.name.replace(/\s+/gu, " ").trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error("Skill 名称需要为 1 到 120 个可见字符。");
  }
  const content = validateEditableLibraryContent("skill", input.content);
  const description =
    content
      .split(/\r?\n/gu)
      .map((line) => line.replace(/^\s*#{1,6}\s+/u, "").trim())
      .find(Boolean)
      ?.slice(0, 240) ??
    translateMessage("project.workspace.skill.fallbackDescription", locale);
  const connectionId = projectWorkspaceConnectionId(projectId);
  return {
    skillId: slug,
    resource: workspaceResource({
      id: `${connectionId}-skill-${slug}`,
      projectId,
      path: `skills/${slug}/SKILL.md`,
      content: projectSkillMarkdown(
        {
          id: slug,
          name,
          description,
          content,
          risk: "propose",
          enabled: true,
          scope: "project",
          projectIds: [projectId],
        },
        slug,
      ),
    }),
  };
}

export function projectWorkspaceConnectionId(projectId: string) {
  return `${PROJECT_WORKSPACE_CONNECTION_PREFIX}${assertSafeId(projectId, "项目 ID")}`;
}

export function isProjectWorkspaceConnectionId(connectionId: string) {
  return connectionId.startsWith(PROJECT_WORKSPACE_CONNECTION_PREFIX);
}

export function isSafeProjectWorkspacePath(path: string) {
  if (
    !path ||
    path.length > 2_000 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function stableWorkspacePathHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export function createProjectWorkspaceFileResource(input: {
  projectId: string;
  path: string;
  content: string;
  version?: string;
}): WorkspaceResource {
  const projectId = assertSafeId(input.projectId, "项目 ID");
  if (!isSafeProjectWorkspacePath(input.path)) {
    throw new Error(`项目文件路径不安全：${input.path}`);
  }
  if (input.content.includes("\0")) {
    throw new Error(`项目文件只能保存纯文本：${input.path}`);
  }
  const version = input.version ?? "1";
  if (!version || version.length > 512) {
    throw new Error(`项目文件版本无效：${input.path}`);
  }
  const connectionId = projectWorkspaceConnectionId(projectId);
  return {
    id: `${connectionId}-file-${stableWorkspacePathHash(input.path)}`,
    projectId,
    connectionId,
    path: input.path,
    content: input.content,
    version,
    storage: { kind: "project-workspace" },
  };
}

function canonicalBase64ByteLength(value: string) {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function assertBuiltInProjectResourceCopy(input: {
  contentBase64: string;
  packId: BuiltInProjectResourcePackId;
  sourcePath: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
}) {
  if (!isBuiltInProjectResourcePackId(input.packId)) {
    throw new Error("内置资源包无效。");
  }
  const descriptor = builtInProjectResourceFile(input.packId, input.sourcePath);
  if (
    !descriptor ||
    descriptor.mimeType !== input.mimeType ||
    descriptor.byteLength !== input.byteLength ||
    descriptor.sha256 !== input.sha256 ||
    canonicalBase64ByteLength(input.contentBase64) !== input.byteLength
  ) {
    throw new Error("内置资源副本与固定目录不一致。");
  }
  return descriptor;
}

export function createProjectWorkspaceBinaryFileResource(input: {
  projectId: string;
  path: string;
  contentBase64: string;
  packId: BuiltInProjectResourcePackId;
  sourcePath: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  version?: string;
}): WorkspaceResource {
  const projectId = assertSafeId(input.projectId, "项目 ID");
  if (!isSafeProjectWorkspacePath(input.path)) {
    throw new Error(`项目文件路径不安全：${input.path}`);
  }
  const descriptor = assertBuiltInProjectResourceCopy(input);
  const suffix = `assets/vendor/${input.packId}/${descriptor.path}`;
  const appRoot = input.path.slice(0, -(suffix.length + 1));
  if (
    input.path !== `${appRoot}/${suffix}` ||
    !/^apps\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(appRoot)
  ) {
    throw new Error("内置资源只能复制到 H5 应用的 assets/vendor 目录。");
  }
  const version = input.version ?? "1";
  if (!version || version.length > 512) {
    throw new Error(`项目文件版本无效：${input.path}`);
  }
  const connectionId = projectWorkspaceConnectionId(projectId);
  return {
    id: `${connectionId}-file-${stableWorkspacePathHash(input.path)}`,
    projectId,
    connectionId,
    path: input.path,
    content: input.contentBase64,
    version,
    storage: {
      kind: "project-workspace",
      binary: {
        encoding: "base64",
        mimeType: descriptor.mimeType,
        byteLength: descriptor.byteLength,
        sha256: descriptor.sha256,
        source: {
          kind: "builtin-h5-resource",
          packId: input.packId,
          path: descriptor.path,
        },
      },
    },
  };
}

export function createThirdPartySkillBinaryFileResource(input: {
  bundleSha256: string;
  byteLength: number;
  contentBase64: string;
  executable: boolean;
  mimeType: string;
  path: string;
  projectId: string;
  sha256: string;
  skillId: string;
  sourcePath: string;
  version?: string;
}): WorkspaceResource {
  const projectId = assertSafeId(input.projectId, "项目 ID");
  if (!isSafeProjectWorkspacePath(input.path)) {
    throw new Error(`项目文件路径不安全：${input.path}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(input.skillId)) {
    throw new Error("第三方 Skill ID 无效。");
  }
  if (
    !input.sourcePath ||
    input.sourcePath.startsWith("/") ||
    input.sourcePath.includes("\\") ||
    input.sourcePath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    input.path !== `skills/${input.skillId}/${input.sourcePath}`
  ) {
    throw new Error("第三方 Skill 二进制文件路径无效。");
  }
  if (
    !/^[a-f0-9]{64}$/u.test(input.bundleSha256) ||
    !/^[a-f0-9]{64}$/u.test(input.sha256) ||
    !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u.test(
      input.mimeType,
    ) ||
    typeof input.executable !== "boolean" ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > 1024 * 1024 ||
    canonicalBase64ByteLength(input.contentBase64) !== input.byteLength
  ) {
    throw new Error("第三方 Skill 二进制文件元数据无效。");
  }
  const version = input.version ?? "1";
  if (!version || version.length > 512) {
    throw new Error(`项目文件版本无效：${input.path}`);
  }
  const connectionId = projectWorkspaceConnectionId(projectId);
  return {
    id: `${connectionId}-file-${stableWorkspacePathHash(input.path)}`,
    projectId,
    connectionId,
    path: input.path,
    content: input.contentBase64,
    version,
    storage: {
      kind: "project-workspace",
      binary: {
        encoding: "base64",
        mimeType: input.mimeType,
        byteLength: input.byteLength,
        sha256: input.sha256,
        source: {
          bundleSha256: input.bundleSha256,
          executable: input.executable,
          kind: "third-party-skill",
          path: input.sourcePath,
          skillId: input.skillId,
        },
      },
    },
  };
}

export function createVerifiedProjectWorkspaceBinaryFileResource(input: {
  binary: ProjectWorkspaceBinaryFile;
  contentBase64: string;
  path: string;
  projectId: string;
  version?: string;
}): WorkspaceResource {
  const common = {
    projectId: input.projectId,
    path: input.path,
    contentBase64: input.contentBase64,
    mimeType: input.binary.mimeType,
    byteLength: input.binary.byteLength,
    sha256: input.binary.sha256,
    ...(input.version ? { version: input.version } : {}),
  };
  return input.binary.source.kind === "builtin-h5-resource"
    ? createProjectWorkspaceBinaryFileResource({
        ...common,
        packId: input.binary.source.packId,
        sourcePath: input.binary.source.path,
      })
    : createThirdPartySkillBinaryFileResource({
        ...common,
        bundleSha256: input.binary.source.bundleSha256,
        executable: input.binary.source.executable,
        skillId: input.binary.source.skillId,
        sourcePath: input.binary.source.path,
      });
}

export function isProjectWorkspaceResource(
  resource: WorkspaceResource,
): boolean {
  if (resource.storage.kind !== "project-workspace") return false;
  try {
    return (
      resource.connectionId === projectWorkspaceConnectionId(resource.projectId)
    );
  } catch {
    return false;
  }
}

export function createProjectWorkspaceConnection(
  project: Project,
  resourceCount: number,
  locale: ProjectWorkspaceLocale = "zh-CN",
): ConnectionItem {
  const projectId = assertSafeId(project.id, "项目 ID");
  return {
    id: projectWorkspaceConnectionId(projectId),
    projectId,
    name: translateMessage("project.workspace.connection.name", locale),
    account: project.name,
    scope: "/",
    status: "connected",
    resourceCount,
    access: "persistent",
    writeMode: "atomic",
  };
}

export function createProjectWorkspaceBundle(input: {
  project: Project;
  memories: readonly MemoryItem[];
  skills: readonly SkillItem[];
  locale?: ProjectWorkspaceLocale;
}) {
  const { project } = input;
  const locale = input.locale ?? "zh-CN";
  const projectId = assertSafeId(project.id, "项目 ID");
  const connectionId = projectWorkspaceConnectionId(projectId);
  const projectMemories = input.memories.filter(
    (memory) =>
      memory.scope === "project" && memory.projectIds?.includes(projectId),
  );
  const projectSkills = input.skills.filter(
    (skill) =>
      skill.scope === "project" && skill.projectIds.includes(projectId),
  );
  const seededSkills =
    projectSkills.length > 0
      ? projectSkills
      : [{ ...defaultProjectSkill(locale), projectIds: [projectId] }];
  const skillSlugs = new Set<string>();
  const resources: WorkspaceResource[] = [
    workspaceResource({
      id: `${connectionId}-agents`,
      projectId,
      path: "AGENTS.md",
      content: [
        translateMessage("project.workspace.heading.instructions", locale),
        "",
        project.instructions.trim(),
      ].join("\n"),
    }),
    workspaceResource({
      id: `${connectionId}-memory`,
      projectId,
      path: "MEMORY.md",
      content: projectMemoryMarkdown(projectMemories, locale),
    }),
    workspaceResource({
      id: `${connectionId}-notes`,
      projectId,
      path: "NOTES.md",
      content: translateMessage("project.workspace.heading.notes", locale),
    }),
    workspaceResource({
      id: `${connectionId}-memory-recent`,
      projectId,
      path: "memory/RECENT.md",
      content: translateMessage("project.workspace.heading.recent", locale),
    }),
    workspaceResource({
      id: `${connectionId}-memory-summaries`,
      projectId,
      path: "memory/SUMMARIES.md",
      content: translateMessage("project.workspace.heading.summaries", locale),
    }),
    workspaceResource({
      id: `${connectionId}-memory-evidence`,
      projectId,
      path: "memory/EVIDENCE.md",
      content: translateMessage("project.workspace.heading.evidence", locale),
    }),
    ...seededSkills.map((skill) => {
      const slug = normalizedSkillSlug(skill.id);
      if (skillSlugs.has(slug)) {
        throw new Error(`项目工作区包含重复 Skill：${slug}`);
      }
      skillSlugs.add(slug);
      return workspaceResource({
        id: `${connectionId}-skill-${slug}`,
        projectId,
        path: `skills/${slug}/SKILL.md`,
        content: projectSkillMarkdown(skill, slug),
      });
    }),
  ];
  const connection = createProjectWorkspaceConnection(
    project,
    resources.length,
    locale,
  );
  return { connection, resources };
}

function projectSymbol(name: string) {
  const characters = [...name.replace(/\s+/gu, "")];
  return characters.slice(0, 2).join("").toLocaleUpperCase() || "P";
}

export function createProjectWithWorkspace(input: {
  id: string;
  name: string;
  locale?: ProjectWorkspaceLocale;
}) {
  const locale = input.locale ?? "zh-CN";
  const id = assertSafeId(input.id, "项目 ID");
  const name = input.name.replace(/\s+/gu, " ").trim();
  if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error("项目名称需要为 1 到 80 个可见字符。");
  }
  const draft: Project = {
    id,
    name,
    symbol: projectSymbol(name),
    description: "",
    instructions: translateMessage(
      "project.workspace.default.instructions",
      locale,
    ),
    memoryCount: 0,
    skillCount: 1,
    connectionCount: 0,
    resourceCount: 0,
  };
  const bundle = createProjectWorkspaceBundle({
    project: draft,
    memories: [],
    skills: [],
    locale,
  });
  const project: Project = {
    ...draft,
    resourceCount: bundle.resources.length,
  };
  return {
    project,
    connection: { ...bundle.connection, account: project.name },
    resources: bundle.resources,
  };
}
