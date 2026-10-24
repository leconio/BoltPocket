/*
 * Command contracts are structurally compatible with just-bash 3.2.0's
 * Command and ResolvedCommandContext types. Keeping this repository-owned
 * boundary avoids importing a Node-specific just-bash entry point into Metro.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export type ExtraCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutKind?: "text" | "bytes";
  stdoutEncoding?: "binary";
};

export type ExtraFsStat = {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  mode: number;
  size: number;
  mtime: Date;
};

export interface ExtraFileSystem {
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<ExtraFsStat>;
  lstat(path: string): Promise<ExtraFsStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  resolvePath(base: string, path: string): string;
}

export interface ExtraCommandContext {
  fs: ExtraFileSystem;
  cwd: string;
  env: Map<string, string>;
  /** just-bash represents pipeline bytes as a latin1-shaped opaque string. */
  stdin: unknown;
  signal?: AbortSignal;
  exec?: (
    command: string,
    options: {
      cwd: string;
      stdin?: string;
      stdinKind?: "text" | "bytes";
      signal?: AbortSignal;
      args?: string[];
    },
  ) => Promise<ExtraCommandResult>;
}

export interface ProjectShellExtraCommand {
  name: "tar" | "yq" | "xan" | "sqlite3";
  trusted: false;
  execute(
    args: string[],
    context: ExtraCommandContext,
  ): Promise<ExtraCommandResult>;
}

export type ProjectShellExtraLimits = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxArchiveBytes: number;
  maxArchiveEntries: number;
  maxExtractedBytes: number;
  maxTraversalEntries: number;
  maxPathDepth: number;
  maxStructuredDepth: number;
  maxStructuredNodes: number;
  maxCsvRows: number;
  maxCsvCells: number;
  maxCellBytes: number;
  maxSqlRows: number;
  maxSqlColumns: number;
  maxSqlCellBytes: number;
  maxSqlTimeMs: number;
  maxDatabaseBytes: number;
};

export type SqliteValue = string | number | null | Uint8Array;

export type SqliteExecutionInput = {
  databasePath: string;
  database: Uint8Array | null;
  sql: string;
  readOnly: true;
  maxRows: number;
  maxColumns: number;
  maxCellBytes: number;
  maxOutputBytes: number;
  maxDatabaseBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type SqliteResultSet = {
  columns: readonly string[];
  rows: readonly (readonly SqliteValue[])[];
};

export type SqliteExecutionResult = {
  resultSets: readonly SqliteResultSet[];
  /** A read-only adapter must always return false. Checked again at runtime. */
  changed: false;
};

/**
 * The adapter owns an isolated native database handle. It must enforce every
 * supplied bound before crossing the JS bridge and must never write the VFS or
 * an external connector directly.
 */
export interface ProjectShellSqliteAdapter {
  execute(input: SqliteExecutionInput): Promise<SqliteExecutionResult>;
}

export type ProjectShellExtrasOptions = {
  limits?: Partial<ProjectShellExtraLimits>;
  sqlite?: ProjectShellSqliteAdapter;
};
