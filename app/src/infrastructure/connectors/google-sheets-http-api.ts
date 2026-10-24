import { ConnectorError } from "@boltpocket/connector-core";
import {
  canonicalizeGoogleSheetCsv,
  googleSpreadsheetResourceKey,
  parseGoogleSheetCsv,
  parseGoogleSpreadsheetLink,
  parseGoogleSpreadsheetResourceKey,
  stringifyGoogleSheetCsv,
  type GoogleSheetsApiPort,
  type GoogleSheetsSpreadsheetSnapshot,
} from "@boltpocket/connector-google-sheets";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,200}$/u;

type JsonRecord = Record<string, unknown>;
type Fetch = typeof fetch;

function record(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown) {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function textVersion(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function safeTitle(value: unknown, fallback: string) {
  const title = string(value).trim() || fallback;
  if (title.length > 1_000 || /[\u0000-\u001f\u007f]/u.test(title)) {
    throw invalidResponse();
  }
  return title;
}

function connectorHttpError(status: number, operation: "read" | "write") {
  if (status === 401) {
    return new ConnectorError("not_connected", "Google 授权已过期。", {
      retryable: true,
    });
  }
  if (status === 403) {
    return new ConnectorError(
      "permission_denied",
      "Google 账号无法访问这份表格，或尚未重新授权表格权限。",
    );
  }
  if (status === 404) {
    return new ConnectorError("not_found", "Google 表格不存在。");
  }
  if (operation === "write" && (status === 400 || status === 409)) {
    return new ConnectorError("conflict", "Google 表格在写入前发生变化。", {
      retryable: true,
    });
  }
  return new ConnectorError(
    "io_failure",
    `Google Sheets 请求失败（HTTP ${status}）。`,
    { retryable: status >= 500 || status === 429 },
  );
}

function invalidResponse(): ConnectorError {
  return new ConnectorError("io_failure", "Google Sheets 响应无效。");
}

function sheetRange(title: string) {
  return `'${title.replaceAll("'", "''")}'`;
}

function userEnteredValue(value: string) {
  if (value === "") return {};
  if (value.startsWith("=")) return { formulaValue: value };
  if (/^(?:true|false)$/iu.test(value)) {
    return { boolValue: value.toLocaleLowerCase() === "true" };
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value)) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return { numberValue };
  }
  return { stringValue: value };
}

function rowData(text: string) {
  return parseGoogleSheetCsv(text).map((row) => ({
    values: row.map((value) => ({
      userEnteredValue: userEnteredValue(value),
    })),
  }));
}

function updateCellsRequest(sheetId: number, before: string, after: string) {
  const beforeRows = parseGoogleSheetCsv(before);
  const afterRows = parseGoogleSheetCsv(after);
  const beforeColumns = beforeRows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  const afterColumns = afterRows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: Math.max(1, beforeRows.length, afterRows.length),
        startColumnIndex: 0,
        endColumnIndex: Math.max(1, beforeColumns, afterColumns),
      },
      rows: rowData(after),
      fields: "userEnteredValue",
    },
  };
}

export class GoogleSheetsHttpApi implements GoogleSheetsApiPort {
  readonly #authorization: GoogleDocsAuthorizationPort;
  readonly #fetch: Fetch;

  constructor(
    authorization: GoogleDocsAuthorizationPort,
    fetchImplementation: Fetch = fetch,
  ) {
    this.#authorization = authorization;
    this.#fetch = fetchImplementation;
  }

  async resolveResource(accountId: string, value: string) {
    const link = parseGoogleSpreadsheetLink(value);
    const sheets = await this.#sheetMetadata(accountId, link.spreadsheetId);
    const selected =
      link.sheetId === undefined
        ? sheets[0]
        : sheets.find((sheet) => sheet.sheetId === link.sheetId);
    if (!selected) {
      throw new ConnectorError(
        "not_found",
        "Google 表格链接指向的工作表不存在。",
      );
    }
    return this.readResource(
      accountId,
      googleSpreadsheetResourceKey(link.spreadsheetId, selected.sheetId),
    );
  }

