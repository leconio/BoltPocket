import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectorRegistry,
  ConnectorError,
  type ApprovalGrant,
  type TextChangeProposal,
} from "@boltpocket/connector-core";
import { LocalTextConnector } from "@boltpocket/connector-local";
import { InMemoryLocalTextStorage } from "@boltpocket/connector-local/testing";
import { GoogleDocsConnector } from "@boltpocket/connector-google-docs";
import {
  GoogleSheetsConnector,
  googleSpreadsheetResourceKey,
  googleSpreadsheetResourceUrl,
} from "@boltpocket/connector-google-sheets";

import { proposal, workspaceResources } from "../testing/app-state-fixtures.ts";
import type { ChangeProposal } from "../domain/models.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  PROJECT_WORKSPACE_ABSENT_VERSION,
} from "../domain/project-workspace.ts";
import {
  applyChangeProposalThroughConnectors,
  ChangeApplyRolledBackError,
  type ChangeApprovalAuthority,
} from "./connector-change-workflow.ts";

function authorityFixture(
  now = new Date("2026-08-03T00:05:00.000Z"),
): ChangeApprovalAuthority {
  let sequence = 0;
  return {
    authorize: async (change) => {
      sequence += 1;
      const patchHash = `sha256:test-patch-${sequence}`;
      const signedProposal: TextChangeProposal = { ...change, patchHash };
      const approval: ApprovalGrant = {
        id: `approval-${sequence}`,
        proposalId: signedProposal.id,
        patchHash,
        connectorId: signedProposal.ref.connectorId,
        accountId: signedProposal.ref.accountId,
        resourceId: signedProposal.ref.resourceId,
        baseVersion: signedProposal.baseVersion,
        nonce: `nonce-${sequence}`,
        issuedAt: new Date(now.getTime() - 60_000).toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      };
      return { proposal: signedProposal, approval };
    },
  };
}

function fixture() {
  const hunk = proposal.hunks[0]!;
  const resource = workspaceResources[hunk.resourceId]!;
  const singleProposal: ChangeProposal = {
    ...proposal,
    id: "connector-proposal",
    hunks: [hunk],
  };
  const storage = new InMemoryLocalTextStorage([
    {
      locator: resource.path,
      text: resource.content,
      version: String(resource.version),
    },
  ]);
  const connector = new LocalTextConnector({
    id: resource.connectionId,
    label: "Workspace",
    accountId: `project-${resource.projectId}`,
    accountLabel: "Q3 Product Launch",
    resources: [
      {
        id: resource.id,
        projectId: resource.projectId,
        displayName: resource.path,
        locator: resource.path,
        mediaType: "text/plain",
      },
    ],
    storage,
    now: () => new Date("2026-08-03T00:05:00.000Z"),
  });
  const authority = authorityFixture();
  return { authority, connector, hunk, singleProposal, storage };
}

test("default-allowed change runs through binding, recovery and write", async () => {
  const { authority, connector, hunk, singleProposal, storage } = fixture();
  const registry = new ConnectorRegistry([connector]);
  const result = await applyChangeProposalThroughConnectors({
    proposal: singleProposal,
    resources: workspaceResources,
    receiptId: "receipt-1",
    conversationId: "conversation-launch",
    appliedAt: "2026-08-03T00:05:00.000Z",
    registry,
    approvalAuthority: authority,
  });

  assert.equal(
    (await connector.read((await connector.list({ projectId: "launch" }))[0]!))
      .text,
    hunk.after,
  );
  assert.equal(storage.recoveries.size, 1);
  assert.equal(result.receipt.changes.length, 1);
});

