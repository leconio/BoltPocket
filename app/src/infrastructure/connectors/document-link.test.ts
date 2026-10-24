import assert from "node:assert/strict";
import test from "node:test";

import { findSupportedDocumentLinks } from "./document-link.ts";

const GOOGLE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("recognizes Google Docs, Sheets, Slides and Notion links in paste order", () => {
  assert.deepEqual(
    findSupportedDocumentLinks(
      [
        `表格 https://docs.google.com/spreadsheets/d/${GOOGLE_ID}/edit#gid=42，`,
        `文档 https://docs.google.com/document/d/${GOOGLE_ID}/edit`,
        `幻灯片 https://docs.google.com/presentation/d/${GOOGLE_ID}/edit。`,
        "页面 https://www.notion.so/Workspace-0123456789abcdef0123456789abcdef",
      ].join("\n"),
    ),
    [
      {
        provider: "google-sheets",
        url: `https://docs.google.com/spreadsheets/d/${GOOGLE_ID}/edit#gid=42`,
      },
      {
        provider: "google-docs",
        url: `https://docs.google.com/document/d/${GOOGLE_ID}/edit`,
      },
      {
        provider: "google-slides",
        url: `https://docs.google.com/presentation/d/${GOOGLE_ID}/edit`,
      },
      {
        provider: "notion",
        url: "https://www.notion.so/Workspace-0123456789abcdef0123456789abcdef",
      },
    ],
  );
});

test("deduplicates links and ignores unsupported Google URLs", () => {
  const link = `https://docs.google.com/spreadsheets/d/${GOOGLE_ID}/edit#gid=0`;
  assert.deepEqual(findSupportedDocumentLinks(`${link} ${link}`), [
    { provider: "google-sheets", url: link },
  ]);
  assert.deepEqual(
    findSupportedDocumentLinks(
      `https://docs.google.com/forms/d/${GOOGLE_ID}/edit`,
    ),
    [],
  );
});
