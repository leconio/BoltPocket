import type { ExecResult, ResolvedCommandContext } from "just-bash/browser";

export type ProjectShellEntryType = "file" | "directory";

export type ProjectShellFileStat = {
  type: ProjectShellEntryType;
  size: number;
};

export type ProjectShellDirectoryEntry = ProjectShellFileStat & {
  name: string;
};

/**
 * Project-scoped asynchronous storage. Paths passed by ProjectShell are always
 * normalized absolute paths and never escape `/`.
 */
export interface ProjectShellFileSystem {
  readFile(path: string, signal?: AbortSignal): Promise<string>;
  writeFile(
    path: string,
    contents: string,
    signal?: AbortSignal,
  ): Promise<void>;
  stat(
    path: string,
    signal?: AbortSignal,
  ): Promise<ProjectShellFileStat | null>;
  readDirectory(
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly ProjectShellDirectoryEntry[]>;
}

export type ProjectShellChange =
  | {
      path: string;
      kind: "created";
      before: null;
      after: string;
    }
  | {
      path: string;
      kind: "modified";
      before: string;
      after: string;
    }
  | {
      path: string;
      kind: "deleted";
      before: string;
      after: null;
    };

export type ProjectShellFetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export interface ProjectShellFetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers?: {
    forEach(callback: (value: string, key: string) => void): void;
  };
  text(): Promise<string>;
}

export type ProjectShellFetch = (
  url: string,
  init: ProjectShellFetchInit,
) => Promise<ProjectShellFetchResponse>;

export type ProjectShellCommandResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** A custom command may change the working directory for later commands. */
  cwd?: string;
};

export type ProjectShellCommandContext = {
  args: readonly string[];
  stdin: string;
  cwd: string;
  /** This is the execution overlay, not the underlying external storage. */
  fileSystem: ProjectShellFileSystem;
  fetch?: ProjectShellFetch;
  signal?: AbortSignal;
};

export type ProjectShellCommand = (
  context: ProjectShellCommandContext,
) => Promise<ProjectShellCommandResult> | ProjectShellCommandResult;

/**
 * Low-level repository command that runs directly against just-bash's scoped
 * overlay context. This port is for audited command implementations that need
 * binary filesystem operations, lstat/readdir, or nested ctx.exec. Connector
 * commands should use ProjectShellCommand instead.
 */
export interface ProjectShellRuntimeCommand {
  readonly name: string;
  readonly trusted: false;
  execute(
    args: string[],
    context: ProjectShellRuntimeCommandContext,
  ): Promise<ProjectShellRuntimeCommandResult>;
}

export type ProjectShellRuntimeCommandContext = ResolvedCommandContext;
export type ProjectShellRuntimeCommandResult = ExecResult;

export type ProjectShellOptions = {
  fileSystem: ProjectShellFileSystem;
  /** Absolute virtual boundary. Mobile projects pass `/project`. */
  root?: string;
  fetch?: ProjectShellFetch;
  commands?: Readonly<Record<string, ProjectShellCommand>>;
  /** Audited repository commands with direct access to the scoped overlay. */
  runtimeCommands?: readonly ProjectShellRuntimeCommand[];
  javaScriptRuntime?: ProjectShellJavaScriptRuntime;
  limits?: Partial<ProjectShellLimits>;
};

export type ProjectShellLimits = {
  maxCommandLength: number;
  maxOutputBytes: number;
  maxProjectEntries: number;
  maxProjectBytes: number;
  maxExecutionTimeMs: number;
  maxJavaScriptMemoryBytes: number;
  maxJavaScriptStackBytes: number;
};

export type ProjectShellJavaScriptFile = {
  path: string;
  contents: string;
};

export type ProjectShellJavaScriptExecuteInput = {
  source: string;
  filename: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  files: readonly ProjectShellJavaScriptFile[];
  limits: {
    memoryBytes: number;
    stackBytes: number;
    outputBytes: number;
    timeoutMs: number;
  };
  signal?: AbortSignal;
};

export type ProjectShellJavaScriptExecuteResult = {
  stdout: string;
  stderr: string;
  result?: string | null;
  exitCode: number;
  changes?: readonly ProjectShellChange[];
};

/**
 * Capability port for a separately isolated native interpreter. Implementors
 * must not evaluate source on the host React Native/Hermes realm.
 */
export interface ProjectShellJavaScriptRuntime {
  execute(
    input: ProjectShellJavaScriptExecuteInput,
  ): Promise<ProjectShellJavaScriptExecuteResult>;
}

export type ProjectShellCapabilityStatus =
  | "available"
  | "requires_fetch"
  | "requires_javascript_runtime"
  | "unavailable_on_react_native";

export type ProjectShellCommandCapability = {
  command: string;
  status: ProjectShellCapabilityStatus;
  reason?: string;
};

export type ProjectShellExecuteInput = {
  command: string;
  cwd?: string;
  signal?: AbortSignal;
};

export type ProjectShellExecuteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  /** Deterministic staged changes. ProjectShell never commits them itself. */
  changes: readonly ProjectShellChange[];
};
