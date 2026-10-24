import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeGoogleSheetCsv,
  parseGoogleSheetCsv,
  stringifyGoogleSheetCsv,
} from "./google-sheets-csv.ts";

test("empty sheets canonicalize without adding phantom rows", () => {
  assert.deepEqual(parseGoogleSheetCsv(""), []);
  assert.equal(canonicalizeGoogleSheetCsv(""), "");
  assert.equal(stringifyGoogleSheetCsv([]), "");
});

test("round-trips quoted Google Sheets CSV", () => {
  const rows = [
    ["name", "note"],
    ["Ada", "line 1\nline 2"],
    ["quote", 'a "b"'],
  ];
  const csv = stringifyGoogleSheetCsv(rows);
  assert.deepEqual(parseGoogleSheetCsv(csv), rows);
  assert.equal(canonicalizeGoogleSheetCsv(`${csv}\n`), csv);
});

test("trims trailing empty cells without losing interior blanks", () => {
  assert.equal(canonicalizeGoogleSheetCsv("a,,c,\n,,\n"), "a,,c");
});
