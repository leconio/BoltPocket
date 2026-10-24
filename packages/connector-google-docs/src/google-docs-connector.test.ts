import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectorError,
  type ApprovalGrant,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import type {
  GoogleDocsApiPort,
  GoogleDocsDocumentSnapshot,
  GoogleDocsRecoverySnapshot,
  GoogleDocsRecoveryStore,
} from "./contracts.ts";
import { GoogleDocsConnector } from "./google-docs-connector.ts";

class FakeApi implements GoogleDocsApiPort {
  snapshot: GoogleDocsDocumentSnapshot = {
    documentId: "document_12345678901234567890",
    title: "计划",
    text: "草稿",
    revisionId: "7",
    writable: true,
  };
  readonly events: string[] = [];

  async readDocument(accountId: string, documentId: string) {
    this.events.push(`read:${accountId}:${documentId}`);
    return { ...this.snapshot };
  }

  async replaceDocument(input: {
    accountId: string;
    documentId: string;
    expectedRevisionId: string;
    text: string;
  }) {
    this.events.push(`replace:${input.expectedRevisionId}:${input.text}`);
    if (input.expectedRevisionId !== this.snapshot.revisionId) {
      throw new ConnectorError("conflict", "stale");
    }
    this.snapshot = {
      ...this.snapshot,
      text: input.text,
      revisionId: String(Number(this.snapshot.revisionId) + 1),
    };
    return { ...this.snapshot };
  }
}

class FakeRecoveryStore implements GoogleDocsRecoveryStore {
  readonly events: string[];
  readonly snapshots: GoogleDocsRecoverySnapshot[] = [];

  constructor(events: string[]) {
    this.events = events;
  }

  async createRecoveryPoint(snapshot: GoogleDocsRecoverySnapshot) {
    this.events.push(`recovery:${snapshot.revisionId}:${snapshot.text}`);
    this.snapshots.push({ ...snapshot });
    return { storageRef: "recovery:1", version: snapshot.revisionId };
  }
}

function fixture(options?: { writable?: boolean; readOnly?: boolean }) {
  const api = new FakeApi();
  const recovery = new FakeRecoveryStore(api.events);
  const connector = new GoogleDocsConnector({
    id: "google-docs-1",
    label: "Google 文档",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    resources: [
      {
        id: "resource-1",
        projectId: "project-1",
        documentId: api.snapshot.documentId,
        displayName: "计划.txt",
        locator: `https://docs.google.com/document/d/${api.snapshot.documentId}/edit`,
        writable: options?.writable ?? true,
      },
    ],
    api,
    recovery,
    readOnly: options?.readOnly,
    now: () => new Date("2026-08-05T00:05:00.000Z"),
    createId: (prefix) => `${prefix}-1`,
  });
  const ref = {
    connectorId: "google-docs-1",
    accountId: "account-1",
    resourceId: "resource-1",
    projectId: "project-1",
    kind: "google-doc",
    displayName: "计划.txt",
    locator: `https://docs.google.com/document/d/${api.snapshot.documentId}/edit`,
  };
  const proposal: TextChangeProposal = {
    id: "proposal-1",
    patchHash: "patch-1",
    ref,
    baseVersion: "7",
    before: "草稿",
    after: "完成",
    summary: "更新计划",
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
    issuedAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:10:00.000Z",
  };
  return { api, approval, connector, proposal, recovery };
}

test("Google Docs connector exposes only explicitly scoped documents", async () => {
  const { connector, proposal } = fixture();

  assert.deepEqual(connector.descriptor().capabilities, [
    "list",
    "search",
    "read-text",
    "write-text",
    "recovery",
  ]);
  assert.equal((await connector.list({ projectId: "project-1" })).length, 1);
  assert.equal((await connector.list({ projectId: "project-2" })).length, 0);
  assert.equal(
    (await connector.search({ projectId: "project-1", query: "草稿" })).length,
    1,
  );
  await assert.rejects(
    connector.read({ ...proposal.ref, projectId: "project-2" }),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );
});

test("account-only Google Docs connector can create before a link is attached", async () => {
  const connector = new GoogleDocsConnector({
    id: "google-docs-account-1",
    label: "Google 文档",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    projectIds: ["project-1"],
    resources: [],
    api: {
      async readDocument() {
        throw new Error("not used");
      },
      async replaceDocument() {
        throw new Error("not used");
      },
      async createDocument() {
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
  });

  assert.deepEqual(connector.descriptor().projectIds, ["project-1"]);
  assert.ok(connector.descriptor().capabilities.includes("create-text"));
  assert.deepEqual(await connector.list({ projectId: "project-1" }), []);
});

test("Google Docs write rechecks, creates recovery, then replaces", async () => {
  const { api, approval, connector, proposal, recovery } = fixture();

  const result = await connector.applyTextChange(proposal, approval);

  assert.equal(result.previousVersion, "7");
  assert.equal(result.version, "8");
  assert.equal(result.recoveryPoint.storageRef, "recovery:1");
  assert.deepEqual(api.events, [
    `read:account-1:${api.snapshot.documentId}`,
    `read:account-1:${api.snapshot.documentId}`,
    "recovery:7:草稿",
    "replace:7:完成",
  ]);
  assert.equal(recovery.snapshots[0]?.accountId, "account-1");
  assert.equal((await connector.read(proposal.ref)).text, "完成");
});

test("stale Google revision fails before recovery and write", async () => {
  const { api, approval, connector, proposal, recovery } = fixture();
  api.snapshot = { ...api.snapshot, revisionId: "8", text: "他人修改" };

  await assert.rejects(
    connector.applyTextChange(proposal, approval),
    (error) => error instanceof ConnectorError && error.code === "conflict",
  );
  assert.equal(recovery.snapshots.length, 0);
  assert.equal(
    api.events.some((event) => event.startsWith("replace:")),
    false,
  );
});

test("read-only documents cannot receive a text change", async () => {
  const { approval, connector, proposal } = fixture({ writable: false });

  assert.deepEqual(connector.descriptor().capabilities, [
    "list",
    "search",
    "read-text",
  ]);
  await assert.rejects(
    connector.applyTextChange(proposal, approval),
    (error) => error instanceof ConnectorError && error.code === "unsupported",
  );
});

test("one read-only document does not disable another writable document", async () => {
  const api = new FakeApi();
  const connector = new GoogleDocsConnector({
    id: "google-docs-1",
    label: "Google 文档",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    resources: [
      {
        id: "resource-read-only",
        projectId: "project-1",
        documentId: "document_read_only_123456789012",
        displayName: "只读.txt",
        locator:
          "https://docs.google.com/document/d/document_read_only_123456789012/edit",
        writable: false,
      },
      {
        id: "resource-1",
        projectId: "project-1",
        documentId: api.snapshot.documentId,
        displayName: "计划.txt",
        locator: `https://docs.google.com/document/d/${api.snapshot.documentId}/edit`,
        writable: true,
      },
    ],
    api,
    recovery: new FakeRecoveryStore(api.events),
  });

  assert.ok(connector.descriptor().capabilities.includes("write-text"));
});

test("one Google Docs write binding cannot be replayed", async () => {
  const { approval, connector, proposal } = fixture();
  await connector.applyTextChange(proposal, approval);

  await assert.rejects(
    connector.applyTextChange(
      { ...proposal, baseVersion: "8", before: "完成", after: "发布" },
      { ...approval, baseVersion: "8" },
    ),
    (error) =>
      error instanceof ConnectorError && error.code === "approval_replayed",
  );
});
