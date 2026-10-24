import { ConnectorError } from "@boltpocket/connector-core";

export const MAX_GOOGLE_SHEET_CHARACTERS = 300_000;
export const MAX_GOOGLE_SHEET_ROWS = 10_000;
export const MAX_GOOGLE_SHEET_COLUMNS = 1_000;
export const MAX_GOOGLE_SHEET_CELLS = 100_000;

function invalidCsv(message = "Google 表格 CSV 格式无效。"): never {
  throw new ConnectorError("unsupported", message);
}

export function parseGoogleSheetCsv(value: string): string[][] {
  if (value.length > MAX_GOOGLE_SHEET_CHARACTERS || value.includes("\0")) {
    invalidCsv("Google 表格内容超过安全限制。");
  }
  if (value === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  const pushField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
    if (row.length > MAX_GOOGLE_SHEET_COLUMNS) {
      invalidCsv("Google 表格列数超过安全限制。");
    }
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (
      rows.length > MAX_GOOGLE_SHEET_ROWS ||
      rows.reduce((total, candidate) => total + candidate.length, 0) >
        MAX_GOOGLE_SHEET_CELLS
    ) {
      invalidCsv("Google 表格单元格数量超过安全限制。");
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (
      afterQuote &&
      character !== "," &&
      character !== "\n" &&
      character !== "\r"
    ) {
      invalidCsv();
    }
    if (character === '"') {
      if (field || afterQuote) invalidCsv();
      quoted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
    }
  }
  if (quoted) invalidCsv("Google 表格 CSV 引号没有闭合。");
  if (!value.endsWith("\n") && !value.endsWith("\r")) pushRow();
  return trimGoogleSheetGrid(rows);
}

export function trimGoogleSheetGrid(rows: readonly (readonly string[])[]) {
  const output = rows.map((row) => [...row]);
  for (const row of output) {
    while (row.at(-1) === "") row.pop();
  }
  while (output.length > 0 && output.at(-1)!.length === 0) output.pop();
  return output;
}

function encodeCell(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function stringifyGoogleSheetCsv(
  rows: readonly (readonly (string | number | boolean | null)[])[],
) {
  const strings = trimGoogleSheetGrid(
    rows.map((row) =>
      row.map((value) => (value === null ? "" : String(value))),
    ),
  );
  return strings.map((row) => row.map(encodeCell).join(",")).join("\n");
}

export function canonicalizeGoogleSheetCsv(value: string) {
  return stringifyGoogleSheetCsv(parseGoogleSheetCsv(value));
}
