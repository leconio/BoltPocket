import assert from "node:assert/strict";
import test from "node:test";

import {
  type ApprovalGrant,
  type ConnectorResourceRef,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import type {
  GoogleWorkspaceRecoverySnapshot,
  GoogleWorkspaceTextSnapshot,
} from "./contracts.ts";
import { GoogleWorkspaceTextConnector } from "./google-workspace-text-connector.ts";

const now = new Date("2026-08-07T00:00:00.000Z");
const ref: ConnectorResourceRef = {
  connectorId: "sheets-1",
  accountId: "account-1",
  resourceId: "resource-1",
  projectId: "project-1",
  kind: "google-sheet",
  displayName: "Budget.csv",
  locator: "https://example.invalid/sheet-1",
};

test("rechecks, snapshots, writes, and verifies a Workspace text change", async () => {
  let snapshot: GoogleWorkspaceTextSnapshot = {
    resourceId: "provider-1",
    title: "Budget",
    text: "a,b",
    version: "v1",
    writable: true,
  };
  const recoveries: GoogleWorkspaceRecoverySnapshot[] = [];
  const connector = new GoogleWorkspaceTextConnector({
    id: ref.connectorId,
    label: "Google 表格",
    accountId: ref.accountId,
    accountLabel: "account@example.com",
    resources: [
      {
        id: ref.resourceId,
        projectId: ref.projectId,
        providerResourceId: "provider-1",
        displayName: ref.displayName,
        locator: ref.locator,
        writable: true,
      },
    ],
    api: {
      async readResource() {
        return snapshot;
      },
      async replaceResource(input) {
        assert.equal(input.expectedVersion, "v1");
        snapshot = { ...snapshot, text: input.text, version: "v2" };
        return snapshot;
      },
    },
    recovery: {
      async createRecoveryPoint(value) {
        recoveries.push(value);
        return { storageRef: "recovery-1", version: value.version };
      },
    },
    profile: {
      descriptorKind: "google-sheets",
      resourceKind: "google-sheet",
      resourceNoun: "Google spreadsheet",
      mediaType: "text/csv",
      metadataIdKey: "spreadsheetId",
      maximumCharacters: 10_000,
      resourceUrl: () => ref.locator,
    },
    now: () => now,
    createId: () => "recovery-result-1",
  });
  const proposal: TextChangeProposal = {
    id: "proposal-1",
    patchHash: "patch-1",
    ref,
    baseVersion: "v1",
    before: "a,b",
    after: "a,c",
    summary: "change one cell",
  };
  const approval: ApprovalGrant = {
    id: "approval-1",
    proposalId: proposal.id,
    patchHash: proposal.patchHash,
    connectorId: ref.connectorId,
    accountId: ref.accountId,
    resourceId: ref.resourceId,
    baseVersion: proposal.baseVersion,
    nonce: "nonce-1",
    issuedAt: now.toISOString(),
    expiresAt: "2026-08-07T00:05:00.000Z",
  };
  const result = await connector.applyTextChange(proposal, approval);
  assert.equal(result.version, "v2");
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0]?.text, "a,b");
});

test("account-only Workspace connector remains create-capable", async () => {
  const connector = new GoogleWorkspaceTextConnector({
    id: "sheets-account-1",
    label: "Google 表格",
    accountId: "account-1",
    accountLabel: "account@example.com",
    projectIds: ["project-1"],
    resources: [],
    api: {
      async readResource() {
        throw new Error("not used");
      },
      async replaceResource() {
        throw new Error("not used");
      },
      async createResource() {
        throw new Error("not used");
      },
    },
    recovery: {
      async createRecoveryPoint() {
        throw new Error("not used");
      },
      async createCreationRecoveryPoint() {
        return { storageRef: "create-intent", version: "absent" };
      },
    },
    profile: {
      descriptorKind: "google-sheets",
      resourceKind: "google-sheet",
      resourceNoun: "Google spreadsheet",
      mediaType: "text/csv",
      metadataIdKey: "spreadsheetId",
      maximumCharacters: 10_000,
      resourceUrl: () => "https://example.invalid/new-sheet",
    },
  });

  assert.deepEqual(connector.descriptor().projectIds, ["project-1"]);
  assert.ok(connector.descriptor().capabilities.includes("create-text"));
  assert.deepEqual(await connector.list({ projectId: "project-1" }), []);
});
