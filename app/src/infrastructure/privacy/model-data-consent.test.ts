import assert from "node:assert/strict";
import test from "node:test";

import { aiDataCategoriesForMessage } from "./model-data-consent.ts";

test("pending document links are disclosed before their contents can reach the model", () => {
  assert.deepEqual(
    aiDataCategoriesForMessage({
      hasAttachments: false,
      hasProjectContext: true,
      hasConnectedDocuments: false,
      hasPendingDocumentLinks: true,
    }),
    ["message", "project-context", "connected-documents"],
  );
});

test("message disclosures include only the data categories that may be sent", () => {
  assert.deepEqual(
    aiDataCategoriesForMessage({
      hasAttachments: true,
      hasProjectContext: false,
      hasConnectedDocuments: false,
      hasPendingDocumentLinks: false,
    }),
    ["message", "attachments"],
  );
});
