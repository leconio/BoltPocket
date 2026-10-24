import type {
  ProjectShellDirectoryEntry,
  ProjectShellFileStat,
  ProjectShellFileSystem,
} from "./types.ts";
import { ProjectShellFileSystemError } from "./errors.ts";
import {
  baseProjectName,
  parentProjectPath,
  resolveProjectPath,
} from "./path.ts";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  }
}

export function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }
  return length;
}

/** React Native-safe in-memory project filesystem for tests and previews. */
export class MemoryProjectFileSystem implements ProjectShellFileSystem {
  readonly #files = new Map<string, string>();
  readonly #directories = new Set<string>(["/"]);

  constructor(
    initialFiles:
      | Readonly<Record<string, string>>
      | Iterable<readonly [string, string]> = {},
  ) {
    const entries =
      Symbol.iterator in Object(initialFiles)
        ? (initialFiles as Iterable<readonly [string, string]>)
        : Object.entries(initialFiles);
    for (const [path, contents] of entries) {
      const normalized = resolveProjectPath("/", path);
      if (normalized === "/") {
        throw new ProjectShellFileSystemError(
          "EISDIR",
          normalized,
          "cannot initialize root as a file",
        );
      }
      this.#addParents(normalized);
      this.#files.set(normalized, contents);
    }
  }

  async readFile(path: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    if (this.#directories.has(normalized)) {
      throw new ProjectShellFileSystemError(
        "EISDIR",
        normalized,
        "cannot read directory",
      );
    }
    const value = this.#files.get(normalized);
    if (value === undefined) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "file not found",
      );
    }
    return value;
  }

  async writeFile(
    path: string,
    contents: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    if (normalized === "/" || this.#directories.has(normalized)) {
      throw new ProjectShellFileSystemError(
        "EISDIR",
        normalized,
        "cannot write directory",
      );
    }
    const parent = parentProjectPath(normalized);
    if (!this.#directories.has(parent)) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        parent,
        "parent directory not found",
      );
    }
    this.#files.set(normalized, contents);
  }

  async mkdir(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    let current = "";
    for (const segment of normalized.split("/").filter(Boolean)) {
      current = `${current}/${segment}`;
      if (this.#files.has(current)) {
        throw new ProjectShellFileSystemError(
          "ENOTDIR",
          current,
          "file already exists at directory path",
        );
      }
      this.#directories.add(current);
    }
  }

  async deleteFile(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    if (!this.#files.delete(normalized)) {
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "file not found",
      );
    }
  }

  async stat(
    path: string,
    signal?: AbortSignal,
  ): Promise<ProjectShellFileStat | null> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    if (this.#directories.has(normalized)) {
      return { type: "directory", size: 0 };
    }
    const contents = this.#files.get(normalized);
    return contents === undefined
      ? null
      : { type: "file", size: utf8ByteLength(contents) };
  }

  async readDirectory(
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly ProjectShellDirectoryEntry[]> {
    throwIfAborted(signal);
    const normalized = resolveProjectPath("/", path);
    if (!this.#directories.has(normalized)) {
      if (this.#files.has(normalized)) {
        throw new ProjectShellFileSystemError(
          "ENOTDIR",
          normalized,
          "not a directory",
        );
      }
      throw new ProjectShellFileSystemError(
        "ENOENT",
        normalized,
        "directory not found",
      );
    }

    const results = new Map<string, ProjectShellDirectoryEntry>();
    for (const directory of this.#directories) {
      if (
        directory !== normalized &&
        parentProjectPath(directory) === normalized
      ) {
        results.set(baseProjectName(directory), {
          name: baseProjectName(directory),
          type: "directory",
          size: 0,
        });
      }
    }
    for (const [file, contents] of this.#files) {
      if (parentProjectPath(file) === normalized) {
        results.set(baseProjectName(file), {
          name: baseProjectName(file),
          type: "file",
          size: utf8ByteLength(contents),
        });
      }
    }
    return [...results.values()].sort((a, b) => compareNames(a.name, b.name));
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.#files.entries()].sort());
  }

  #addParents(path: string): void {
    let parent = parentProjectPath(path);
    while (!this.#directories.has(parent)) {
      this.#directories.add(parent);
      parent = parentProjectPath(parent);
    }
  }
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
