import assert from "node:assert/strict";
import test from "node:test";

import { summarizeProjectConnections } from "./google-workspace-connections.ts";
import type { ConnectionItem } from "./models.ts";

function google(id: string, resourceCount = 0): ConnectionItem {
  return {
    id,
    projectId: "project-1",
    name: id,
    accountId: "account-1",
    account: "reader@example.com",
    scope: "scope",
    status: "connected",
    resourceCount,
    access: "persistent",
    writeMode: "recoverable",
  };
}

test("Docs, Sheets, and Slides share one visible Google Workspace connection", () => {
  const summarized = summarizeProjectConnections(
    [
      google("google-docs-account", 1),
      google("google-sheets-account", 2),
      google("google-slides-account"),
    ],
    "project-1",
  );

  assert.equal(summarized.length, 1);
  assert.equal(summarized[0]?.name, "Google Workspace");
  assert.equal(summarized[0]?.resourceCount, 3);
});
