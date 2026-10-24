import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";
import {
  googleSpreadsheetResourceKey,
  googleSpreadsheetUrl,
} from "@boltpocket/connector-google-sheets";

import { GoogleSheetsHttpApi } from "./google-sheets-http-api.ts";

const SPREADSHEET_ID = "spreadsheet_12345678901234567890";
const SHEET_ID = 42;

class FakeAuthorization implements GoogleDocsAuthorizationPort {
  readonly cleared: string[] = [];

  async connect() {
    return null;
  }

  async restore() {
    return null;
  }

  async accessTokenFor() {
    return "sheets-test-token";
  }

  async clearAccessToken(token: string) {
    this.cleared.push(token);
  }
}

function sheetMetadata(spreadsheetId = SPREADSHEET_ID) {
  return {
    spreadsheetId,
    properties: { title: "验收表格" },
    sheets: [{ properties: { sheetId: SHEET_ID, title: "数据" } }],
  };
}

function driveMetadata(input?: {
  version?: number;
  modifiedTime?: string;
  trashed?: boolean;
}) {
  return {
    id: SPREADSHEET_ID,
    name: "验收表格",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: input?.modifiedTime ?? "2026-08-07T00:00:00.000Z",
    version: String(input?.version ?? 7),
    trashed: input?.trashed ?? false,
    capabilities: { canEdit: true },
  };
}

test("Google Sheets reads one explicit tab and atomically updates only cell values", async () => {
  let rows: unknown[][] = [
    ["Name", "Value"],
    ["alpha", 1],
  ];
  let version = 7;
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleSheetsHttpApi(new FakeAuthorization(), (async (
    input,
    init,
  ) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith(":batchUpdate")) {
      rows = [
        ["Name", "Value"],
        ["alpha", 2],
      ];
      version += 1;
      return new Response("{}");
    }
    if (url.includes("/values/")) {
      return new Response(JSON.stringify({ values: rows }));
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(JSON.stringify(driveMetadata({ version })));
    }
    return new Response(JSON.stringify(sheetMetadata()));
  }) as typeof fetch);

  const before = await api.resolveResource(
    "account-1",
    googleSpreadsheetUrl(SPREADSHEET_ID, SHEET_ID),
  );
  assert.equal(
    before.resourceId,
    googleSpreadsheetResourceKey(SPREADSHEET_ID, SHEET_ID),
  );
  assert.equal(before.text, "Name,Value\nalpha,1");
  assert.equal(before.title, "验收表格 · 数据");

  const written = await api.replaceResource({
    accountId: "account-1",
    resourceId: before.resourceId,
    expectedVersion: before.version,
    text: "Name,Value\nalpha,2",
  });

  assert.equal(written.text, "Name,Value\nalpha,2");
  const batch = requests.find((request) =>
    request.url.endsWith(":batchUpdate"),
  );
  assert.ok(batch);
  assert.equal(batch.init?.method, "POST");
  assert.equal(
    (batch.init?.headers as Record<string, string>).Authorization,
    "Bearer sheets-test-token",
  );
  assert.deepEqual(JSON.parse(String(batch.init?.body)), {
    requests: [
      {
        updateCells: {
          range: {
            sheetId: SHEET_ID,
            startRowIndex: 0,
            endRowIndex: 2,
            startColumnIndex: 0,
            endColumnIndex: 2,
          },
          rows: [
            {
              values: [
                { userEnteredValue: { stringValue: "Name" } },
                { userEnteredValue: { stringValue: "Value" } },
              ],
            },
            {
              values: [
                { userEnteredValue: { stringValue: "alpha" } },
                { userEnteredValue: { numberValue: 2 } },
              ],
            },
          ],
          fields: "userEnteredValue",
        },
      },
    ],
    includeSpreadsheetInResponse: false,
  });
  assert.equal(
    requests.some((request) => request.init?.method === "DELETE"),
    false,
  );
});

test("Google Sheets creates content and uses recoverable Drive trash and restore", async () => {
  let rows: unknown[][] = [];
  let version = 1;
  let trashed = false;
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleSheetsHttpApi(new FakeAuthorization(), (async (
    input,
    init,
  ) => {
    const url = String(input);
    requests.push({ url, init });
    if (
      url === "https://sheets.googleapis.com/v4/spreadsheets" &&
      init?.method === "POST"
    ) {
      rows = [
        ["Task", "Done"],
        ["QA", true],
      ];
      version += 1;
      return new Response(JSON.stringify(sheetMetadata()));
    }
    if (url.includes("/values/")) {
      return new Response(JSON.stringify({ values: rows }));
    }
    if (
      url.startsWith("https://www.googleapis.com/drive/v3/files/") &&
      init?.method === "PATCH"
    ) {
      trashed = Boolean(
        (JSON.parse(String(init.body)) as { trashed?: boolean }).trashed,
      );
      return new Response(JSON.stringify({ id: SPREADSHEET_ID, trashed }));
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(JSON.stringify(driveMetadata({ version, trashed })));
    }
    return new Response(JSON.stringify(sheetMetadata()));
  }) as typeof fetch);

  const created = await api.createResource({
    accountId: "account-1",
    title: "模型验收表格",
    text: "Task,Done\nQA,true",
    operationId: "operation-1",
    connectionId: "google-sheets-1",
    projectId: "project-1",
    resourceId: "google-sheet-created-1",
  });
  assert.equal(created.text, "Task,Done\nQA,true");
  assert.equal(created.trashable, true);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    properties: { title: "模型验收表格" },
    sheets: [
      {
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: [
                  { userEnteredValue: { stringValue: "Task" } },
                  { userEnteredValue: { stringValue: "Done" } },
                ],
              },
              {
                values: [
                  { userEnteredValue: { stringValue: "QA" } },
                  { userEnteredValue: { boolValue: true } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(
    requests.some((request) => request.url.endsWith(":batchUpdate")),
    false,
  );

  const inTrash = await api.setResourceTrashed({
    accountId: "account-1",
    resourceId: created.resourceId,
    trashed: true,
  });
  assert.equal(inTrash.trashed, true);
  assert.equal(inTrash.restorable, true);

  const restored = await api.setResourceTrashed({
    accountId: "account-1",
    resourceId: created.resourceId,
    trashed: false,
  });
  assert.equal(restored.trashed, false);
  assert.equal(restored.trashable, true);
  assert.equal(
    requests.some((request) => request.init?.method === "DELETE"),
    false,
  );
});