test("project-workspace file creation is hash-bound and applied to app state", async () => {
  const bundle = createProjectWithWorkspace({
    id: "connector-create-project",
    name: "Connector create",
  });
  const draft = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "index.html",
    content: "",
    version: PROJECT_WORKSPACE_ABSENT_VERSION,
  });
  const createProposal: ChangeProposal = {
    id: "connector-create-proposal",
    projectId: bundle.project.id,
    conversationId: "connector-create-conversation",
    title: "新增网页入口",
    kind: "agent",
    status: "pending",
    connectorId: bundle.connection.id,
    connector: "Project connectors",
    createdAt: new Date().toISOString(),
    hunks: [
      {
        id: "connector-create-hunk",
        resourceId: draft.id,
        target: draft.path,
        operation: "create",
        baseVersion: PROJECT_WORKSPACE_ABSENT_VERSION,
        before: "",
        after: "<!doctype html>\n",
        summary: "新增 index.html",
        lines: [],
      },
    ],
  };
  const resources = Object.fromEntries(
    bundle.resources.map((resource) => [resource.id, resource]),
  );
  const storage = new InMemoryLocalTextStorage(
    bundle.resources.map((resource) => ({
      locator: resource.path,
      text: resource.content,
      version: resource.version,
    })),
  );
  const connector = new LocalTextConnector({
    id: bundle.connection.id,
    label: "Project workspace",
    accountId: `project-${bundle.project.id}`,
    accountLabel: bundle.project.name,
    resources: bundle.resources.map((resource) => ({
      id: resource.id,
      projectId: resource.projectId,
      displayName: resource.path,
      locator: resource.path,
      mediaType: "text/plain",
    })),
    storage,
  });

  const result = await applyChangeProposalThroughConnectors({
    proposal: createProposal,
    resources,
    receiptId: "connector-create-receipt",
    conversationId: "connector-create-conversation",
    appliedAt: new Date().toISOString(),
    registry: new ConnectorRegistry([connector]),
    approvalAuthority: authorityFixture(new Date()),
  });

  assert.equal(result.resources[draft.id]?.path, "index.html");
  assert.equal(result.resources[draft.id]?.content, "<!doctype html>\n");
  assert.equal(result.receipt.changes[0]?.operation, "create");
  assert.equal(storage.recoveries.size, 0);
});

test("external document creation stays hash-bound and materializes the provider snapshot", async () => {
  const now = new Date();
  const documentId = "created_document_123456789012345";
  const connector = new GoogleDocsConnector({
    id: "google-docs-project-account",
    label: "Google 文档",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    resources: [
      {
        id: "existing-google-doc",
        projectId: "project-1",
        documentId: "existing_document_12345678901234",
        displayName: "已有文档.txt",
        locator:
          "https://docs.google.com/document/d/existing_document_12345678901234/edit",
        writable: true,
      },
    ],
    api: {
      async readDocument() {
        throw new Error("not used");
      },
      async replaceDocument() {
        throw new Error("not used");
      },
      async createDocument(input) {
        assert.equal(
          input.operationId,
          "external-create-proposal:external-create-hunk",
        );
        return {
          documentId,
          title: input.title,
          text: input.text,
          revisionId: "revision-created",
          writable: true,
          trashable: true,
          restorable: false,
          trashed: false,
        };
      },
    },
    recovery: {
      async createRecoveryPoint() {
        throw new Error("not used");
      },
      async createCreationRecoveryPoint(input) {
        assert.equal(
          input.operationId,
          "external-create-proposal:external-create-hunk",
        );
        return { storageRef: "google-docs:create:intent", version: "absent" };
      },
    },
    now: () => now,
  });
  const createProposal: ChangeProposal = {
    id: "external-create-proposal",
    projectId: "project-1",
    conversationId: "conversation-1",
    title: "新建 Google 文档",
    kind: "agent",
    status: "pending",
    connectorId: "google-docs-project-account",
    connector: "Google 文档",
    createdAt: now.toISOString(),
    hunks: [
      {
        id: "external-create-hunk",
        resourceId: "google-doc-created-a1b2c3d4",
        target: "验收文档",
        operation: "create",
        createTarget: {
          provider: "google-docs",
          connectorId: "google-docs-project-account",
          accountId: "account-1",
          accountLabel: "reader@example.com",
        },
        baseVersion: "absent",
        before: "",
        after: "模型创建的正文",
        summary: "新建验收文档",
        lines: [],
      },
    ],
  };

  const result = await applyChangeProposalThroughConnectors({
    proposal: createProposal,
    resources: {},
    receiptId: "external-create-receipt",
    conversationId: "conversation-1",
    appliedAt: now.toISOString(),
    registry: new ConnectorRegistry([connector]),
    approvalAuthority: authorityFixture(now),
  });

  const created = result.resources["google-doc-created-a1b2c3d4"];
  assert.equal(created?.content, "模型创建的正文");
  assert.equal(created?.version, "revision-created");
  assert.equal(created?.storage.kind, "google-doc");
  assert.equal(result.receipt.changes[0]?.afterVersion, "revision-created");
});

