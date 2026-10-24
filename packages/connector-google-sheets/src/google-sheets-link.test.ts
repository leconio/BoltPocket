import assert from "node:assert/strict";
import test from "node:test";

import {
  googleSpreadsheetResourceKey,
  googleSpreadsheetResourceUrl,
  googleSpreadsheetUrl,
  parseGoogleSpreadsheetLink,
} from "./google-sheets-link.ts";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("parses a Google Sheets link and tab id", () => {
  assert.deepEqual(
    parseGoogleSpreadsheetLink(
      `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`,
    ),
    { spreadsheetId: ID, sheetId: 123 },
  );
  assert.equal(
    googleSpreadsheetUrl(ID, 123),
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`,
  );
  assert.equal(
    googleSpreadsheetResourceUrl(googleSpreadsheetResourceKey(ID, 123)),
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`,
  );
});

test("rejects lookalike Google Sheets hosts", () => {
  assert.throws(() =>
    parseGoogleSpreadsheetLink(
      `https://docs.google.com.example/spreadsheets/d/${ID}/edit`,
    ),
  );
});
