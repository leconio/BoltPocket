import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectorRegistry,
  type ConnectorResourceRef,
  type ProjectConnector,
} from "@boltpocket/connector-core";

import type { WorkspaceResource } from "@/domain/models";

import {
  readCurrentWorkspaceResource,
  type ActiveRunContext,
} from "./pi-mobile-agent-context.ts";

const ref: ConnectorResourceRef = {
  connectorId: "google-sheets-1",
  accountId: "account-1",
  resourceId: "google-sheet-1",
  projectId: "project-1",
  kind: "google-sheet",
  displayName: "QA.csv",
  locator:
    "https://docs.google.com/spreadsheets/d/spreadsheet_12345678901234567890/edit",
};

const staleResource: WorkspaceResource = {
  id: ref.resourceId,
  projectId: ref.projectId,
  connectionId: ref.connectorId,
  path: "QA.csv",
  content: "Status\nPending\n",
  version: "old",
  storage: {
    kind: "google-sheet",
    locator: ref.locator,
    spreadsheetId: "spreadsheet_12345678901234567890",
    sheetId: 0,
    accountId: "account-1",
    accountLabel: "owner@example.com",
    writable: false,
    trashable: false,
    restorable: false,
    trashed: false,
    access: "persistent",
  },
};

test("live connector metadata upgrades a stale read-only resource after reauthorization", async () => {
  const connector: ProjectConnector = {
    descriptor: () => ({
      id: ref.connectorId,
      label: "Google Sheets",
      kind: "google-sheets",
      accountId: "account-1",
      accountLabel: "owner@example.com",
      status: "connected",
      projectIds: [ref.projectId],
      capabilities: ["list", "read-text"],
    }),
    list: async () => [ref],
    search: async () => [ref],
    read: async () => ({
      ref,
      mediaType: "text/csv",
      text: "Status\nPending\n",
      version: "current",
      metadata: {
        writable: true,
        trashable: true,
        restorable: false,
        trashed: false,
      },
    }),
    validateTextChange: async () => undefined,
    applyTextChange: async () => {
      throw new Error("not used");
    },
  };
  const active = {
    input: {
      project: { id: ref.projectId },
      resources: [staleResource],
    },
    registry: new ConnectorRegistry([connector]),
    resourceSnapshots: new Map<string, WorkspaceResource>(),
  } as ActiveRunContext;

  const refreshed = await readCurrentWorkspaceResource(active, ref);

  assert.equal(refreshed.version, "current");
  assert.equal(refreshed.storage.kind, "google-sheet");
  if (refreshed.storage.kind !== "google-sheet") assert.fail("wrong storage");
  assert.equal(refreshed.storage.writable, true);
  assert.equal(refreshed.storage.trashable, true);
  assert.equal(active.resourceSnapshots.get(ref.resourceId), refreshed);
});
