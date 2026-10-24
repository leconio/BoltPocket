/* SPDX-License-Identifier: Apache-2.0 */

import Papa from "papaparse";

import { byteLength, stdinText } from "./bytes.ts";
import { assertByteLimit, assertNotAborted } from "./limits.ts";
import type { ExtraCommandContext, ProjectShellExtraLimits } from "./types.ts";

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export async function readCsv(
  file: string | undefined,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<CsvTable> {
  assertNotAborted(context.signal);
  const input = await readTextInput(file, context, limits);
  return parseCsv(input, limits);
}

export async function readTextInput(
  file: string | undefined,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<string> {
  if (!file || file === "-")
    return stdinText(context.stdin, limits.maxInputBytes);
  let input: string;
  try {
    input = await context.fs.readFile(
      context.fs.resolvePath(context.cwd, file),
    );
  } catch {
    throw new Error(`${file}: No such file or directory`);
  }
  assertByteLimit("xan input", byteLength(input), limits.maxInputBytes);
  return input;
}

export function parseCsvRows(
  input: string,
  limits: ProjectShellExtraLimits,
): string[][] {
  assertByteLimit("xan input", byteLength(input), limits.maxInputBytes);
  if (!input.trim()) return [];
  const parsed = Papa.parse<string[]>(input, {
    delimiter: "",
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  const fatal = parsed.errors.find(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (fatal) throw new Error(fatal.message || "invalid CSV");
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  if (rows.length > limits.maxCsvRows + 1)
    throw new Error(`CSV row limit exceeded (${limits.maxCsvRows})`);
  const cells = rows.reduce((sum, row) => sum + row.length, 0);
  if (cells > limits.maxCsvCells)
    throw new Error(`CSV cell limit exceeded (${limits.maxCsvCells})`);
  for (const cell of rows.flat())
    assertByteLimit("CSV cell", byteLength(cell), limits.maxCellBytes);
  return rows;
}

export function parseCsv(
  input: string,
  limits: ProjectShellExtraLimits,
): CsvTable {
  assertByteLimit("xan input", byteLength(input), limits.maxInputBytes);
  if (!input.trim()) return { headers: [], rows: [] };
  const records = parseCsvRows(input, limits);
  const headers = records.shift() ?? [];
  if (new Set(headers).size !== headers.length)
    throw new Error("duplicate CSV headers");
  if (headers.length > limits.maxCsvCells)
    throw new Error("CSV column limit exceeded");
  if (records.length > limits.maxCsvRows) {
    throw new Error(`CSV row limit exceeded (${limits.maxCsvRows})`);
  }
  const cells =
    headers.length + records.reduce((sum, row) => sum + row.length, 0);
  if (cells > limits.maxCsvCells)
    throw new Error(`CSV cell limit exceeded (${limits.maxCsvCells})`);
  for (const cell of [...headers, ...records.flat()]) {
    assertByteLimit("CSV cell", byteLength(cell), limits.maxCellBytes);
  }
  const rows = records.map((row) => {
    if (row.length > headers.length)
      throw new Error("CSV row has more fields than the header");
    return [
      ...row,
      ...Array.from({ length: headers.length - row.length }, () => ""),
    ];
  });
  return { headers, rows };
}

export function formatCsv(
  table: CsvTable,
  limits: ProjectShellExtraLimits,
  includeHeaders = true,
): string {
  assertTableBounds(table, limits);
  const rows = includeHeaders ? [table.headers, ...table.rows] : table.rows;
  let conservative = rows.length;
  for (const row of rows) {
    conservative += Math.max(0, row.length - 1);
    for (const cell of row) conservative += byteLength(cell) * 2 + 2;
  }
  assertByteLimit("xan output", conservative, limits.maxOutputBytes);
  if (rows.length === 0) return "";
  const output = Papa.unparse(rows, { delimiter: ",", newline: "\n" });
  const result = `${output}\n`;
  assertByteLimit("xan output", byteLength(result), limits.maxOutputBytes);
  return result;
}

export function assertTableBounds(
  table: CsvTable,
  limits: ProjectShellExtraLimits,
): void {
  if (table.rows.length > limits.maxCsvRows)
    throw new Error("derived CSV row limit exceeded");
  const cells =
    table.headers.length + table.rows.reduce((sum, row) => sum + row.length, 0);
  if (cells > limits.maxCsvCells)
    throw new Error("derived CSV cell limit exceeded");
  for (const cell of [...table.headers, ...table.rows.flat()]) {
    assertByteLimit("derived CSV cell", byteLength(cell), limits.maxCellBytes);
  }
}

export function resolveColumns(
  headers: readonly string[],
  specification: string,
): number[] {
  if (specification.length > 4_096)
    throw new Error("column selector limit exceeded (4096)");
  const selected: number[] = [];
  const excluded = new Set<number>();
  const budget = { remaining: 5_000_000 };
  for (const rawPart of specification.split(",")) {
    const negated = rawPart.startsWith("!");
    const part = negated ? rawPart.slice(1) : rawPart;
    const matches = resolvePart(headers, part, budget);
    if (matches.length === 0)
      throw new Error(`unknown column selector '${rawPart}'`);
    if (negated) for (const index of matches) excluded.add(index);
    else for (const index of matches) selected.push(index);
  }
  const base =
    selected.length === 0 && excluded.size > 0
      ? headers.map((_, index) => index)
      : selected;
  return base.filter((index) => !excluded.has(index));
}

function resolvePart(
  headers: readonly string[],
  part: string,
  budget: { remaining: number },
): number[] {
  if (part === "*") {
    chargeColumnWork(budget, headers.length);
    return headers.map((_, index) => index);
  }
  if (/^\d+$/.test(part)) {
    const index = Number(part);
    return index < headers.length ? [index] : [];
  }
  const numericRange = /^(\d+)-(\d+)$/.exec(part);
  if (numericRange) {
    const start = Number(numericRange[1]);
    const end = Number(numericRange[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      Math.abs(end - start) + 1 > Math.max(headers.length, 1)
    ) {
      throw new Error("numeric column range limit exceeded");
    }
    const result = inclusiveRange(start, end).filter(
      (index) => index >= 0 && index < headers.length,
    );
    chargeColumnWork(budget, result.length);
    return result;
  }
  if (part.includes(":")) {
    const [startName = "", endName = ""] = part.split(":", 2);
    chargeColumnWork(budget, headers.length * 2);
    const start = startName ? headers.indexOf(startName) : 0;
    const end = endName ? headers.indexOf(endName) : headers.length - 1;
    if (start < 0 || end < 0) return [];
    return inclusiveRange(start, end);
  }
  if (part.includes("*") || part.includes("?")) {
    return headers.flatMap((header, index) => {
      chargeColumnWork(budget, (header.length + 1) * Math.max(1, part.length));
      return wildcardMatch(header, part) ? [index] : [];
    });
  }
  chargeColumnWork(budget, headers.length);
  const index = headers.indexOf(part);
  return index < 0 ? [] : [index];
}

function chargeColumnWork(budget: { remaining: number }, work: number): void {
  budget.remaining -= work;
  if (budget.remaining < 0)
    throw new Error("column selector work limit exceeded");
}

function inclusiveRange(start: number, end: number): number[] {
  const step = start <= end ? 1 : -1;
  const result: number[] = [];
  for (let value = start; ; value += step) {
    result.push(value);
    if (value === end) break;
  }
  return result;
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (pattern.length > 1_024 || value.length > 4_096) return false;
  let previous = new Uint8Array(value.length + 1);
  previous[0] = 1;
  for (const token of pattern) {
    const current = new Uint8Array(value.length + 1);
    if (token === "*") current[0] = previous[0] ?? 0;
    for (let index = 1; index <= value.length; index++) {
      if (token === "*")
        current[index] = previous[index] || current[index - 1] ? 1 : 0;
      else if (token === "?" || token === value[index - 1])
        current[index] = previous[index - 1] ?? 0;
    }
    previous = current;
  }
  return previous[value.length] === 1;
}

export function rowObject(
  headers: readonly string[],
  row: readonly string[],
): Record<string, string> {
  const object = Object.create(null) as Record<string, string>;
  headers.forEach((header, index) => {
    Object.defineProperty(object, header, {
      value: row[index] ?? "",
      enumerable: true,
      configurable: true,
      writable: true,
    });
  });
  return object;
}

export function jsonScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}
