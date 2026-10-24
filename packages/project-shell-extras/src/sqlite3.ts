/*
 * sqlite3 CLI-shaped adapter. just-bash 3.2.0 uses sql.js in a Worker; React
 * Native cannot safely bundle that path, so database execution is injected.
 * The adapter is read-only because a binary database cannot become the required
 * deterministic text Diff. A write-capable adapter therefore fails validation.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { byteLength, stdinText } from "./bytes.ts";
import { assertByteLimit, assertNotAborted } from "./limits.ts";
import type {
  ExtraCommandContext,
  ExtraCommandResult,
  ProjectShellExtraCommand,
  ProjectShellExtraLimits,
  ProjectShellSqliteAdapter,
  SqliteExecutionResult,
  SqliteResultSet,
  SqliteValue,
} from "./types.ts";

type OutputMode = "list" | "csv" | "json" | "line" | "column";

type SqliteOptions = {
  databasePath: string;
  sql: string;
  headers: boolean;
  mode: OutputMode;
  separator: string;
  nullValue: string;
};

const SQLITE_HELP = `Usage: sqlite3 [OPTIONS] DATABASE [SQL]
Execute bounded SQL through the app-provided native SQLite adapter.

  -header | -noheader       show or hide column names
  -list | -csv | -json     select output mode
  -line | -column          select output mode
  -separator STRING        list output separator
  -nullvalue STRING        text used for NULL
  -readonly                accepted; read-only is always the default policy

Without a native adapter the command reports capability unavailable. SQL writes
are rejected because binary database changes cannot produce a unified text Diff.
`;

export function createSqlite3Command(
  limits: ProjectShellExtraLimits,
  adapter: ProjectShellSqliteAdapter | undefined,
): ProjectShellExtraCommand {
  return {
    name: "sqlite3",
    trusted: false,
    async execute(args, context) {
      if (args.includes("--help") || args.includes("-help"))
        return success(SQLITE_HELP);
      if (!adapter)
        return failure("sqlite3: native SQLite capability is unavailable", 127);
      const parsed = parseSqliteArgs(args, context, limits);
      if ("error" in parsed) return failure(parsed.error, 2);
      try {
        return await executeSqlite(parsed, context, limits, adapter);
      } catch (error) {
        if (context.signal?.aborted)
          return failure("sqlite3: interrupted", 130);
        return failure(`sqlite3: ${safeError(error)}`, 1);
      }
    },
  };
}

function parseSqliteArgs(
  args: readonly string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): SqliteOptions | { error: string } {
  let headers = false;
  let mode: OutputMode = "list";
  let separator = "|";
  let nullValue = "";
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (argument === "-header") headers = true;
    else if (argument === "-noheader") headers = false;
    else if (argument === "-list") mode = "list";
    else if (argument === "-csv") mode = "csv";
    else if (argument === "-json") mode = "json";
    else if (argument === "-line") mode = "line";
    else if (argument === "-column") mode = "column";
    else if (argument === "-readonly" || argument === "-batch") {
      // Always non-interactive; mutation policy is enforced below.
    } else if (argument === "-separator" || argument === "-nullvalue") {
      const value = args[++index];
      if (value === undefined)
        return { error: `sqlite3: ${argument} requires a value` };
      if (byteLength(value) > limits.maxSqlCellBytes)
        return { error: `sqlite3: ${argument} is too large` };
      if (argument === "-separator") separator = value;
      else nullValue = value;
    } else if (argument.startsWith("-"))
      return { error: `sqlite3: unknown option '${argument}'` };
    else positional.push(argument);
  }
  const databasePath = positional.shift();
  if (!databasePath) return { error: "sqlite3: database path is required" };
  let sql = positional.join(" ");
  if (!sql) {
    try {
      sql = stdinText(context.stdin, limits.maxInputBytes);
    } catch (error) {
      return { error: `sqlite3: ${safeError(error)}` };
    }
  }
  if (!sql.trim())
    return {
      error: "sqlite3: SQL input is required; interactive mode is unavailable",
    };
  if (sql.trimStart().startsWith("."))
    return { error: "sqlite3: dot commands are unavailable" };
  if (separator.includes("\0") || nullValue.includes("\0")) {
    return { error: "sqlite3: NUL is not allowed in formatting options" };
  }
  assertByteLimit("sqlite3 SQL", byteLength(sql), limits.maxInputBytes);
  return { databasePath, sql, headers, mode, separator, nullValue };
}

async function executeSqlite(
  options: SqliteOptions,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
  adapter: ProjectShellSqliteAdapter,
): Promise<ExtraCommandResult> {
  assertNotAborted(context.signal);
  const statements = splitSqlStatements(options.sql);
  if (statements.length === 0) throw new Error("SQL input is empty");
  if (statements.length > limits.maxStructuredNodes)
    throw new Error("SQL statement limit exceeded");
  const readOnly = statements.every(isReadOnlyStatement);
  if (!readOnly) {
    return failure(
      "sqlite3: SQL mutations are unavailable because binary changes cannot produce a text Diff",
      126,
    );
  }

  const path = context.fs.resolvePath(context.cwd, options.databasePath);
  const exists = await context.fs.exists(path);
  const database = exists
    ? (await context.fs.readFileBuffer(path)).slice()
    : null;
  if (database)
    assertByteLimit(
      "SQLite database",
      database.byteLength,
      limits.maxDatabaseBytes,
    );
  if (!exists && readOnly)
    return failure(`sqlite3: ${options.databasePath}: No such database`, 1);

  const result = await executeWithDeadline(
    adapter,
    {
      databasePath: path,
      database,
      sql: options.sql,
      readOnly,
      maxRows: limits.maxSqlRows,
      maxColumns: limits.maxSqlColumns,
      maxCellBytes: limits.maxSqlCellBytes,
      maxOutputBytes: limits.maxOutputBytes,
      maxDatabaseBytes: limits.maxDatabaseBytes,
      timeoutMs: limits.maxSqlTimeMs,
      signal: context.signal,
    },
    limits.maxSqlTimeMs,
    context.signal,
  );

  validateSqliteResult(result, limits);
  const stdout = formatSqliteResult(result.resultSets, options, limits);
  return success(stdout);
}

async function executeWithDeadline(
  adapter: ProjectShellSqliteAdapter,
  input: Parameters<ProjectShellSqliteAdapter["execute"]>[0],
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<SqliteExecutionResult> {
  const controller = new AbortController();
  const abort = (): void =>
    controller.abort(
      parentSignal?.reason ?? new Error("SQLite execution aborted"),
    );
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("SQLite execution timed out")),
    timeoutMs,
  );
  try {
    return await Promise.race([
      adapter.execute({ ...input, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              controller.signal.reason instanceof Error
                ? controller.signal.reason
                : new Error("SQLite aborted"),
            ),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function validateSqliteResult(
  result: SqliteExecutionResult,
  limits: ProjectShellExtraLimits,
): void {
  const candidate = result as SqliteExecutionResult & {
    changed: unknown;
    database?: unknown;
  };
  if (
    !candidate ||
    !Array.isArray(candidate.resultSets) ||
    candidate.changed !== false
  ) {
    throw new Error("invalid SQLite adapter result");
  }
  if (result.resultSets.length > limits.maxSqlRows)
    throw new Error("SQLite result-set limit exceeded");
  if ("database" in candidate)
    throw new Error("read-only adapter returned database bytes");
  let totalRows = 0;
  let totalColumns = 0;
  let totalValueBytes = 0;
  for (const set of result.resultSets) {
    if (!Array.isArray(set.columns) || !Array.isArray(set.rows))
      throw new Error("invalid SQLite result set");
    if (set.columns.length > limits.maxSqlColumns)
      throw new Error("SQLite column limit exceeded");
    totalColumns += set.columns.length;
    if (totalColumns > limits.maxSqlRows * limits.maxSqlColumns) {
      throw new Error("SQLite aggregate column limit exceeded");
    }
    totalRows += set.rows.length;
    if (totalRows > limits.maxSqlRows)
      throw new Error("SQLite row limit exceeded");
    for (const column of set.columns) {
      if (typeof column !== "string")
        throw new Error("invalid SQLite column name");
      assertByteLimit(
        "SQLite column",
        byteLength(column),
        limits.maxSqlCellBytes,
      );
      totalValueBytes += byteLength(column);
      assertByteLimit(
        "SQLite aggregate result",
        totalValueBytes,
        limits.maxOutputBytes,
      );
    }
    for (const row of set.rows) {
      if (!Array.isArray(row) || row.length !== set.columns.length)
        throw new Error("invalid SQLite row width");
      for (const value of row) {
        validateSqliteValue(value, limits.maxSqlCellBytes);
        totalValueBytes += sqliteDisplayByteLength(value);
        assertByteLimit(
          "SQLite aggregate result",
          totalValueBytes,
          limits.maxOutputBytes,
        );
      }
    }
  }
}

function sqliteDisplayByteLength(value: SqliteValue): number {
  if (value === null) return 0;
  if (value instanceof Uint8Array) return value.byteLength * 2 + 3;
  return byteLength(String(value));
}

function validateSqliteValue(value: SqliteValue, maximum: number): void {
  if (value === null) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite SQLite number");
    return;
  }
  if (typeof value === "string")
    assertByteLimit("SQLite cell", byteLength(value), maximum);
  else if (value instanceof Uint8Array)
    assertByteLimit("SQLite blob", value.byteLength, maximum);
  else throw new Error("unsupported SQLite value");
}

function formatSqliteResult(
  sets: readonly SqliteResultSet[],
  options: SqliteOptions,
  limits: ProjectShellExtraLimits,
): string {
  const chunks: string[] = [];
  let bytes = 0;
  const append = (value: string): void => {
    bytes += byteLength(value);
    assertByteLimit("sqlite3 output", bytes, limits.maxOutputBytes);
    chunks.push(value);
  };
  for (const set of sets) {
    if (options.mode === "json") {
      const rows = set.rows.map((row) => {
        const object = Object.create(null) as Record<string, unknown>;
        set.columns.forEach((column, index) => {
          Object.defineProperty(object, column, {
            value: jsonSqliteValue(row[index] ?? null),
            enumerable: true,
            configurable: true,
          });
        });
        return object;
      });
      append(`${JSON.stringify(rows)}\n`);
      continue;
    }
    if (options.mode === "line") {
      for (const row of set.rows) {
        set.columns.forEach((column, index) =>
          append(
            `${column} = ${displayValue(row[index] ?? null, options.nullValue)}\n`,
          ),
        );
        append("\n");
      }
      continue;
    }
    const rows = options.headers ? [set.columns, ...set.rows] : set.rows;
    if (options.mode === "column") {
      const widths = set.columns.map((column, index) =>
        Math.max(
          options.headers ? column.length : 0,
          ...set.rows.map(
            (row) => displayValue(row[index] ?? null, options.nullValue).length,
          ),
        ),
      );
      for (const row of rows) {
        append(
          `${row
            .map((value, index) =>
              displayValue(value, options.nullValue).padEnd(widths[index] ?? 0),
            )
            .join("  ")
            .trimEnd()}\n`,
        );
      }
      continue;
    }
    for (const row of rows) {
      const values = row.map((value) => displayValue(value, options.nullValue));
      append(
        `${options.mode === "csv" ? values.map(csvCell).join(",") : values.join(options.separator)}\n`,
      );
    }
  }
  return chunks.join("");
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | "]" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index++) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (quote === "]" ? current === "]" : current === quote) {
        if (quote !== "]" && next === quote) index++;
        else quote = null;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index++;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index++;
    } else if (current === "'" || current === '"' || current === "`")
      quote = current;
    else if (current === "[") quote = "]";
    else if (current === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote || blockComment)
    throw new Error("unterminated SQL quote or comment");
  const final = sql.slice(start).trim();
  if (final) statements.push(final);
  return statements;
}

function isReadOnlyStatement(statement: string): boolean {
  const stripped = statement
    .replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "")
    .toUpperCase();
  return (
    stripped.startsWith("SELECT ") ||
    stripped === "SELECT" ||
    stripped.startsWith("VALUES ") ||
    stripped === "VALUES" ||
    stripped.startsWith("EXPLAIN ")
  );
}

function displayValue(value: SqliteValue, nullValue: string): string {
  if (value === null) return nullValue;
  if (value instanceof Uint8Array)
    return `X'${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  return String(value);
}

function jsonSqliteValue(value: SqliteValue): unknown {
  return value instanceof Uint8Array
    ? {
        $blobHex: [...value]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      }
    : value;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\0]/g, " ")
    .slice(0, 512);
}

function success(stdout: string): ExtraCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function failure(message: string, exitCode: number): ExtraCommandResult {
  return { stdout: "", stderr: `${message.replace(/\n+$/, "")}\n`, exitCode };
}