test("Google Sheets creation materializes the exact tab binding and canonical CSV", async () => {
  const now = new Date();
  const spreadsheetId = "created_sheet_12345678901234567890";
  const providerResourceId = googleSpreadsheetResourceKey(spreadsheetId, 0);
  const connector = new GoogleSheetsConnector({
    id: "google-sheets-project-account",
    label: "Google 表格",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    resources: [
      {
        id: "existing-google-sheet",
        projectId: "project-1",
        spreadsheetResourceId: googleSpreadsheetResourceKey(
          "existing_sheet_1234567890123456789",
          0,
        ),
        displayName: "已有表格.csv",
        locator: googleSpreadsheetResourceUrl(
          googleSpreadsheetResourceKey("existing_sheet_1234567890123456789", 0),
        ),
        writable: true,
      },
    ],
    api: {
      async readResource() {
        throw new Error("not used");
      },
      async replaceResource() {
        throw new Error("not used");
      },
      async createResource(input) {
        assert.equal(
          input.operationId,
          "sheet-create-proposal:sheet-create-hunk",
        );
        return {
          resourceId: providerResourceId,
          spreadsheetId,
          sheetId: 0,
          sheetTitle: "工作表1",
          title: `${input.title} · 工作表1`,
          text: input.text,
          version: "8:2026-08-07T00:00:00.000Z:hash",
          writable: true,
          trashable: true,
          restorable: false,
          trashed: false,
          metadata: { spreadsheetId, sheetId: 0, sheetTitle: "工作表1" },
        };
      },
    },
    recovery: {
      async createRecoveryPoint() {
        throw new Error("not used");
      },
      async createCreationRecoveryPoint() {
        return { storageRef: "google-sheets:create:intent", version: "absent" };
      },
    },
    now: () => now,
  });
  const createProposal: ChangeProposal = {
    id: "sheet-create-proposal",
    projectId: "project-1",
    conversationId: "conversation-1",
    title: "新建 Google 表格",
    kind: "agent",
    status: "pending",
    connectorId: "google-sheets-project-account",
    connector: "Google 表格",
    createdAt: now.toISOString(),
    hunks: [
      {
        id: "sheet-create-hunk",
        resourceId: "google-sheet-created-a1b2c3d4",
        target: "模型验收表格",
        operation: "create",
        createTarget: {
          provider: "google-sheets",
          connectorId: "google-sheets-project-account",
          accountId: "account-1",
          accountLabel: "reader@example.com",
        },
        baseVersion: "absent",
        before: "",
        after: "Name,Value\nalpha,1",
        summary: "新建模型验收表格",
        lines: [],
      },
    ],
  };

  const result = await applyChangeProposalThroughConnectors({
    proposal: createProposal,
    resources: {},
    receiptId: "sheet-create-receipt",
    conversationId: "conversation-1",
    appliedAt: now.toISOString(),
    registry: new ConnectorRegistry([connector]),
    approvalAuthority: authorityFixture(now),
  });

  const created = result.resources["google-sheet-created-a1b2c3d4"];
  assert.equal(created?.path, "模型验收表格 · 工作表1.csv");
  assert.equal(created?.content, "Name,Value\nalpha,1");
  assert.deepEqual(created?.storage, {
    kind: "google-sheet",
    locator: googleSpreadsheetResourceUrl(providerResourceId),
    spreadsheetId,
    sheetId: 0,
    accountId: "account-1",
    accountLabel: "reader@example.com",
    writable: true,
    trashable: true,
    restorable: false,
    trashed: false,
    access: "persistent",
  });
});

