import { ConnectorError } from "@boltpocket/connector-core";

const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,200}$/u;
const SHEET_ID = /^\d{1,10}$/u;
const RESOURCE_KEY = /^([A-Za-z0-9_-]{20,200}):(\d{1,10})$/u;

export type GoogleSpreadsheetLink = {
  spreadsheetId: string;
  sheetId?: number;
};

export function parseGoogleSpreadsheetLink(
  input: string,
): GoogleSpreadsheetLink {
  const trimmed = input.trim();
  if (SPREADSHEET_ID.test(trimmed)) return { spreadsheetId: trimmed };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConnectorError("unsupported", "请输入有效的 Google 表格链接。");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new ConnectorError(
      "unsupported",
      "只支持 docs.google.com 的表格链接。",
    );
  }
  const match =
    /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/u.exec(
      url.pathname,
    );
  if (!match?.[1]) {
    throw new ConnectorError(
      "unsupported",
      "链接中没有有效的 Google 表格 ID。",
    );
  }
  const rawSheetId =
    url.searchParams.get("gid") ??
    new URLSearchParams(url.hash.replace(/^#/u, "")).get("gid");
  if (rawSheetId !== null && !SHEET_ID.test(rawSheetId)) {
    throw new ConnectorError("unsupported", "Google 表格工作表 ID 无效。");
  }
  const sheetId = rawSheetId === null ? undefined : Number(rawSheetId);
  if (sheetId !== undefined && !Number.isSafeInteger(sheetId)) {
    throw new ConnectorError("unsupported", "Google 表格工作表 ID 无效。");
  }
  return {
    spreadsheetId: match[1],
    ...(sheetId === undefined ? {} : { sheetId }),
  };
}

export function googleSpreadsheetUrl(spreadsheetId: string, sheetId?: number) {
  if (
    !SPREADSHEET_ID.test(spreadsheetId) ||
    (sheetId !== undefined &&
      (!Number.isSafeInteger(sheetId) ||
        sheetId < 0 ||
        sheetId > 9_999_999_999))
  ) {
    throw new ConnectorError(
      "unsupported",
      "Google spreadsheet ID is invalid.",
    );
  }
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return sheetId === undefined ? base : `${base}#gid=${sheetId}`;
}

export function googleSpreadsheetResourceKey(
  spreadsheetId: string,
  sheetId: number,
) {
  googleSpreadsheetUrl(spreadsheetId, sheetId);
  return `${spreadsheetId}:${sheetId}`;
}

export function parseGoogleSpreadsheetResourceKey(value: string) {
  const match = RESOURCE_KEY.exec(value);
  const sheetId = match?.[2] === undefined ? Number.NaN : Number(match[2]);
  if (!match?.[1] || !Number.isSafeInteger(sheetId)) {
    throw new ConnectorError(
      "unsupported",
      "Google spreadsheet resource key is invalid.",
    );
  }
  return { spreadsheetId: match[1], sheetId };
}

export function googleSpreadsheetResourceUrl(resourceKey: string) {
  const { spreadsheetId, sheetId } =
    parseGoogleSpreadsheetResourceKey(resourceKey);
  return googleSpreadsheetUrl(spreadsheetId, sheetId);
}
