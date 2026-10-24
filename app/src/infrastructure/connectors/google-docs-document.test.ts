import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import {
  decodeGoogleDocument,
  googleDocumentUrl,
  parseGoogleDocumentId,
} from "./google-docs-document.ts";

const DOCUMENT_ID = "document_12345678901234567890";

function paragraph(text: string, textStyle: Record<string, unknown> = {}) {
  return {
    startIndex: 1,
    endIndex: text.length + 1,
    paragraph: {
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
      elements: [
        {
          startIndex: 1,
          endIndex: text.length + 1,
          textRun: { content: text, textStyle },
        },
      ],
    },
  };
}

function documentResponse(options?: {
  text?: string;
  revisionId?: string | null;
  style?: Record<string, unknown>;
  title?: string;
}) {
  const text = options?.text ?? "计划\n";
  return {
    documentId: DOCUMENT_ID,
    title: options?.title ?? "发布计划",
    ...(options?.revisionId === null
      ? {}
      : { revisionId: options?.revisionId ?? "revision-7" }),
    tabs: [
      {
        tabProperties: { tabId: "tab-1", title: "主文档" },
        documentTab: {
          body: {
            content: [
              { startIndex: 0, endIndex: 1, sectionBreak: {} },
              paragraph(text, options?.style),
            ],
          },
        },
      },
    ],
  };
}

test("Google Docs links and raw IDs resolve without accepting lookalike hosts", () => {
  assert.equal(parseGoogleDocumentId(DOCUMENT_ID), DOCUMENT_ID);
  assert.equal(
    parseGoogleDocumentId(
      `https://docs.google.com/document/d/${DOCUMENT_ID}/edit?tab=t.0`,
    ),
    DOCUMENT_ID,
  );
  assert.equal(
    parseGoogleDocumentId(
      `https://docs.google.com/document/u/1/d/${DOCUMENT_ID}/edit`,
    ),
    DOCUMENT_ID,
  );
  assert.equal(
    googleDocumentUrl(DOCUMENT_ID),
    `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
  );
  assert.throws(() =>
    parseGoogleDocumentId(
      `https://docs.google.com.example/document/d/${DOCUMENT_ID}/edit`,
    ),
  );
  assert.throws(() =>
    parseGoogleDocumentId(
      `http://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
    ),
  );
});

test("plain single-tab Google documents are safely writable text", () => {
  const decoded = decodeGoogleDocument(documentResponse());

  assert.deepEqual(decoded, {
    documentId: DOCUMENT_ID,
    title: "发布计划",
    text: "计划",
    revisionId: "revision-7",
    writable: true,
    tabId: "tab-1",
    endIndex: 4,
  });
});

test("rich text remains readable but is never offered as replaceable", () => {
  const decoded = decodeGoogleDocument(
    documentResponse({ style: { bold: true } }),
  );

  assert.equal(decoded.text, "计划");
  assert.equal(decoded.writable, false);
});

test("multiple tabs are flattened with labels and remain read-only", () => {
  const value = documentResponse();
  value.tabs.push({
    tabProperties: { tabId: "tab-2", title: "附录" },
    documentTab: {
      body: {
        content: [
          { startIndex: 0, endIndex: 1, sectionBreak: {} },
          paragraph("说明\n"),
        ],
      },
    },
  });

  const decoded = decodeGoogleDocument(value);
  assert.equal(decoded.text, "=== 主文档 ===\n计划\n\n=== 附录 ===\n说明");
  assert.equal(decoded.writable, false);
});

test("a document without a revision gets a stable read-only version", () => {
  const value = documentResponse({ revisionId: null });
  const first = decodeGoogleDocument(value);
  const second = decodeGoogleDocument(value);

  assert.equal(first.writable, false);
  assert.match(first.revisionId, /^read-only-[a-f0-9]{16}$/u);
  assert.equal(first.revisionId, second.revisionId);
});

test("invalid titles and oversized text fail closed", () => {
  assert.throws(
    () => decodeGoogleDocument(documentResponse({ title: "bad\ntitle" })),
    (error) => error instanceof ConnectorError && error.code === "io_failure",
  );
  assert.throws(
    () =>
      decodeGoogleDocument(
        documentResponse({ text: `${"x".repeat(100_001)}\n` }),
      ),
    (error) => error instanceof ConnectorError && error.code === "unsupported",
  );
});
