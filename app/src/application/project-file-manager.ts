import type { ChangeProposal, WorkspaceResource } from "../domain/models.ts";
import {
  isBinaryProjectWorkspaceResource,
  isReadOnlyWorkspaceResource,
} from "../domain/models.ts";
import { createTextDiffLines } from "../domain/text-diff.ts";
import {
  createProjectWorkspaceFileResource,
  isProjectWorkspaceResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
  projectWorkspaceConnectionId,
} from "../domain/project-workspace.ts";
import { translateMessage } from "../i18n/messages.ts";
import type { AppLocale } from "../i18n/translate.ts";

export const MAX_PROJECT_FILE_EDIT_CHARACTERS = 100_000;
export const MAX_PROJECT_FILE_EDIT_LINES = 1_000;
export const PROJECT_DIRECTORY_MARKER = ".boltpocket-folder";

export type ProjectFileEntry = {
  kind: "file";
  name: string;
  path: string;
  resource: WorkspaceResource;
};

export type ProjectDirectoryEntry = {
  kind: "directory";
  name: string;
  path: string;
};

export type ProjectExplorerEntry = ProjectDirectoryEntry | ProjectFileEntry;

export type ProjectFileEditability =
  { editable: true } | { editable: false; reason: string };

function compareText(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function lineCount(content: string) {
  if (!content) return 0;
  let count = 1;
  for (const character of content) {
    if (character === "\n") count += 1;
  }
  return count;
}

export function normalizeProjectResourcePath(path: string) {
  if (
    !path ||
    path.length > 2_000 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return null;
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function projectFilesForProject(
  resources: readonly WorkspaceResource[],
  projectId: string,
) {
  return resources
    .flatMap<ProjectFileEntry>((resource) => {
      if (resource.projectId !== projectId) return [];
      const path = normalizeProjectResourcePath(resource.path);
      if (!path) return [];
      return [
        {
          kind: "file",
          name: path.split("/").at(-1)!,
          path,
          resource,
        },
      ];
    })
    .sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.resource.id, right.resource.id),
    );
}

export function listProjectDirectory(
  resources: readonly WorkspaceResource[],
  projectId: string,
  directory = "",
): ProjectExplorerEntry[] {
  const normalizedDirectory = directory
    ? normalizeProjectResourcePath(directory)
    : "";
  if (normalizedDirectory === null) return [];

  const prefix = normalizedDirectory ? `${normalizedDirectory}/` : "";
  const directories = new Map<string, ProjectDirectoryEntry>();
  const files: ProjectFileEntry[] = [];

  for (const file of projectFilesForProject(resources, projectId)) {
    if (!file.path.startsWith(prefix)) continue;
    const relativePath = file.path.slice(prefix.length);
    const separatorIndex = relativePath.indexOf("/");
    if (separatorIndex === -1) {
      if (file.name !== PROJECT_DIRECTORY_MARKER) files.push(file);
      continue;
    }

    const name = relativePath.slice(0, separatorIndex);
    const path = prefix ? `${prefix}${name}` : name;
    if (!directories.has(path)) {
      directories.set(path, { kind: "directory", name, path });
    }
  }

  return [
    ...[...directories.values()].sort((left, right) =>
      compareText(left.name, right.name),
    ),
    ...files.sort(
      (left, right) =>
        compareText(left.name, right.name) ||
        compareText(left.resource.id, right.resource.id),
    ),
  ];
}

export function parentProjectDirectory(directory: string) {
  const normalized = directory ? normalizeProjectResourcePath(directory) : "";
  if (!normalized) return "";
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex === -1 ? "" : normalized.slice(0, separatorIndex);
}

export function getProjectFileEditability(
  resource: WorkspaceResource,
): ProjectFileEditability {
  if (!normalizeProjectResourcePath(resource.path)) {
    return {
      editable: false,
      reason: "文件路径不安全，仅允许项目内相对路径。",
    };
  }
  if (isBinaryProjectWorkspaceResource(resource)) {
    return {
      editable: false,
      reason: "这是复制到项目的二进制资源，可查看来源但不能作为文本编辑。",
    };
  }
  if (isReadOnlyWorkspaceResource(resource)) {
    return { editable: false, reason: "这个来源是只读快照，只能预览。" };
  }
  if (resource.content.includes("\0")) {
    return { editable: false, reason: "这个文件不是可编辑的纯文本。" };
  }
  if (resource.content.length > MAX_PROJECT_FILE_EDIT_CHARACTERS) {
    return {
      editable: false,
      reason: `文件超过 ${MAX_PROJECT_FILE_EDIT_CHARACTERS.toLocaleString("en-US")} 个字符，仅支持预览。`,
    };
  }
  if (lineCount(resource.content) > MAX_PROJECT_FILE_EDIT_LINES) {
    return {
      editable: false,
      reason: `文件超过 ${MAX_PROJECT_FILE_EDIT_LINES.toLocaleString("en-US")} 行，仅支持预览。`,
    };
  }
  return { editable: true };
}

function assertEditableContent(content: string) {
  if (content.includes("\0")) {
    throw new Error("项目文件只能保存纯文本内容。");
  }
  if (content.length > MAX_PROJECT_FILE_EDIT_CHARACTERS) {
    throw new Error(
      `修改后的文件不能超过 ${MAX_PROJECT_FILE_EDIT_CHARACTERS.toLocaleString("en-US")} 个字符。`,
    );
  }
  if (lineCount(content) > MAX_PROJECT_FILE_EDIT_LINES) {
    throw new Error(
      `修改后的文件不能超过 ${MAX_PROJECT_FILE_EDIT_LINES.toLocaleString("en-US")} 行。`,
    );
  }
}

export function createProjectFileEditProposal(input: {
  projectId: string;
  conversationId: string;
  resource: WorkspaceResource;
  after: string;
  connectorLabel: string;
  proposalId: string;
  hunkId: string;
  createdAt: string;
  locale?: AppLocale;
}): ChangeProposal {
  const { resource } = input;
  const locale = input.locale ?? "zh-CN";
  if (resource.projectId !== input.projectId) {
    throw new Error("文件不属于当前项目。");
  }
  if (!input.conversationId) {
    throw new Error("项目没有可用于记录修改的对话。");
  }
  const editability = getProjectFileEditability(resource);
  if (!editability.editable) throw new Error(editability.reason);
  assertEditableContent(input.after);
  if (input.after === resource.content) {
    throw new Error("文件内容没有变化，无需生成 Diff。");
  }

  return {
    id: input.proposalId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    title: translateMessage("changes.generated.manualTitle", locale, {
      path: resource.path,
    }),
    titleMessage: {
      key: "changes.generated.manualTitle",
      values: { path: resource.path },
    },
    kind: "manual",
    status: "pending",
    connectorId: resource.connectionId,
    connector: input.connectorLabel || resource.connectionId,
    createdAt: input.createdAt,
    hunks: [
      {
        id: input.hunkId,
        resourceId: resource.id,
        target: resource.path,
        baseVersion: resource.version,
        before: resource.content,
        after: input.after,
        summary: translateMessage("changes.generated.manualSummary", locale),
        summaryMessage: { key: "changes.generated.manualSummary" },
        lines: createTextDiffLines(
          resource.path,
          resource.content,
          input.after,
        ),
      },
    ],
  };
}

export function createProjectFileCreateProposal(input: {
  projectId: string;
  conversationId: string;
  path: string;
  content: string;
  connectorLabel: string;
  proposalId: string;
  hunkId: string;
  createdAt: string;
  locale?: AppLocale;
}): ChangeProposal {
  const locale = input.locale ?? "zh-CN";
  if (!input.conversationId) {
    throw new Error("项目没有可用于记录修改的对话。");
  }
  assertEditableContent(input.content);
  const draft = createProjectWorkspaceFileResource({
    projectId: input.projectId,
    path: input.path,
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  return {
    id: input.proposalId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    title: translateMessage("changes.generated.manualTitle", locale, {
      path: draft.path,
    }),
    titleMessage: {
      key: "changes.generated.manualTitle",
      values: { path: draft.path },
    },
    kind: "manual",
    status: "pending",
    connectorId: projectWorkspaceConnectionId(input.projectId),
    connector:
      input.connectorLabel || projectWorkspaceConnectionId(input.projectId),
    createdAt: input.createdAt,
    hunks: [
      {
        id: input.hunkId,
        resourceId: draft.id,
        target: draft.path,
        operation: "create",
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: input.content,
        summary: translateMessage("changes.generated.manualSummary", locale),
        summaryMessage: { key: "changes.generated.manualSummary" },
        lines: createTextDiffLines(draft.path, "", input.content),
      },
    ],
  };
}

export function projectResourcePath(
  directory: string,
  name: string,
  kind: "file" | "directory",
) {
  const normalizedDirectory = directory
    ? normalizeProjectResourcePath(directory)
    : "";
  const trimmedName = name.trim();
  if (
    normalizedDirectory === null ||
    !trimmedName ||
    trimmedName !== name ||
    trimmedName.includes("/") ||
    trimmedName === "." ||
    trimmedName === ".." ||
    trimmedName === PROJECT_DIRECTORY_MARKER ||
    /[\u0000-\u001f\u007f\\]/u.test(trimmedName)
  ) {
    throw new Error(`${kind === "file" ? "文件" : "文件夹"}名称无效。`);
  }
  const path = normalizedDirectory
    ? `${normalizedDirectory}/${trimmedName}`
    : trimmedName;
  if (!normalizeProjectResourcePath(path)) {
    throw new Error("项目资源路径无效。");
  }
  return path;
}

export function createProjectDirectoryCreateProposal(
  input: Omit<
    Parameters<typeof createProjectFileCreateProposal>[0],
    "path" | "content"
  > & { path: string },
) {
  const directory = normalizeProjectResourcePath(input.path);
  if (!directory) throw new Error("文件夹路径无效。");
  return createProjectFileCreateProposal({
    ...input,
    path: `${directory}/${PROJECT_DIRECTORY_MARKER}`,
    content: "",
  });
}

export function createProjectEntryRenameProposal(input: {
  projectId: string;
  conversationId: string;
  entry: ProjectExplorerEntry;
  destinationPath: string;
  resources: readonly WorkspaceResource[];
  connectorLabel: string;
  proposalId: string;
  createdAt: string;
  locale?: AppLocale;
}): ChangeProposal {
  const locale = input.locale ?? "zh-CN";
  const destination = normalizeProjectResourcePath(input.destinationPath);
  if (!destination || destination === input.entry.path) {
    throw new Error("新的资源路径无效或没有变化。");
  }
  if (
    input.entry.kind === "directory" &&
    destination.startsWith(`${input.entry.path}/`)
  ) {
    throw new Error("不能把文件夹移动到它自己内部。");
  }
  const sourceResources = resourcesForEntry(input);
  const sourceIds = new Set(sourceResources.map((resource) => resource.id));
  const mapped = sourceResources.map((resource) => {
    const suffix =
      input.entry.kind === "directory"
        ? resource.path.slice(input.entry.path.length)
        : "";
    return { resource, target: `${destination}${suffix}` };
  });
  for (const { target } of mapped) {
    if (!normalizeProjectResourcePath(target)) {
      throw new Error("重命名后的资源路径无效。");
    }
    const collision = input.resources.find(
      (resource) =>
        resource.projectId === input.projectId &&
        !sourceIds.has(resource.id) &&
        (resource.path === target ||
          resource.path.startsWith(`${target}/`) ||
          target.startsWith(`${resource.path}/`)),
    );
    if (collision) throw new Error(`目标已存在：${target}`);
  }

  return manualEntryProposal({
    ...input,
    titlePath: `${input.entry.path} → ${destination}`,
    hunks: mapped.flatMap(({ resource, target }, index) => [
      createCopyHunk(
        resource,
        target,
        input.projectId,
        input.proposalId,
        index,
      ),
      createDeleteHunk(resource, input.proposalId, index),
    ]),
    locale,
  });
}

export function createProjectEntryDeleteProposal(input: {
  projectId: string;
  conversationId: string;
  entry: ProjectExplorerEntry;
  resources: readonly WorkspaceResource[];
  connectorLabel: string;
  proposalId: string;
  createdAt: string;
  locale?: AppLocale;
}): ChangeProposal {
  const sourceResources = resourcesForEntry(input);
  return manualEntryProposal({
    ...input,
    titlePath: input.entry.path,
    hunks: sourceResources.map((resource, index) =>
      createDeleteHunk(resource, input.proposalId, index),
    ),
    locale: input.locale ?? "zh-CN",
  });
}

function resourcesForEntry(input: {
  projectId: string;
  entry: ProjectExplorerEntry;
  resources: readonly WorkspaceResource[];
}) {
  const resources = input.resources.filter(
    (resource) =>
      resource.projectId === input.projectId &&
      (input.entry.kind === "file"
        ? resource.id === input.entry.resource.id
        : resource.path.startsWith(`${input.entry.path}/`)),
  );
  if (resources.length === 0) throw new Error("项目资源已不存在。");
  for (const resource of resources) {
    if (
      !isProjectWorkspaceResource(resource) ||
      isReadOnlyWorkspaceResource(resource)
    ) {
      throw new Error("连接器或只读来源不能在资源管理器中重命名或删除。");
    }
  }
  return resources;
}

function createCopyHunk(
  resource: WorkspaceResource,
  target: string,
  projectId: string,
  proposalId: string,
  index: number,
) {
  const draft = createProjectWorkspaceFileResource({
    projectId,
    path: target,
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const binary = isBinaryProjectWorkspaceResource(resource)
    ? resource.storage.binary
    : undefined;
  return {
    id: `${proposalId}-create-${index + 1}`,
    resourceId: draft.id,
    target,
    operation: "create" as const,
    ...(binary
      ? { binaryFile: { ...binary, source: { ...binary.source } } }
      : {}),
    baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
    before: "",
    after: resource.content,
    summary: `重命名到 ${target}`,
    lines: binary
      ? binaryDiffLines(
          target,
          binary.mimeType,
          binary.byteLength,
          binary.sha256,
          "addition",
        )
      : createTextDiffLines(target, "", resource.content),
  };
}

function createDeleteHunk(
  resource: WorkspaceResource,
  proposalId: string,
  index: number,
) {
  const binary = isBinaryProjectWorkspaceResource(resource)
    ? resource.storage.binary
    : undefined;
  return {
    id: `${proposalId}-delete-${index + 1}`,
    resourceId: resource.id,
    target: resource.path,
    operation: "delete" as const,
    baseVersion: resource.version,
    before: resource.content,
    after: "",
    summary: `删除 ${resource.path}`,
    lines: binary
      ? binaryDiffLines(
          resource.path,
          binary.mimeType,
          binary.byteLength,
          binary.sha256,
          "deletion",
        )
      : createTextDiffLines(resource.path, resource.content, ""),
  };
}

function binaryDiffLines(
  target: string,
  mimeType: string,
  byteLength: number,
  sha256: string,
  kind: "addition" | "deletion",
) {
  return [
    { kind: "meta" as const, text: `--- before/${target}` },
    { kind: "meta" as const, text: `+++ after/${target}` },
    { kind: "meta" as const, text: "@@ binary project file @@" },
    {
      kind,
      text: `${kind === "addition" ? "+" : "-"}${mimeType} · ${byteLength} bytes · sha256 ${sha256}`,
    },
  ];
}

function manualEntryProposal(input: {
  projectId: string;
  conversationId: string;
  connectorLabel: string;
  proposalId: string;
  createdAt: string;
  locale: AppLocale;
  titlePath: string;
  hunks: ChangeProposal["hunks"];
}): ChangeProposal {
  if (!input.conversationId) {
    throw new Error("项目没有可用于记录修改的对话。");
  }
  const connectorId = projectWorkspaceConnectionId(input.projectId);
  return {
    id: input.proposalId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    title: translateMessage("changes.generated.manualTitle", input.locale, {
      path: input.titlePath,
    }),
    titleMessage: {
      key: "changes.generated.manualTitle",
      values: { path: input.titlePath },
    },
    kind: "manual",
    status: "pending",
    connectorId,
    connector: input.connectorLabel || connectorId,
    createdAt: input.createdAt,
    hunks: input.hunks,
  };
}
