import type {
  ProjectShellDirectoryEntry,
  ProjectShellFileStat,
  ProjectShellFileSystem,
} from "@boltpocket/project-shell";

import type { ResourceReadBudget } from "@/application/resource-read-budget";
import type { WorkspaceResource } from "@/domain/models";
import { isProjectWorkspaceResource } from "@/domain/project-workspace";

export const PROJECT_SHELL_ROOT = "/project";

type WorkspaceProjectShellOptions = {
  projectId: string;
  resources: readonly WorkspaceResource[];
  readBudget: ResourceReadBudget;
};

type MountedResource = {
  resource: WorkspaceResource;
  path: string;
};

function encodeConnectionSegment(connectionId: string) {
  if (!connectionId || /[\u0000-\u001f\u007f]/u.test(connectionId)) {
    throw new Error("项目连接器 ID 不能映射到 project_shell。");
  }
  const encoded = [...connectionId]
    .map((character) =>
      /^[a-zA-Z0-9._-]$/u.test(character) && character !== "~"
        ? character
        : `~${character.codePointAt(0)!.toString(16)}~`,
    )
    .join("");
  if (encoded === "." || encoded === "..") {
    return [...encoded].map(() => "~2e~").join("");
  }
  return encoded;
}

export function projectShellRootForConnection(connectionId: string) {
  return `${PROJECT_SHELL_ROOT}/${encodeConnectionSegment(connectionId)}`;
}

function resourcePathSegments(path: string) {
  if (!path || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw new Error("项目资源路径不能映射到 project_shell。");
  }
  const segments = path.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`项目资源路径不安全：${path}`);
  }
  return segments;
}

export function projectShellPathForResource(resource: WorkspaceResource) {
  if (isProjectWorkspaceResource(resource)) {
    return [PROJECT_SHELL_ROOT, ...resourcePathSegments(resource.path)].join(
      "/",
    );
  }
  return [
    projectShellRootForConnection(resource.connectionId),
    ...resourcePathSegments(resource.path),
  ].join("/");
}

export function normalizeProjectShellPath(path: string) {
  if (!path.startsWith("/") || /\0/u.test(path)) {
    throw new Error(`project_shell 只允许绝对项目路径：${path}`);
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`project_shell 禁止路径越界：${path}`);
    }
    segments.push(segment);
  }
  const normalized = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  if (
    normalized !== "/" &&
    normalized !== PROJECT_SHELL_ROOT &&
    !normalized.startsWith(`${PROJECT_SHELL_ROOT}/`)
  ) {
    throw new Error(`project_shell 路径不在当前项目范围：${path}`);
  }
  return normalized;
}

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("project_shell 已取消。");
  error.name = "AbortError";
  throw error;
}

export class WorkspaceProjectShellFileSystem implements ProjectShellFileSystem {
  readonly #files = new Map<string, MountedResource>();
  readonly #directories = new Set<string>(["/", PROJECT_SHELL_ROOT]);
  readonly #children = new Map<string, Map<string, "file" | "directory">>();
  readonly #readBudget: ResourceReadBudget;

  constructor(options: WorkspaceProjectShellOptions) {
    this.#readBudget = options.readBudget;
    this.#children.set("/", new Map([["project", "directory"]]));
    this.#children.set(PROJECT_SHELL_ROOT, new Map());

    for (const resource of options.resources) {
      if (resource.projectId !== options.projectId) continue;
      const path = projectShellPathForResource(resource);
      this.#mountDirectory(parentPath(path));
      if (this.#files.has(path) || this.#directories.has(path)) {
        throw new Error(`项目资源映射路径冲突：${path}`);
      }
      this.#files.set(path, { path, resource });
      this.#addChild(parentPath(path), baseName(path), "file");
    }
  }

  pathForResourceId(resourceId: string) {
    for (const mounted of this.#files.values()) {
      if (mounted.resource.id === resourceId) return mounted.path;
    }
    return undefined;
  }

  resourceForPath(path: string) {
    return this.#files.get(normalizeProjectShellPath(path))?.resource;
  }

  async readFile(path: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const mounted = this.#files.get(normalized);
    if (!mounted) {
      throw new Error(`project_shell 不能读取未授权资源：${normalized}`);
    }
    this.#readBudget.register(
      mounted.resource.id,
      mounted.resource.content.length,
    );
    return mounted.resource.content;
  }

  async writeFile(
    path: string,
    _contents: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    throw new Error(
      `project_shell 基础文件系统是只读快照，修改只能形成 Diff：${normalized}`,
    );
  }

  async stat(
    path: string,
    signal?: AbortSignal,
  ): Promise<ProjectShellFileStat | null> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const mounted = this.#files.get(normalized);
    if (mounted) {
      return {
        type: "file",
        size: utf8ByteLength(mounted.resource.content),
      };
    }
    return this.#directories.has(normalized)
      ? { type: "directory", size: 0 }
      : null;
  }

  async readDirectory(
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly ProjectShellDirectoryEntry[]> {
    throwIfAborted(signal);
    const normalized = normalizeProjectShellPath(path);
    const children = this.#children.get(normalized);
    if (!children) {
      throw new Error(`project_shell 不能列出未授权目录：${normalized}`);
    }
    return [...children]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, type]) => {
        if (type === "directory") return { name, type, size: 0 };
        const childPath =
          normalized === "/" ? `/${name}` : `${normalized}/${name}`;
        const mounted = this.#files.get(childPath)!;
        return {
          name,
          type,
          size: utf8ByteLength(mounted.resource.content),
        };
      });
  }

  #mountDirectory(path: string) {
    if (this.#directories.has(path)) return;
    const parent = parentPath(path);
    this.#mountDirectory(parent);
    if (this.#files.has(path)) {
      throw new Error(`项目目录和资源路径冲突：${path}`);
    }
    this.#directories.add(path);
    this.#children.set(path, new Map());
    this.#addChild(parent, baseName(path), "directory");
  }

  #addChild(parent: string, name: string, type: "file" | "directory") {
    const children = this.#children.get(parent);
    if (!children) throw new Error(`项目目录映射缺失：${parent}`);
    const existing = children.get(name);
    if (existing && existing !== type) {
      throw new Error(`项目目录项映射冲突：${parent}/${name}`);
    }
    children.set(name, type);
  }
}

export function assertProjectShellCwd(cwd: string) {
  const normalized = normalizeProjectShellPath(cwd);
  if (
    normalized !== PROJECT_SHELL_ROOT &&
    !normalized.startsWith(`${PROJECT_SHELL_ROOT}/`)
  ) {
    throw new Error(`project_shell 工作目录必须位于 ${PROJECT_SHELL_ROOT}。`);
  }
  return normalized;
}
