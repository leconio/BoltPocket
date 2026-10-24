import ignore from "ignore";
import { minimatch } from "minimatch";
import {
  MemoryProjectFileSystem,
  ProjectShellFileSystemError,
  type ProjectShellChange,
  type ProjectShellDirectoryEntry,
  type ProjectShellFileStat,
  type ProjectShellFileSystem,
} from "@boltpocket/project-shell";

import type { ResourceReadBudget } from "@/application/resource-read-budget";
import type { ProjectPreviewFile } from "@/application/ports/project-preview";
import { workspaceResourceToProjectPreviewFile } from "@/application/project-preview-files";
import { isProjectPreviewCandidatePath } from "@/infrastructure/browser/project-preview-policy";
import {
  isBinaryProjectWorkspaceResource,
  isReadOnlyWorkspaceResource,
  type WorkspaceResource,
} from "@/domain/models";
import {
  createProjectWorkspaceBinaryFileResource,
  createProjectWorkspaceFileResource,
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "@/domain/project-workspace";
import type { BuiltInProjectResourcePackId } from "@/domain/builtin-project-resources";
import {
  normalizeProjectShellPath,
  PROJECT_SHELL_ROOT,
  projectShellRootForConnection,
  projectShellPathForResource,
} from "@/infrastructure/agent/workspace-project-shell";

const MAX_STAGED_FILES = 10;
const MAX_STAGED_FILE_CHARACTERS = 100_000;

type WorkspacePiCodingToolsOptions = {
  projectId: string;
  resources: readonly WorkspaceResource[];
  readBudget: ResourceReadBudget;
  refreshResource: (resource: WorkspaceResource) => Promise<WorkspaceResource>;
};

type BuiltInResourceCopyInput = {
  path: string;
  packId: BuiltInProjectResourcePackId;
  sourcePath: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  contentBase64: string;
};

type MountedResource = {
  path: string;
  resource: WorkspaceResource;
  originalContent: string | null;
  refreshed: boolean;
  binary: boolean;
  stagedCopy: boolean;
};

export type StagedWorkspaceResourceChange =
  | {
      operation: "create" | "modify";
      path: string;
      resource: WorkspaceResource;
      before: string;
      after: string;
    }
  | {
      operation: "copy";
      path: string;
      resource: WorkspaceResource;
      before: "";
      after: string;
    };

export type WorkspaceGrepSearchInput = {
  pattern: string;
  path: string;
  glob?: string;
  ignoreCase: boolean;
  literal: boolean;
  limit: number;
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  throw error;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

function relativePath(root: string, path: string): string | undefined {
  if (path === root) return "";
  const prefix = root === "/" ? "/" : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function cloneResource(resource: WorkspaceResource): WorkspaceResource {
  return {
    ...resource,
    storage:
      resource.storage.kind === "project-workspace" && resource.storage.binary
        ? {
            ...resource.storage,
            binary: {
              ...resource.storage.binary,
              source: { ...resource.storage.binary.source },
            },
          }
        : { ...resource.storage },
  };
}

function binaryResourceMarker(resource: WorkspaceResource) {
  if (!isBinaryProjectWorkspaceResource(resource)) return resource.content;
  const binary = resource.storage.binary!;
  return `[binary project file: ${binary.mimeType}, ${binary.byteLength} bytes, sha256 ${binary.sha256}]\n`;
}

/**
 * Project-scoped capability backend for the upstream Pi Coding Agent tools.
 * It is an in-memory overlay: upstream edit/write/bash can mutate it, while
 * connector state remains untouched until the host's post-run Diff workflow.
 */
export class WorkspacePiCodingTools implements ProjectShellFileSystem {
  readonly #projectId: string;
  readonly #memory: MemoryProjectFileSystem;
  readonly #mountedByPath = new Map<string, MountedResource>();
  readonly #resourceIds = new Set<string>();
  readonly #reservedCreateRoots = new Set<string>();
  readonly #readBudget: ResourceReadBudget;
  readonly #refreshResource: WorkspacePiCodingToolsOptions["refreshResource"];
  #canCreateProjectFiles = false;

  constructor(options: WorkspacePiCodingToolsOptions) {
    this.#projectId = options.projectId;
    this.#readBudget = options.readBudget;
    this.#refreshResource = options.refreshResource;

    const initialFiles: [string, string][] = [];
    for (const candidate of options.resources) {
      if (candidate.projectId !== options.projectId) continue;
      const resource = cloneResource(candidate);
      this.#resourceIds.add(resource.id);
      if (isProjectWorkspaceResource(resource)) {
        this.#canCreateProjectFiles = true;
      } else {
        this.#reservedCreateRoots.add(
          projectShellRootForConnection(resource.connectionId),
        );
      }
      const path = projectShellPathForResource(resource);
      if (this.#mountedByPath.has(path)) {
        throw new Error(`项目资源映射路径冲突：${path}`);
      }
      this.#mountedByPath.set(path, {
        path,
        resource,
        originalContent: resource.content,
        refreshed: false,
        binary: isBinaryProjectWorkspaceResource(resource),
        stagedCopy: false,
      });
      initialFiles.push([path, binaryResourceMarker(resource)]);
    }
    this.#memory = new MemoryProjectFileSystem(initialFiles);
  }

  async readFile(path: string, signal?: AbortSignal): Promise<string> {
    const mounted = this.#requiredMounted(path);
    await this.#ensureRefreshed(mounted, signal);
    return this.#memory.readFile(mounted.path, signal);
  }

  async readFileBuffer(path: string, signal?: AbortSignal): Promise<Buffer> {
    return Buffer.from(await this.readFile(path, signal), "utf8");
  }

  async accessFile(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const stat = await this.#memory.stat(normalized, signal);
    if (stat?.type !== "file" || !this.#mountedByPath.has(normalized)) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "file not found",
      );
    }
  }

  async writeFile(
    path: string,
    contents: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const normalized = normalizeProjectShellPath(path);
    const mounted = this.#mountedByPath.get(normalized);
    if (!mounted) {
      await this.#createFile(normalized, contents, signal);
      return;
    }
    await this.#ensureRefreshed(mounted, signal);
    this.#assertWritable(mounted);
    this.#validateTextWrite(mounted.path, contents);
    const previous = await this.#memory.readFile(mounted.path, signal);
    await this.#memory.writeFile(mounted.path, contents, signal);
    try {
      this.#assertStagedFileLimit();
    } catch (error) {
      await this.#memory.writeFile(mounted.path, previous, signal);
      throw error;
    }
  }

  async mkdirExisting(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const stat = await this.#memory.stat(normalized, signal);
    if (stat?.type === "directory") return;
    if (stat?.type === "file") {
      throw new ProjectShellFileSystemError(
        "ENOTDIR",
        normalized,
        "file already exists at directory path",
      );
    }
    this.#assertCreatableProjectPath(normalized);
    await this.#memory.mkdir(normalized, signal);
  }

  stat(
    path: string,
    signal?: AbortSignal,
  ): Promise<ProjectShellFileStat | null> {
    const normalized = normalizeProjectShellPath(path);
    const mounted = this.#mountedByPath.get(normalized);
    if (mounted?.binary && isBinaryProjectWorkspaceResource(mounted.resource)) {
      return Promise.resolve({
        type: "file",
        size: mounted.resource.storage.binary!.byteLength,
      });
    }
    return this.#memory.stat(normalized, signal);
  }

  async readDirectory(
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly ProjectShellDirectoryEntry[]> {
    const normalized = normalizeProjectShellPath(path);
    const entries = await this.#memory.readDirectory(normalized, signal);
    return entries.map((entry) => {
      const mounted = this.#mountedByPath.get(
        normalized === "/" ? `/${entry.name}` : `${normalized}/${entry.name}`,
      );
      return mounted?.binary &&
        isBinaryProjectWorkspaceResource(mounted.resource)
        ? { ...entry, size: mounted.resource.storage.binary!.byteLength }
        : entry;
    });
  }

  async exists(path: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.stat(path, signal)) !== null;
  }

  async isDirectory(path: string, signal?: AbortSignal): Promise<boolean> {
    const normalized = normalizeProjectShellPath(path);
    const stat = await this.#memory.stat(normalized, signal);
    if (!stat) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "path not found",
      );
    }
    return stat.type === "directory";
  }

  async readdir(path: string, signal?: AbortSignal): Promise<string[]> {
    return (await this.readDirectory(path, signal)).map((entry) => entry.name);
  }

  async refreshAll(signal?: AbortSignal): Promise<void> {
    for (const mounted of this.#mountedByPath.values()) {
      await this.#ensureRefreshed(mounted, signal);
    }
  }

  async currentResources(signal?: AbortSignal): Promise<WorkspaceResource[]> {
    await this.refreshAll(signal);
    const snapshot = this.#memory.snapshot();
    return [...this.#mountedByPath.values()].map((mounted) =>
      mounted.binary
        ? cloneResource(mounted.resource)
        : {
            ...cloneResource(mounted.resource),
            content: snapshot[mounted.path]!,
          },
    );
  }

  async stageBuiltInResourceCopies(
    inputs: readonly BuiltInResourceCopyInput[],
    signal?: AbortSignal,
  ): Promise<readonly ("copied" | "existing")[]> {
    throwIfAborted(signal);
    if (inputs.length === 0) return [];
    const prepared = inputs.map((input) => {
      const normalized = normalizeProjectShellPath(input.path);
      this.#assertCreatableProjectPath(normalized);
      const candidate = createProjectWorkspaceBinaryFileResource({
        projectId: this.#projectId,
        path: normalized.slice(PROJECT_SHELL_ROOT.length + 1),
        contentBase64: input.contentBase64,
        packId: input.packId,
        sourcePath: input.sourcePath,
        mimeType: input.mimeType,
        byteLength: input.byteLength,
        sha256: input.sha256,
        version: PROJECT_WORKSPACE_ABSENT_VERSION,
      });
      return { normalized, candidate };
    });
    if (
      new Set(prepared.map((item) => item.normalized)).size !== prepared.length
    ) {
      throw new Error("项目资源复制目标不能重复。");
    }
    const statuses = prepared.map(({ normalized, candidate }) => {
      const existing = this.#mountedByPath.get(normalized);
      if (!existing) {
        if (this.#resourceIds.has(candidate.id)) {
          throw new Error(`项目资源 ID 冲突：${normalized}`);
        }
        return "copied" as const;
      }
      if (
        existing.binary &&
        existing.resource.content === candidate.content &&
        JSON.stringify(existing.resource.storage) ===
          JSON.stringify(candidate.storage)
      ) {
        return "existing" as const;
      }
      throw new Error(`项目资源目标已存在，不能覆盖：${normalized}`);
    });
    const newCount = statuses.filter((status) => status === "copied").length;
    if (this.stagedChanges().length + newCount > MAX_STAGED_FILES) {
      throw new Error(
        `一次 Agent 运行最多修改 ${MAX_STAGED_FILES} 个项目资源。`,
      );
    }
    const added: { path: string; resourceId: string }[] = [];
    try {
      for (let index = 0; index < prepared.length; index += 1) {
        if (statuses[index] === "existing") continue;
        const { normalized, candidate } = prepared[index]!;
        await this.#memory.mkdir(parentPath(normalized), signal);
        await this.#memory.writeFile(
          normalized,
          binaryResourceMarker(candidate),
          signal,
        );
        this.#resourceIds.add(candidate.id);
        this.#mountedByPath.set(normalized, {
          path: normalized,
          resource: candidate,
          originalContent: null,
          refreshed: true,
          binary: true,
          stagedCopy: true,
        });
        added.push({ path: normalized, resourceId: candidate.id });
      }
    } catch (error) {
      for (const item of added.reverse()) {
        await this.#memory.deleteFile(item.path).catch(() => undefined);
        this.#mountedByPath.delete(item.path);
        this.#resourceIds.delete(item.resourceId);
      }
      throw error;
    }
    return statuses;
  }

  async previewFiles(
    entryPath: string,
    signal?: AbortSignal,
  ): Promise<ProjectPreviewFile[]> {
    const normalized = normalizeProjectShellPath(entryPath);
    const entry = await this.#memory.stat(normalized, signal);
    if (entry?.type !== "file" || !this.#mountedByPath.has(normalized)) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "H5 preview entry was not found",
      );
    }
    const root = parentPath(normalized);
    const paths = (await this.#filePathsWithin(root, signal)).filter((path) =>
      isProjectPreviewCandidatePath(normalized, path),
    );
    const files: ProjectPreviewFile[] = [];
    for (const path of paths) {
      throwIfAborted(signal);
      const mounted = this.#mountedByPath.get(path);
      if (
        mounted?.binary &&
        isBinaryProjectWorkspaceResource(mounted.resource)
      ) {
        await this.#ensureRefreshed(mounted, signal);
        files.push(
          workspaceResourceToProjectPreviewFile(mounted.resource, path),
        );
      } else {
        files.push({ path, content: await this.readFile(path, signal) });
      }
    }
    return files;
  }

  async applyShellChanges(
    changes: readonly ProjectShellChange[],
    signal?: AbortSignal,
  ): Promise<void> {
    const previous = new Map<string, string>();
    const createdPaths: string[] = [];
    try {
      for (const change of changes) {
        throwIfAborted(signal);
        if (change.kind === "created") {
          await this.mkdirExisting(parentPath(change.path), signal);
          await this.writeFile(change.path, change.after, signal);
          createdPaths.push(normalizeProjectShellPath(change.path));
          continue;
        }
        if (change.kind === "deleted") {
          throw new Error(`Agent 不能删除项目资源：${change.path}`);
        }
        const mounted = this.#requiredMounted(change.path);
        if (previous.has(mounted.path)) {
          throw new Error(`项目命令重复返回同一路径变更：${change.path}`);
        }
        await this.#ensureRefreshed(mounted, signal);
        this.#assertWritable(mounted);
        const current = await this.#memory.readFile(mounted.path, signal);
        if (current !== change.before) {
          throw new Error(`项目工具叠加层版本冲突：${change.path}`);
        }
        this.#validateTextWrite(mounted.path, change.after);
        previous.set(mounted.path, current);
        await this.#memory.writeFile(mounted.path, change.after, signal);
      }
      this.#assertStagedFileLimit();
    } catch (error) {
      for (const [path, content] of previous) {
        await this.#memory.writeFile(path, content);
      }
      for (const path of createdPaths.reverse()) {
        const mounted = this.#mountedByPath.get(path);
        if (mounted?.originalContent === null) {
          await this.#memory.deleteFile(path).catch(() => undefined);
          this.#mountedByPath.delete(path);
          this.#resourceIds.delete(mounted.resource.id);
        }
      }
      throw error;
    }
  }

  stagedChanges(): StagedWorkspaceResourceChange[] {
    const snapshot = this.#memory.snapshot();
    return [...this.#mountedByPath.values()]
      .flatMap<StagedWorkspaceResourceChange>((mounted) => {
        if (mounted.binary) {
          return mounted.stagedCopy
            ? [
                {
                  operation: "copy",
                  path: mounted.path,
                  resource: cloneResource(mounted.resource),
                  before: "",
                  after: mounted.resource.content,
                },
              ]
            : [];
        }
        const after = snapshot[mounted.path];
        return after === undefined ||
          (mounted.originalContent !== null &&
            after === mounted.originalContent)
          ? []
          : [
              {
                operation:
                  mounted.originalContent === null ? "create" : "modify",
                path: mounted.path,
                resource: cloneResource(mounted.resource),
                before: mounted.originalContent ?? "",
                after,
              },
            ];
      })
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async glob(
    pattern: string,
    searchRoot: string,
    options: { ignore: string[]; limit: number },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const root = normalizeProjectShellPath(searchRoot);
    const candidates = await this.#filePathsWithin(root, signal);
    const results: string[] = [];
    for (const path of candidates) {
      throwIfAborted(signal);
      const relative = relativePath(root, path) ?? path;
      if (
        options.ignore.some((ignored) =>
          minimatch(relative, ignored, { dot: true, matchBase: true }),
        ) ||
        (await this.#isGitIgnored(path, signal)) ||
        !minimatch(relative, pattern, { dot: true, matchBase: true })
      ) {
        continue;
      }
      results.push(path);
      if (results.length >= options.limit) break;
    }
    return results;
  }

  async grep(input: WorkspaceGrepSearchInput): Promise<{
    matches: {
      filePath: string;
      lineNumber: number;
      lineText?: string;
    }[];
    limitReached?: boolean;
  }> {
    const root = normalizeProjectShellPath(input.path);
    const expression = new RegExp(
      input.literal ? escapeRegularExpression(input.pattern) : input.pattern,
      input.ignoreCase ? "i" : "",
    );
    const matches: {
      filePath: string;
      lineNumber: number;
      lineText?: string;
    }[] = [];
    for (const path of await this.#filePathsWithin(root, input.signal)) {
      throwIfAborted(input.signal);
      if (this.#mountedByPath.get(path)?.binary) continue;
      const relative = relativePath(root, path) ?? path.slice(1);
      if (
        (input.glob &&
          !minimatch(relative, input.glob, {
            dot: true,
            matchBase: true,
          })) ||
        (await this.#isGitIgnored(path, input.signal))
      ) {
        continue;
      }
      const content = await this.readFile(path, input.signal);
      const lines = content
        .replace(/\r\n/gu, "\n")
        .replace(/\r/gu, "\n")
        .split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        expression.lastIndex = 0;
        if (!expression.test(lines[index]!)) continue;
        matches.push({
          filePath: path,
          lineNumber: index + 1,
          lineText: lines[index],
        });
        if (matches.length > input.limit) {
          return {
            matches: matches.slice(0, input.limit),
            limitReached: true,
          };
        }
      }
    }
    return { matches };
  }

  async #ensureRefreshed(
    mounted: MountedResource,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    if (mounted.originalContent === null) return;
    if (!mounted.refreshed) {
      const refreshed = cloneResource(
        await this.#refreshResource(cloneResource(mounted.resource)),
      );
      throwIfAborted(signal);
      if (
        refreshed.id !== mounted.resource.id ||
        refreshed.projectId !== this.#projectId ||
        refreshed.connectionId !== mounted.resource.connectionId ||
        projectShellPathForResource(refreshed) !== mounted.path
      ) {
        throw new Error(`连接器返回了不匹配的项目资源：${mounted.path}`);
      }
      mounted.resource = refreshed;
      mounted.originalContent = refreshed.content;
      mounted.refreshed = true;
      await this.#memory.writeFile(
        mounted.path,
        mounted.binary ? binaryResourceMarker(refreshed) : refreshed.content,
        signal,
      );
    }
    this.#readBudget.register(
      mounted.resource.id,
      mounted.binary && isBinaryProjectWorkspaceResource(mounted.resource)
        ? mounted.resource.storage.binary!.byteLength
        : mounted.originalContent.length,
    );
  }

  #requiredMounted(path: string): MountedResource {
    const normalized = normalizeProjectShellPath(path);
    const mounted = this.#mountedByPath.get(normalized);
    if (!mounted) {
      throw new ProjectShellFileSystemError(
        "EACCES",
        normalized,
        "path is not an existing authorized project text resource",
      );
    }
    return mounted;
  }

  #assertCreatableProjectPath(path: string) {
    if (!this.#canCreateProjectFiles) {
      throw new ProjectShellFileSystemError(
        "EACCES",
        path,
        "the project has no writable project workspace",
      );
    }
    if (path === PROJECT_SHELL_ROOT) return;
    const relative = path.startsWith(`${PROJECT_SHELL_ROOT}/`)
      ? path.slice(PROJECT_SHELL_ROOT.length + 1)
      : "";
    if (!isSafeProjectWorkspacePath(relative)) {
      throw new ProjectShellFileSystemError(
        "EACCES",
        path,
        "path is outside the writable project workspace",
      );
    }
    for (const root of this.#reservedCreateRoots) {
      if (path === root || path.startsWith(`${root}/`)) {
        throw new ProjectShellFileSystemError(
          "EACCES",
          path,
          "connector-mounted paths cannot contain new project files",
        );
      }
    }
  }

  async #createFile(path: string, contents: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    this.#assertCreatableProjectPath(path);
    this.#validateTextWrite(path, contents);
    const parent = parentPath(path);
    if ((await this.#memory.stat(parent, signal))?.type !== "directory") {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        parent,
        "parent directory not found",
      );
    }
    if (await this.#memory.stat(path, signal)) {
      throw new ProjectShellFileSystemError(
        "EACCES",
        path,
        "project path already exists",
      );
    }
    const relative = path.slice(PROJECT_SHELL_ROOT.length + 1);
    const resource = createProjectWorkspaceFileResource({
      projectId: this.#projectId,
      path: relative,
      content: "",
      version: PROJECT_WORKSPACE_ABSENT_VERSION,
    });
    if (this.#resourceIds.has(resource.id)) {
      throw new Error(`项目文件资源 ID 冲突：${relative}`);
    }
    await this.#memory.writeFile(path, contents, signal);
    this.#resourceIds.add(resource.id);
    this.#mountedByPath.set(path, {
      path,
      resource,
      originalContent: null,
      refreshed: true,
      binary: false,
      stagedCopy: false,
    });
    try {
      this.#assertStagedFileLimit();
    } catch (error) {
      await this.#memory.deleteFile(path, signal);
      this.#mountedByPath.delete(path);
      this.#resourceIds.delete(resource.id);
      throw error;
    }
  }

  #assertWritable(mounted: MountedResource) {
    if (mounted.binary || isReadOnlyWorkspaceResource(mounted.resource)) {
      throw new ProjectShellFileSystemError(
        "EACCES",
        mounted.path,
        "this project resource is read-only",
      );
    }
  }

  async #filePathsWithin(
    path: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const stat = await this.#memory.stat(normalized, signal);
    if (!stat) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "path not found",
      );
    }
    if (stat.type === "file") return [normalized];
    return [...this.#mountedByPath.keys()]
      .filter((candidate) => relativePath(normalized, candidate) !== undefined)
      .sort((left, right) => left.localeCompare(right));
  }

  async #isGitIgnored(path: string, signal?: AbortSignal): Promise<boolean> {
    let directory = parentPath(path);
    const scopes: string[] = [];
    while (
      directory === PROJECT_SHELL_ROOT ||
      directory.startsWith(`${PROJECT_SHELL_ROOT}/`)
    ) {
      scopes.push(directory);
      if (directory === PROJECT_SHELL_ROOT) break;
      directory = parentPath(directory);
    }
    for (const scope of scopes.reverse()) {
      const gitignorePath = `${scope}/.gitignore`;
      if (!this.#mountedByPath.has(gitignorePath)) continue;
      const relative = relativePath(scope, path);
      if (!relative) continue;
      const matcher = ignore().add(await this.readFile(gitignorePath, signal));
      if (matcher.ignores(relative)) return true;
    }
    return false;
  }

  #validateTextWrite(path: string, contents: string): void {
    if (contents.length > MAX_STAGED_FILE_CHARACTERS) {
      throw new Error(
        `项目工具修改结果超过 ${MAX_STAGED_FILE_CHARACTERS.toLocaleString()} 字符：${path}`,
      );
    }
    if (contents.includes("\0")) {
      throw new Error(`项目工具只能生成纯文本修改：${path}`);
    }
  }

  #assertStagedFileLimit(): void {
    if (this.stagedChanges().length > MAX_STAGED_FILES) {
      throw new Error(
        `一次 Agent 运行最多修改 ${MAX_STAGED_FILES} 个项目资源。`,
      );
    }
  }
}
