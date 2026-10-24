import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import { parseNotionPageId } from "./notion-link.ts";

const PAGE_ID = "3b43e796-41aa-811d-9f15-fca07f68f028";

test("parses current app.notion.com page links", () => {
  assert.equal(
    parseNotionPageId(
      "https://app.notion.com/p/BoltPocket-Notion-3b43e79641aa811d9f15fca07f68f028",
    ),
    PAGE_ID,
  );
});

test("rejects lookalike Notion hosts", () => {
  assert.throws(
    () =>
      parseNotionPageId(
        "https://app.notion.com.example.com/p/3b43e79641aa811d9f15fca07f68f028",
      ),
    (error) => error instanceof ConnectorError && error.code === "unsupported",
  );
});