  async readResource(accountId: string, resourceId: string) {
    const { spreadsheetId, sheetId } =
      parseGoogleSpreadsheetResourceKey(resourceId);
    const [sheets, drive] = await Promise.all([
      this.#sheetMetadata(accountId, spreadsheetId),
      this.#driveMetadata(accountId, spreadsheetId),
    ]);
    const selected = sheets.find((sheet) => sheet.sheetId === sheetId);
    if (!selected) {
      throw new ConnectorError("not_found", "Google 工作表不存在。");
    }
    const range = encodeURIComponent(sheetRange(selected.title));
    const body = await this.#request(
      accountId,
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMULA&dateTimeRenderOption=SERIAL_NUMBER`,
      "read",
      { method: "GET" },
    );
    const values = this.#parseJson(body);
    if (
      !record(values) ||
      (values.values !== undefined && !Array.isArray(values.values))
    ) {
      throw invalidResponse();
    }
    const rows = (values.values ?? []) as unknown[];
    if (
      !rows.every(
        (row) =>
          Array.isArray(row) &&
          row.every(
            (cell) =>
              cell === null ||
              typeof cell === "string" ||
              typeof cell === "number" ||
              typeof cell === "boolean",
          ),
      )
    ) {
      throw invalidResponse();
    }
    const text = stringifyGoogleSheetCsv(
      rows as (string | number | boolean | null)[][],
    );
    const version = `${drive.version}:${drive.modifiedTime}:${textVersion(text)}`;
    return {
      resourceId,
      spreadsheetId,
      sheetId,
      sheetTitle: selected.title,
      title: `${drive.name} · ${selected.title}`,
      text,
      version,
      writable: drive.canEdit && !drive.trashed,
      trashable: !drive.trashed,
      restorable: drive.trashed,
      trashed: drive.trashed,
      metadata: { spreadsheetId, sheetId, sheetTitle: selected.title },
    } satisfies GoogleSheetsSpreadsheetSnapshot;
  }

  async replaceResource(input: {
    accountId: string;
    resourceId: string;
    expectedVersion: string;
    text: string;
  }) {
    if (canonicalizeGoogleSheetCsv(input.text) !== input.text) {
      throw new ConnectorError(
        "unsupported",
        "Google 表格修改必须保持规范 CSV 格式。",
      );
    }
    const current = await this.readResource(input.accountId, input.resourceId);
    if (!current.writable || current.version !== input.expectedVersion) {
      throw new ConnectorError("conflict", "Google 表格在写入前发生变化。", {
        retryable: true,
      });
    }
    await this.#request(
      input.accountId,
      `${SHEETS_API}/${encodeURIComponent(current.spreadsheetId)}:batchUpdate`,
      "write",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            updateCellsRequest(current.sheetId, current.text, input.text),
          ],
          includeSpreadsheetInResponse: false,
        }),
      },
    );
    const written = await this.readResource(input.accountId, input.resourceId);
    if (written.text !== input.text) {
      throw new ConnectorError("io_failure", "Google 表格写入结果无法校验。");
    }
    return written;
  }

  async createResource(input: {
    accountId: string;
    title: string;
    text: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }) {
    const title = safeTitle(input.title, "未命名表格");
    if (canonicalizeGoogleSheetCsv(input.text) !== input.text) {
      throw new ConnectorError(
        "unsupported",
        "Google 表格新建内容必须是规范 CSV。",
      );
    }
    const body = await this.#request(input.accountId, SHEETS_API, "write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { title },
        ...(input.text
          ? {
              sheets: [
                {
                  data: [
                    {
                      startRow: 0,
                      startColumn: 0,
                      rowData: rowData(input.text),
                    },
                  ],
                },
              ],
            }
          : {}),
      }),
    });
    const created = this.#parseJson(body);
    const spreadsheetId = record(created) ? string(created.spreadsheetId) : "";
    const firstSheet = record(created)
      ? records(created.sheets)
          .map((sheet) => (record(sheet.properties) ? sheet.properties : null))
          .find(record)
      : undefined;
    const sheetId = integer(firstSheet?.sheetId);
    if (!SPREADSHEET_ID.test(spreadsheetId) || sheetId === null) {
      throw new ConnectorError(
        "io_failure",
        "Google 表格已请求创建，但响应无效；不会自动重试。",
      );
    }
    const resourceId = googleSpreadsheetResourceKey(spreadsheetId, sheetId);
    const written = await this.readResource(input.accountId, resourceId);
    if (written.text !== input.text) {
      throw new ConnectorError(
        "io_failure",
        "Google 表格已创建，但初始内容无法校验；不会自动重试创建。",
      );
    }
    return {
      ...written,
      trashable: true,
      restorable: false,
      trashed: false,
    };
  }

  async setResourceTrashed(input: {
    accountId: string;
    resourceId: string;
    trashed: boolean;
  }) {
    const { spreadsheetId } = parseGoogleSpreadsheetResourceKey(
      input.resourceId,
    );
    const before = input.trashed
      ? await this.readResource(input.accountId, input.resourceId)
      : null;
    const body = await this.#request(
      input.accountId,
      `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=id%2Ctrashed`,
      "write",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: input.trashed }),
      },
    );
    const response = this.#parseJson(body);
    if (
      !record(response) ||
      response.id !== spreadsheetId ||
      response.trashed !== input.trashed
    ) {
      throw invalidResponse();
    }
    if (input.trashed) {
      return {
        ...before!,
        writable: false,
        trashable: false,
        restorable: true,
        trashed: true,
      };
    }
    return this.readResource(input.accountId, input.resourceId);
  }

  async #sheetMetadata(accountId: string, spreadsheetId: string) {
    const fields = encodeURIComponent(
      "spreadsheetId,properties(title),sheets(properties(sheetId,title))",
    );
    const body = await this.#request(
      accountId,
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`,
      "read",
      { method: "GET" },
    );
    const value = this.#parseJson(body);
    if (!record(value) || value.spreadsheetId !== spreadsheetId) {
      throw invalidResponse();
    }
    const sheets = records(value.sheets).map((sheet) => {
      const properties = record(sheet.properties) ? sheet.properties : {};
      const sheetId = integer(properties.sheetId);
      if (sheetId === null) throw invalidResponse();
      return {
        sheetId,
        title: safeTitle(properties.title, "工作表"),
      };
    });
    if (sheets.length === 0 || sheets.length > 1_000) throw invalidResponse();
    return sheets;
  }

  async #driveMetadata(accountId: string, spreadsheetId: string) {
    const fields = encodeURIComponent(
      "id,name,mimeType,modifiedTime,version,trashed,capabilities(canEdit)",
    );
    const body = await this.#request(
      accountId,
      `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`,
      "read",
      { method: "GET" },
    );
    const value = this.#parseJson(body);
    const capabilities =
      record(value) && record(value.capabilities) ? value.capabilities : {};
    if (
      !record(value) ||
      value.id !== spreadsheetId ||
      value.mimeType !== SPREADSHEET_MIME ||
      typeof value.trashed !== "boolean" ||
      typeof capabilities.canEdit !== "boolean"
    ) {
      throw invalidResponse();
    }
    const version =
      typeof value.version === "string" || typeof value.version === "number"
        ? String(value.version)
        : "";
    const modifiedTime = string(value.modifiedTime);
    if (!version || !modifiedTime) throw invalidResponse();
    return {
      name: safeTitle(value.name, "未命名表格"),
      version,
      modifiedTime,
      trashed: value.trashed,
      canEdit: capabilities.canEdit,
    };
  }

  #parseJson(body: string): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw invalidResponse();
    }
  }

  async #request(
    accountId: string,
    url: string,
    operation: "read" | "write",
    init: RequestInit,
    retry = true,
  ): Promise<string> {
    const accessToken = await this.#authorization.accessTokenFor(accountId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        credentials: "omit",
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ConnectorError("io_failure", "Google Sheets 请求超时。", {
          retryable: true,
        });
      }
      throw new ConnectorError("io_failure", "Google Sheets 网络请求失败。", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 && retry) {
      await this.#authorization.clearAccessToken(accessToken);
      return this.#request(accountId, url, operation, init, false);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      throw new ConnectorError(
        "unsupported",
        "Google Sheets 响应超过安全大小限制。",
      );
    }
    const body = await response.text();
    if (byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new ConnectorError(
        "unsupported",
        "Google Sheets 响应超过安全大小限制。",
      );
    }
    if (!response.ok) throw connectorHttpError(response.status, operation);
    return body;
  }
}
