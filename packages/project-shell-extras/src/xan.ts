/*
 * Bounded CSV operations adapted from just-bash 3.2.0's xan command. This is
 * data processing over the virtual project filesystem, never a subprocess.
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
} from "./types.ts";
import {
  assertTableBounds,
  formatCsv,
  jsonScalar,
  parseCsvRows,
  readCsv,
  readTextInput,
  resolveColumns,
  type CsvTable,
} from "./xan-csv.ts";

type Handler = (
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
) => Promise<ExtraCommandResult>;

const SUPPORTED = new Set([
  "agg",
  "behead",
  "cat",
  "count",
  "dedup",
  "drop",
  "enum",
  "explode",
  "filter",
  "fixlengths",
  "fmt",
  "frequency",
  "freq",
  "from",
  "groupby",
  "head",
  "headers",
  "implode",
  "rename",
  "reverse",
  "sample",
  "search",
  "select",
  "shuffle",
  "slice",
  "sort",
  "stats",
  "tail",
  "to",
  "top",
  "transpose",
  "view",
  "flatten",
  "f",
]);

const UPSTREAM_UNAVAILABLE = new Set([
  "flatmap",
  "join",
  "map",
  "merge",
  "partition",
  "pivot",
  "split",
  "transform",
  "fuzzy-join",
  "glob",
  "hist",
  "input",
  "parallel",
  "plot",
  "progress",
  "range",
  "scrape",
  "tokenize",
  "union-find",
]);

const XAN_HELP = `Usage: xan <COMMAND> [OPTIONS] [FILE]
Bounded CSV toolkit for the project filesystem.

Core: headers count head tail slice reverse behead sample shuffle
Columns: select drop rename enum
Rows: filter search sort dedup top
Reshape: explode implode transpose
Aggregate: agg groupby frequency stats
Multi-file: cat
Conversion/output: to from fmt fixlengths view flatten

Expressions that require xan's Moonblade/JQ translation and commands that can
multiply files are reported as unavailable instead of being partially parsed.
`;

export function createXanCommand(
  limits: ProjectShellExtraLimits,
): ProjectShellExtraCommand {
  return {
    name: "xan",
    trusted: false,
    async execute(args, context) {
      if (args.length === 0 || args.includes("--help"))
        return success(XAN_HELP);
      const subcommand = args[0] ?? "";
      if (UPSTREAM_UNAVAILABLE.has(subcommand)) {
        return failure(
          `xan ${subcommand}: unavailable in the mobile-safe build`,
          1,
        );
      }
      if (!SUPPORTED.has(subcommand)) {
        return failure(`xan: unknown command '${subcommand}'`, 1);
      }
      try {
        return (
          (await handlers[subcommand]?.(args.slice(1), context, limits)) ??
          failure(`xan ${subcommand}: unavailable in the mobile-safe build`, 1)
        );
      } catch (error) {
        if (context.signal?.aborted)
          return failure(`xan ${subcommand}: interrupted`, 130);
        return failure(`xan ${subcommand}: ${safeError(error)}`, 1);
      }
    },
  };
}

const handlers: Readonly<Record<string, Handler>> = {
  headers: async (args, context, limits) => {
    const justNames = takeBoolean(args, "-j", "--just-names");
    const table = await readCsv(singleFile(args), context, limits);
    const stdout = `${table.headers
      .map((header, index) => (justNames ? header : `${index}   ${header}`))
      .join("\n")}${table.headers.length ? "\n" : ""}`;
    assertByteLimit("xan output", byteLength(stdout), limits.maxOutputBytes);
    return success(stdout);
  },
  count: async (args, context, limits) => {
    const table = await readCsv(singleFile(args), context, limits);
    return success(`${table.rows.length}\n`);
  },
  head: async (args, context, limits) =>
    sliceEnd(args, context, limits, "head"),
  tail: async (args, context, limits) =>
    sliceEnd(args, context, limits, "tail"),
  reverse: async (args, context, limits) => {
    const table = await readCsv(singleFile(args), context, limits);
    return success(
      formatCsv({ ...table, rows: [...table.rows].reverse() }, limits),
    );
  },
  slice: async (args, context, limits) => {
    const start = takeIntegerOption(
      args,
      ["-s", "--start"],
      0,
      limits.maxCsvRows,
    );
    const end = takeIntegerOption(args, ["-e", "--end"], -1, limits.maxCsvRows);
    const length = takeIntegerOption(
      args,
      ["-l", "--len"],
      -1,
      limits.maxCsvRows,
    );
    const table = await readCsv(singleFile(args), context, limits);
    const effectiveEnd =
      length >= 0 ? start + length : end >= 0 ? end : table.rows.length;
    return success(
      formatCsv(
        { ...table, rows: table.rows.slice(start, effectiveEnd) },
        limits,
      ),
    );
  },
  behead: async (args, context, limits) => {
    const table = await readCsv(singleFile(args), context, limits);
    return success(formatCsv(table, limits, false));
  },
  select: async (args, context, limits) =>
    selectOrDrop(args, context, limits, false),
  drop: async (args, context, limits) =>
    selectOrDrop(args, context, limits, true),
  rename: rename,
  enum: enumerate,
  search: search,
  filter: filter,
  sort: sort,
  dedup: deduplicate,
  top: top,
  sample: sample,
  shuffle: shuffle,
  explode: explode,
  implode: implode,
  transpose: transpose,
  fixlengths: fixLengths,
  view: view,
  flatten: flatten,
  f: flatten,
  cat: concatenate,
  to: toFormat,
  from: fromFormat,
  fmt: async (args, context, limits) => {
    const table = await readCsv(singleFile(args), context, limits);
    return success(formatCsv(table, limits));
  },
  agg: aggregate,
  groupby: groupBy,
  frequency: frequency,
  freq: frequency,
  stats: stats,
};

async function sliceEnd(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
  side: "head" | "tail",
): Promise<ExtraCommandResult> {
  const length = takeIntegerOption(args, ["-l", "-n"], 10, limits.maxCsvRows);
  const table = await readCsv(singleFile(args), context, limits);
  const rows =
    side === "head" ? table.rows.slice(0, length) : table.rows.slice(-length);
  return success(formatCsv({ ...table, rows }, limits));
}

async function selectOrDrop(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
  drop: boolean,
): Promise<ExtraCommandResult> {
  const specification = args.shift();
  if (!specification)
    return failure(
      `xan ${drop ? "drop" : "select"}: column selector required`,
      1,
    );
  const table = await readCsv(singleFile(args), context, limits);
  const resolved = resolveColumns(table.headers, specification);
  const chosen = new Set(resolved);
  const indexes = drop
    ? table.headers.flatMap((_, index) => (!chosen.has(index) ? [index] : []))
    : resolved;
  assertDerivedShape(
    table.rows.length,
    indexes.length,
    limits,
    drop ? "drop" : "select",
  );
  return success(formatCsv(projectColumns(table, indexes), limits));
}

async function rename(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const names = args.shift()?.split(",") ?? [];
  if (names.length === 0)
    return failure("xan rename: new column name required", 1);
  const selector = takeStringOption(args, ["-s", "--select"]);
  const table = await readCsv(singleFile(args), context, limits);
  const indexes = selector
    ? resolveColumns(table.headers, selector)
    : table.headers.map((_, index) => index);
  if (indexes.length !== names.length)
    throw new Error("rename count does not match selected columns");
  const headers = [...table.headers];
  indexes.forEach((column, index) => {
    headers[column] = names[index] ?? "";
  });
  if (new Set(headers).size !== headers.length)
    throw new Error("rename creates duplicate headers");
  return success(formatCsv({ headers, rows: table.rows }, limits));
}

async function enumerate(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const name = takeStringOption(args, ["-c", "--column"]) ?? "index";
  const table = await readCsv(singleFile(args), context, limits);
  if (table.headers.includes(name))
    throw new Error(`column '${name}' already exists`);
  const result = {
    headers: [name, ...table.headers],
    rows: table.rows.map((row, index) => [String(index), ...row]),
  };
  return success(formatCsv(result, limits));
}

async function search(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const selector = takeStringOption(args, ["-s", "--select"]);
  const invert = takeBoolean(args, "-v", "--invert");
  const ignoreCase = takeBoolean(args, "-i", "--ignore-case");
  takeBoolean(args, "-r", "--regex");
  const pattern = args.shift();
  if (pattern === undefined) return failure("xan search: pattern required", 1);
  if (byteLength(pattern) > limits.maxCellBytes)
    throw new Error("search pattern is too large");
  const table = await readCsv(singleFile(args), context, limits);
  const columns = selector
    ? resolveColumns(table.headers, selector)
    : table.headers.map((_, index) => index);
  let work = 0;
  const rows = table.rows.filter((row, rowIndex) => {
    if ((rowIndex & 127) === 0) assertNotAborted(context.signal);
    const matched = columns.some((column) => {
      const value = row[column] ?? "";
      work += Math.max(1, pattern.length) * Math.max(1, value.length);
      if (work > 5_000_000)
        throw new Error("search work limit exceeded (5000000)");
      return safeRegexMatch(value, pattern, ignoreCase);
    });
    return invert ? !matched : matched;
  });
  return success(formatCsv({ ...table, rows }, limits));
}

async function filter(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const invert = takeBoolean(args, "-v", "--invert");
  const resultLimit = takeIntegerOption(
    args,
    ["-l", "--limit"],
    limits.maxCsvRows,
    limits.maxCsvRows,
  );
  const expression = args.shift();
  if (!expression) return failure("xan filter: expression required", 1);
  const predicate = parseFilterExpression(expression);
  const table = await readCsv(singleFile(args), context, limits);
  const column = table.headers.indexOf(predicate.column);
  if (column < 0)
    throw new Error(`unknown filter column '${predicate.column}'`);
  const rows: string[][] = [];
  if (resultLimit === 0) return success(formatCsv({ ...table, rows }, limits));
  for (let index = 0; index < table.rows.length; index++) {
    if ((index & 127) === 0) assertNotAborted(context.signal);
    const row = table.rows[index] ?? [];
    const matched = compareFilter(
      row[column] ?? "",
      predicate.operator,
      predicate.value,
    );
    if (invert ? !matched : matched) {
      rows.push(row);
      if (rows.length >= resultLimit) break;
    }
  }
  return success(formatCsv({ ...table, rows }, limits));
}

async function sort(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const selector = takeStringOption(args, ["-s", "--select"]);
  if (!selector) return failure("xan sort: -s COLUMN is required", 1);
  const numeric = takeBoolean(args, "-N", "--numeric");
  const reverse = takeBoolean(args, "-R", "--reverse");
  const table = await readCsv(singleFile(args), context, limits);
  const columns = resolveColumns(table.headers, selector);
  if (columns.length > 64) throw new Error("sort column limit exceeded (64)");
  const sortWork =
    table.rows.length *
    Math.max(1, columns.length) *
    Math.ceil(Math.log2(table.rows.length + 1));
  if (sortWork > 5_000_000)
    throw new Error("sort work limit exceeded (5000000)");
  const rows = table.rows.map((row, index) => ({ row, index }));
  rows.sort((left, right) => {
    for (const column of columns) {
      const a = left.row[column] ?? "";
      const b = right.row[column] ?? "";
      const comparison = numeric
        ? compareNumberStrings(a, b)
        : a < b
          ? -1
          : a > b
            ? 1
            : 0;
      if (comparison) return reverse ? -comparison : comparison;
    }
    return left.index - right.index;
  });
  return success(
    formatCsv({ ...table, rows: rows.map(({ row }) => row) }, limits),
  );
}

async function deduplicate(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const selector = takeStringOption(args, ["-s", "--select"]);
  const table = await readCsv(singleFile(args), context, limits);
  const columns = selector
    ? resolveColumns(table.headers, selector)
    : table.headers.map((_, index) => index);
  const seen = new Set<string>();
  const rows = table.rows.filter((row) => {
    const key = tupleKey(columns.map((column) => row[column] ?? ""));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return success(formatCsv({ ...table, rows }, limits));
}

async function top(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const columnName = args.shift();
  if (!columnName) return failure("xan top: column required", 1);
  const length = takeIntegerOption(
    args,
    ["-l", "--limit"],
    10,
    limits.maxCsvRows,
  );
  const bottom = takeBoolean(args, "-R", "--reverse");
  const table = await readCsv(singleFile(args), context, limits);
  const column = resolveColumns(table.headers, columnName)[0];
  if (column === undefined) throw new Error(`unknown column '${columnName}'`);
  const rows = [...table.rows].sort((a, b) =>
    compareNumberStrings(b[column] ?? "", a[column] ?? ""),
  );
  if (bottom) rows.reverse();
  return success(formatCsv({ ...table, rows: rows.slice(0, length) }, limits));
}

async function sample(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const seed = takeIntegerOption(args, ["--seed"], 0, 0x7fffffff);
  const rawSize = args.shift();
  if (!rawSize || !/^\d+$/.test(rawSize))
    return failure("xan sample: sample size required", 1);
  const size = Math.min(Number(rawSize), limits.maxCsvRows);
  const table = await readCsv(singleFile(args), context, limits);
  const indices = table.rows.map((_, index) => index);
  shuffleIndexes(indices, seed);
  const rows = indices
    .slice(0, size)
    .sort((a, b) => a - b)
    .map((index) => table.rows[index] ?? []);
  return success(formatCsv({ ...table, rows }, limits));
}

async function shuffle(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const seed = takeIntegerOption(args, ["--seed"], 0, 0x7fffffff);
  const table = await readCsv(singleFile(args), context, limits);
  const indices = table.rows.map((_, index) => index);
  shuffleIndexes(indices, seed);
  return success(
    formatCsv(
      { ...table, rows: indices.map((index) => table.rows[index] ?? []) },
      limits,
    ),
  );
}

async function explode(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const columnName = args.shift();
  if (!columnName) return failure("xan explode: column required", 1);
  const separator = takeStringOption(args, ["-s", "--separator"]) ?? "|";
  const dropEmpty = takeBoolean(args, "--drop-empty");
  const rename = takeStringOption(args, ["-r", "--rename"]);
  if (!separator) throw new Error("separator cannot be empty");
  const table = await readCsv(singleFile(args), context, limits);
  const column = resolveColumns(table.headers, columnName)[0];
  if (column === undefined) throw new Error(`unknown column '${columnName}'`);
  const rows: string[][] = [];
  let derivedCells = 0;
  for (const row of table.rows) {
    const values = (row[column] ?? "").split(separator);
    for (const value of values) {
      if (dropEmpty && !value) continue;
      const next = [...row];
      next[column] = value;
      derivedCells += next.length;
      if (derivedCells + table.headers.length > limits.maxCsvCells)
        throw new Error("derived CSV cell limit exceeded");
      rows.push(next);
      if (rows.length > limits.maxCsvRows)
        throw new Error("derived CSV row limit exceeded");
    }
  }
  const headers = [...table.headers];
  if (rename) headers[column] = rename;
  if (new Set(headers).size !== headers.length)
    throw new Error("explode creates duplicate headers");
  return success(formatCsv({ headers, rows }, limits));
}

async function implode(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const columnName = args.shift();
  if (!columnName) return failure("xan implode: column required", 1);
  const separator = takeStringOption(args, ["-s", "--sep"]) ?? "|";
  const rename = takeStringOption(args, ["-r", "--rename"]);
  const table = await readCsv(singleFile(args), context, limits);
  const column = resolveColumns(table.headers, columnName)[0];
  if (column === undefined) throw new Error(`unknown column '${columnName}'`);
  if (table.rows.length === 0) return success(formatCsv(table, limits));
  const first = [...(table.rows[0] ?? [])];
  first[column] = table.rows.map((row) => row[column] ?? "").join(separator);
  assertByteLimit(
    "imploded CSV cell",
    byteLength(first[column] ?? ""),
    limits.maxCellBytes,
  );
  const headers = [...table.headers];
  if (rename) headers[column] = rename;
  return success(formatCsv({ headers, rows: [first] }, limits));
}

async function transpose(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const table = await readCsv(singleFile(args), context, limits);
  if (table.headers.length === 0) return success("");
  if (table.rows.length === 0) {
    assertDerivedShape(table.headers.length, 1, limits, "transpose");
    return success(
      formatCsv(
        { headers: ["column"], rows: table.headers.map((header) => [header]) },
        limits,
      ),
    );
  }
  const firstColumn = table.headers[0] ?? "column";
  assertDerivedShape(
    table.headers.length - 1,
    table.rows.length + 1,
    limits,
    "transpose",
  );
  const headers = [
    firstColumn,
    ...table.rows.map((row, index) => row[0] || `row_${index}`),
  ];
  if (new Set(headers).size !== headers.length)
    throw new Error("duplicate output headers");
  const rows = table.headers
    .slice(1)
    .map((header, column) => [
      header,
      ...table.rows.map((row) => row[column + 1] ?? ""),
    ]);
  return success(formatCsv({ headers, rows }, limits));
}

async function fixLengths(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const requestedLength = takeIntegerOption(
    args,
    ["-l", "--length"],
    0,
    limits.maxCsvCells,
  );
  const defaultValue = takeStringOption(args, ["-d", "--default"]) ?? "";
  assertByteLimit(
    "CSV default value",
    byteLength(defaultValue),
    limits.maxCellBytes,
  );
  const input = await readTextInput(singleFile(args), context, limits);
  const rawRows = parseCsvRows(input, limits);
  if (rawRows.length === 0) return success("");
  const targetLength =
    requestedLength ||
    rawRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  if (targetLength === 0) return success("");
  if (targetLength * rawRows.length > limits.maxCsvCells)
    throw new Error("derived CSV cell limit exceeded");
  const fixed = rawRows.map((row) => {
    const result = row.slice(0, targetLength);
    while (result.length < targetLength) result.push(defaultValue);
    return result;
  });
  const headers = fixed.shift() ?? [];
  if (new Set(headers).size !== headers.length)
    throw new Error("fixed CSV has duplicate headers");
  return success(formatCsv({ headers, rows: fixed }, limits));
}

async function view(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const table = await readCsv(singleFile(args), context, limits);
  if (table.headers.length === 0) return success("");
  const widths = table.headers.map((header, column) => {
    let width = header.length;
    for (const row of table.rows)
      width = Math.max(width, (row[column] ?? "").length);
    return Math.min(width, 80);
  });
  const chunks: string[] = [];
  let bytes = 0;
  const append = (line: string): void => {
    bytes += byteLength(line);
    assertByteLimit("xan output", bytes, limits.maxOutputBytes);
    chunks.push(line);
  };
  const show = (row: readonly string[]): string =>
    row
      .map((cell, index) =>
        truncateCell(cell, widths[index] ?? 0).padEnd(widths[index] ?? 0),
      )
      .join(" | ")
      .trimEnd();
  append(`${show(table.headers)}\n`);
  append(`${widths.map((width) => "-".repeat(width)).join("-+-")}\n`);
  for (const row of table.rows) append(`${show(row)}\n`);
  return success(chunks.join(""));
}

async function flatten(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const table = await readCsv(singleFile(args), context, limits);
  const chunks: string[] = [];
  let bytes = 0;
  const append = (line: string): void => {
    bytes += byteLength(line);
    assertByteLimit("xan output", bytes, limits.maxOutputBytes);
    chunks.push(line);
  };
  table.rows.forEach((row, rowIndex) => {
    append(`Row ${rowIndex}\n`);
    table.headers.forEach((header, column) =>
      append(`${header}: ${row[column] ?? ""}\n`),
    );
    append("\n");
  });
  return success(chunks.join(""));
}

async function concatenate(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const pad = takeBoolean(args, "-p", "--pad");
  if (args.length === 0) return failure("xan cat: no files specified", 1);
  if (args.length > limits.maxArchiveEntries)
    throw new Error("file count limit exceeded");
  const tables: CsvTable[] = [];
  let totalRows = 0;
  let totalCells = 0;
  for (const file of args) {
    const table = await readCsv(file, context, limits);
    totalRows += table.rows.length;
    totalCells +=
      table.headers.length +
      table.rows.reduce((sum, row) => sum + row.length, 0);
    if (totalRows > limits.maxCsvRows)
      throw new Error("combined CSV row limit exceeded");
    if (totalCells > limits.maxCsvCells)
      throw new Error("combined CSV cell limit exceeded");
    tables.push(table);
  }
  const headers = pad
    ? [...new Set(tables.flatMap((table) => table.headers))]
    : [...(tables[0]?.headers ?? [])];
  if (
    !pad &&
    tables.some((table) => tupleKey(table.headers) !== tupleKey(headers))
  ) {
    throw new Error("headers do not match (use -p to pad)");
  }
  assertDerivedShape(totalRows, headers.length, limits, "cat");
  const rows = tables.flatMap((table) =>
    table.rows.map((row) =>
      headers.map((header) => row[table.headers.indexOf(header)] ?? ""),
    ),
  );
  return success(formatCsv({ headers, rows }, limits));
}

async function toFormat(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const format = args.shift();
  if (format !== "json")
    return failure("xan to: only the json format is supported", 1);
  const table = await readCsv(singleFile(args), context, limits);
  const objects = table.rows.map((row) => {
    const object = Object.create(null) as Record<string, unknown>;
    table.headers.forEach((header, index) => {
      Object.defineProperty(object, header, {
        value: jsonScalar(row[index] ?? ""),
        enumerable: true,
        configurable: true,
      });
    });
    return object;
  });
  const stdout = `${JSON.stringify(objects, null, 2)}\n`;
  assertByteLimit("xan output", byteLength(stdout), limits.maxOutputBytes);
  return success(stdout);
}

async function fromFormat(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const format = takeStringOption(args, ["-f", "--format"]);
  if (format !== "json")
    return failure("xan from: usage: xan from -f json [FILE]", 1);
  const file = singleFile(args);
  const input = file
    ? await context.fs.readFile(context.fs.resolvePath(context.cwd, file))
    : stdinText(context.stdin, limits.maxInputBytes);
  assertByteLimit("xan input", byteLength(input), limits.maxInputBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return failure("xan from: invalid JSON input", 1);
  }
  if (!Array.isArray(parsed)) throw new Error("JSON input must be an array");
  let table: CsvTable;
  if (parsed.every(Array.isArray)) {
    const rows = parsed.map((row) => row.map(stringifyCell));
    table = { headers: rows.shift() ?? [], rows };
  } else if (
    parsed.every(
      (item) =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    )
  ) {
    const headers = [
      ...new Set(parsed.flatMap((item) => Object.keys(item as object))),
    ].sort();
    const rows = parsed.map((item) =>
      headers.map((header) =>
        stringifyCell((item as Record<string, unknown>)[header]),
      ),
    );
    table = { headers, rows };
  } else
    throw new Error(
      "JSON array elements must all have the same container kind",
    );
  assertTableBounds(table, limits);
  return success(formatCsv(table, limits));
}

async function aggregate(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const expression = args.shift();
  if (!expression)
    return failure("xan agg: aggregation expression required", 1);
  const table = await readCsv(singleFile(args), context, limits);
  const aggregations = parseAggregations(expression, table.headers);
  assertAggregationWork(aggregations.length, table.rows.length);
  assertDerivedShape(1, aggregations.length, limits, "agg");
  const row = aggregations.map((aggregation) =>
    computeAggregation(aggregation, table.rows),
  );
  return success(
    formatCsv(
      { headers: aggregations.map(({ output }) => output), rows: [row] },
      limits,
    ),
  );
}

async function groupBy(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const selector = args.shift();
  const expression = args.shift();
  takeBoolean(args, "--sorted");
  if (!selector || !expression)
    return failure("xan groupby: columns and aggregation required", 1);
  const table = await readCsv(singleFile(args), context, limits);
  const columns = resolveColumns(table.headers, selector);
  const aggregations = parseAggregations(expression, table.headers);
  const groups = new Map<string, { values: string[]; rows: string[][] }>();
  for (const row of table.rows) {
    const values = columns.map((column) => row[column] ?? "");
    const key = tupleKey(values);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { values, rows: [row] });
  }
  assertAggregationWork(aggregations.length, table.rows.length);
  assertDerivedShape(
    groups.size,
    columns.length + aggregations.length,
    limits,
    "groupby",
  );
  const rows = [...groups.values()].map((group) => [
    ...group.values,
    ...aggregations.map((aggregation) =>
      computeAggregation(aggregation, group.rows),
    ),
  ]);
  return success(
    formatCsv(
      {
        headers: [
          ...columns.map((column) => table.headers[column] ?? ""),
          ...aggregations.map(({ output }) => output),
        ],
        rows,
      },
      limits,
    ),
  );
}

async function frequency(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const selector = takeStringOption(args, ["-s", "--select"]);
  const limit = takeIntegerOption(
    args,
    ["-l", "--limit"],
    10,
    limits.maxCsvRows,
  );
  const all = takeBoolean(args, "-A", "--all");
  takeBoolean(args, "--no-extra");
  const table = await readCsv(singleFile(args), context, limits);
  const columns = selector
    ? resolveColumns(table.headers, selector)
    : table.headers.map((_, index) => index);
  const rows: string[][] = [];
  for (const column of columns) {
    const counts = new Map<
      string,
      { value: string; count: number; order: number }
    >();
    table.rows.forEach((row, order) => {
      const value = row[column] || "<empty>";
      const existing = counts.get(value);
      if (existing) existing.count++;
      else counts.set(value, { value, count: 1, order });
    });
    const sorted = [...counts.values()].sort(
      (a, b) => b.count - a.count || a.order - b.order,
    );
    for (const item of all || limit === 0 ? sorted : sorted.slice(0, limit)) {
      assertDerivedShape(rows.length + 1, 3, limits, "frequency");
      rows.push([table.headers[column] ?? "", item.value, String(item.count)]);
    }
  }
  return success(
    formatCsv({ headers: ["field", "value", "count"], rows }, limits),
  );
}

async function stats(
  args: string[],
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const table = await readCsv(singleFile(args), context, limits);
  assertDerivedShape(table.headers.length, 6, limits, "stats");
  const rows = table.headers.map((header, column) => {
    const values = table.rows.map((row) => row[column] ?? "").filter(Boolean);
    const numbers = values.map(Number);
    const numeric = values.length > 0 && numbers.every(Number.isFinite);
    if (!numeric) return [header, "String", String(values.length), "", "", ""];
    let sum = 0;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const value of numbers) {
      sum += value;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    return [
      header,
      "Number",
      String(values.length),
      String(minimum),
      String(maximum),
      String(sum / numbers.length),
    ];
  });
  return success(
    formatCsv(
      { headers: ["field", "type", "count", "min", "max", "mean"], rows },
      limits,
    ),
  );
}

type Aggregation = {
  functionName: string;
  column: number | null;
  output: string;
};

function parseAggregations(
  expression: string,
  headers: readonly string[],
): Aggregation[] {
  if (expression.length > 4_096)
    throw new Error("aggregation expression limit exceeded (4096)");
  const parts = splitTopLevel(expression);
  if (parts.length > 128)
    throw new Error("aggregation count limit exceeded (128)");
  return parts.map((part) => {
    const match = /^([a-z_]+)\(\s*([^()]*)\s*\)(?:\s+as\s+(.+))?$/i.exec(
      part.trim(),
    );
    if (!match) throw new Error(`unsupported aggregation '${part.trim()}'`);
    const functionName = (match[1] ?? "").toLowerCase();
    const argument = (match[2] ?? "").trim();
    const supported = new Set([
      "count",
      "sum",
      "mean",
      "avg",
      "min",
      "max",
      "first",
      "last",
      "median",
      "mode",
      "cardinality",
      "values",
      "distinct_values",
    ]);
    if (!supported.has(functionName))
      throw new Error(`unsupported aggregation '${functionName}'`);
    const column = argument ? headers.indexOf(argument) : null;
    if (argument && column === -1)
      throw new Error(`unknown aggregation column '${argument}'`);
    if (functionName !== "count" && column === null)
      throw new Error(`${functionName} requires a column`);
    return { functionName, column, output: (match[3] ?? part.trim()).trim() };
  });
}

function computeAggregation(
  aggregation: Aggregation,
  rows: readonly string[][],
): string {
  if (aggregation.functionName === "count") return String(rows.length);
  const values = rows.map((row) => row[aggregation.column ?? -1] ?? "");
  if (aggregation.functionName === "first") return values[0] ?? "";
  if (aggregation.functionName === "last")
    return values[values.length - 1] ?? "";
  if (aggregation.functionName === "cardinality")
    return String(new Set(values).size);
  if (aggregation.functionName === "values") return values.join("|");
  if (aggregation.functionName === "distinct_values")
    return [...new Set(values)].join("|");
  if (aggregation.functionName === "mode") {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  const numbers = values.map(Number);
  if (!numbers.every(Number.isFinite))
    throw new Error(`${aggregation.functionName} requires numeric values`);
  if (numbers.length === 0) return "";
  if (aggregation.functionName === "sum")
    return String(numbers.reduce((sum, value) => sum + value, 0));
  if (
    aggregation.functionName === "mean" ||
    aggregation.functionName === "avg"
  ) {
    return String(
      numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
    );
  }
  if (aggregation.functionName === "min") {
    return String(
      numbers.reduce(
        (minimum, value) => Math.min(minimum, value),
        Number.POSITIVE_INFINITY,
      ),
    );
  }
  if (aggregation.functionName === "max") {
    return String(
      numbers.reduce(
        (maximum, value) => Math.max(maximum, value),
        Number.NEGATIVE_INFINITY,
      ),
    );
  }
  if (aggregation.functionName === "median") {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return String(
      sorted.length % 2
        ? sorted[middle]
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    );
  }
  throw new Error(`unsupported aggregation '${aggregation.functionName}'`);
}

function projectColumns(table: CsvTable, indexes: readonly number[]): CsvTable {
  return {
    headers: indexes.map((index) => table.headers[index] ?? ""),
    rows: table.rows.map((row) => indexes.map((index) => row[index] ?? "")),
  };
}

function assertDerivedShape(
  rows: number,
  columns: number,
  limits: ProjectShellExtraLimits,
  label: string,
): void {
  if (!Number.isSafeInteger(rows) || rows < 0 || rows > limits.maxCsvRows)
    throw new Error(`${label} derived CSV row limit exceeded`);
  const cells = columns * (rows + 1);
  if (
    !Number.isSafeInteger(columns) ||
    columns < 0 ||
    !Number.isSafeInteger(cells) ||
    cells > limits.maxCsvCells
  ) {
    throw new Error(`${label} derived CSV cell limit exceeded`);
  }
}

function assertAggregationWork(aggregationCount: number, rows: number): void {
  if (aggregationCount * Math.max(1, rows) > 2_000_000)
    throw new Error("aggregation work limit exceeded (2000000)");
}

function takeBoolean(args: string[], ...names: string[]): boolean {
  const index = args.findIndex((argument) => names.includes(argument));
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeStringOption(
  args: string[],
  names: readonly string[],
): string | null {
  const index = args.findIndex((argument) => names.includes(argument));
  if (index < 0) return null;
  const value = args[index + 1];
  if (value === undefined)
    throw new Error(`option '${args[index]}' requires a value`);
  args.splice(index, 2);
  return value;
}

function takeIntegerOption(
  args: string[],
  names: readonly string[],
  fallback: number,
  maximum: number,
): number {
  const value = takeStringOption(args, names);
  if (value === null) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw new Error(
      `option '${names[0] ?? ""}' requires an integer between 0 and ${maximum}`,
    );
  }
  return Number(value);
}

function singleFile(args: readonly string[]): string | undefined {
  if (args.length > 1)
    throw new Error(`unexpected argument '${args[1] ?? ""}'`);
  return args[0];
}

function tupleKey(values: readonly string[]): string {
  return values.map((value) => `${value.length}:${value}`).join("|");
}

function compareNumberStrings(left: string, right: string): number {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) && !Number.isFinite(b))
    return left < right ? -1 : left > right ? 1 : 0;
  if (!Number.isFinite(a)) return 1;
  if (!Number.isFinite(b)) return -1;
  return a - b;
}

type FilterOperator = "eq" | "ne" | "==" | "!=" | ">" | ">=" | "<" | "<=";

function parseFilterExpression(expression: string): {
  column: string;
  operator: FilterOperator;
  value: string | number | boolean | null;
} {
  if (expression.length > 4_096)
    throw new Error("filter expression is too large");
  const match =
    /^([A-Za-z_][A-Za-z0-9_]*)\s*(eq|ne|==|!=|>=|<=|>|<)\s*(.+)$/.exec(
      expression.trim(),
    );
  if (!match) throw new Error("supported filter form: COLUMN OP VALUE");
  const rawValue = (match[3] ?? "").trim();
  let value: string | number | boolean | null;
  if (rawValue.startsWith('"')) {
    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed !== "string")
        throw new Error("quoted filter value must be a string");
      value = parsed;
    } catch {
      throw new Error("invalid quoted filter value");
    }
  } else if (rawValue === "true") value = true;
  else if (rawValue === "false") value = false;
  else if (rawValue === "null") value = null;
  else if (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawValue) &&
    Number.isFinite(Number(rawValue))
  ) {
    value = Number(rawValue);
  } else value = rawValue;
  return {
    column: match[1] ?? "",
    operator: match[2] as FilterOperator,
    value,
  };
}

function compareFilter(
  cell: string,
  operator: FilterOperator,
  expected: string | number | boolean | null,
): boolean {
  if (operator === "eq" || operator === "==")
    return cell === stringifyCell(expected);
  if (operator === "ne" || operator === "!=")
    return cell !== stringifyCell(expected);
  const left = Number(cell);
  const right = typeof expected === "number" ? expected : Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === ">") return left > right;
  if (operator === ">=") return left >= right;
  if (operator === "<") return left < right;
  return left <= right;
}

function shuffleIndexes(indexes: number[], initialSeed: number): void {
  let seed = initialSeed || 1;
  const random = (): number => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  for (let index = indexes.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap] ?? 0, indexes[index] ?? 0];
  }
}

function safeRegexMatch(
  input: string,
  source: string,
  ignoreCase: boolean,
): boolean {
  if (source.length > 1_024)
    throw new Error("search pattern limit exceeded (1024)");
  let pattern = source;
  let value = input;
  if (ignoreCase) {
    pattern = pattern.toLowerCase();
    value = value.toLowerCase();
  }
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$") && !pattern.endsWith("\\$");
  if (anchoredStart) pattern = pattern.slice(1);
  if (anchoredEnd) pattern = pattern.slice(0, -1);
  const tokens: (string | null)[] = [];
  if (!anchoredStart) tokens.push(null);
  for (let index = 0; index < pattern.length; index++) {
    const token = pattern[index] ?? "";
    if (token === "\\") {
      const literal = pattern[++index];
      if (literal === undefined)
        throw new Error("invalid trailing regex escape");
      tokens.push(literal);
    } else if (token === "." && pattern[index + 1] === "*") {
      tokens.push(null);
      index++;
    } else if (token === ".") tokens.push("");
    else if ("[](){}+?|".includes(token)) {
      throw new Error(
        `regex token '${token}' is unavailable; supported: literals, ., .*, ^, $`,
      );
    } else tokens.push(token);
  }
  if (!anchoredEnd) tokens.push(null);
  return matchSafeTokens(value, tokens);
}

function matchSafeTokens(
  value: string,
  tokens: readonly (string | null)[],
): boolean {
  let states = new Uint8Array(value.length + 1);
  states[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(value.length + 1);
    if (token === null) {
      let active = false;
      for (let index = 0; index <= value.length; index++) {
        active ||= states[index] === 1;
        if (active) next[index] = 1;
      }
    } else {
      for (let index = 0; index < value.length; index++) {
        if (states[index] && (token === "" || token === value[index]))
          next[index + 1] = 1;
      }
    }
    states = next;
  }
  return states[value.length] === 1;
}

function truncateCell(value: string, width: number): string {
  if (value.length <= width) return value;
  return width <= 1 ? value.slice(0, width) : `${value.slice(0, width - 1)}…`;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
    if (depth < 0 || depth > 16) throw new Error("invalid aggregation nesting");
  }
  if (depth !== 0) throw new Error("invalid aggregation parentheses");
  parts.push(value.slice(start));
  return parts;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
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

export function supportedXanSubcommands(): readonly string[] {
  return [...SUPPORTED].sort();
}