test("connector rejects a mismatched approval before writing", async () => {
  const { authority, connector, hunk, singleProposal, storage } = fixture();
  const invalidAuthority: ChangeApprovalAuthority = {
    authorize: async (change) => {
      const binding = await authority.authorize(change);
      return {
        ...binding,
        approval: { ...binding.approval, patchHash: "different" },
      };
    },
  };

  await assert.rejects(
    applyChangeProposalThroughConnectors({
      proposal: singleProposal,
      resources: workspaceResources,
      receiptId: "receipt-1",
      conversationId: "conversation-launch",
      appliedAt: "2026-08-03T00:05:00.000Z",
      registry: new ConnectorRegistry([connector]),
      approvalAuthority: invalidAuthority,
    }),
  );
  assert.equal((await storage.read(hunk.target)).text, hunk.before);
  assert.equal(storage.recoveries.size, 0);
});

test("connector scope mismatch fails before authorization or recovery", async () => {
  const { connector, singleProposal, storage } = fixture();
  const descriptor = connector.descriptor();
  const validRef = (await connector.list({ projectId: "launch" }))[0]!;
  let authorizationCalls = 0;
  const authority: ChangeApprovalAuthority = {
    async authorize(change) {
      authorizationCalls += 1;
      return authorityFixture().authorize(change);
    },
  };
  const mismatchedConnector = {
    descriptor: () => descriptor,
    list: async () => [{ ...validRef, projectId: "another-project" }],
  } as never;

  await assert.rejects(
    applyChangeProposalThroughConnectors({
      proposal: singleProposal,
      resources: workspaceResources,
      receiptId: "receipt-scope-mismatch",
      conversationId: "conversation-launch",
      appliedAt: "2026-08-03T00:05:00.000Z",
      registry: new ConnectorRegistry([mismatchedConnector]),
      approvalAuthority: authority,
    }),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );
  assert.equal(authorizationCalls, 0);
  assert.equal(storage.recoveries.size, 0);
});

test("a later target failure rolls earlier targets back in reverse", async () => {
  const [firstHunk, secondHunk] = proposal.hunks;
  assert.ok(firstHunk);
  assert.ok(secondHunk);
  const firstResource = workspaceResources[firstHunk.resourceId]!;
  const secondResource = workspaceResources[secondHunk.resourceId]!;
  class FailSecondWriteStorage extends InMemoryLocalTextStorage {
    writes = 0;

    override async replaceWithRecovery(
      locator: string,
      expectedVersion: string,
      text: string,
    ) {
      this.writes += 1;
      if (this.writes === 2) throw new Error("fixture second write failure");
      return super.replaceWithRecovery(locator, expectedVersion, text);
    }
  }
  const storage = new FailSecondWriteStorage([
    {
      locator: firstResource.path,
      text: firstResource.content,
      version: firstResource.version,
    },
    {
      locator: secondResource.path,
      text: secondResource.content,
      version: secondResource.version,
    },
  ]);
  const connector = new LocalTextConnector({
    id: firstResource.connectionId,
    label: firstResource.connectionId,
    accountId: `project-${firstResource.projectId}`,
    accountLabel: "Q3 Product Launch",
    resources: [firstResource, secondResource].map((resource) => ({
      id: resource.id,
      projectId: resource.projectId,
      displayName: resource.path,
      locator: resource.path,
      mediaType: "text/plain",
    })),
    storage,
    now: () => new Date("2026-08-03T00:05:00.000Z"),
  });

  await assert.rejects(
    applyChangeProposalThroughConnectors({
      proposal: { ...proposal, id: "multi-target-proposal" },
      resources: workspaceResources,
      receiptId: "receipt-multi",
      conversationId: "conversation-launch",
      appliedAt: "2026-08-03T00:05:00.000Z",
      registry: new ConnectorRegistry([connector]),
      approvalAuthority: authorityFixture(),
    }),
    (error) => error instanceof ChangeApplyRolledBackError,
  );

  assert.equal(
    (await storage.read(firstResource.path)).text,
    firstResource.content,
  );
  assert.equal(
    (await storage.read(secondResource.path)).text,
    secondResource.content,
  );
  assert.equal(storage.recoveries.size, 3);
});
