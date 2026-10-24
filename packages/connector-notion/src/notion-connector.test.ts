import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectorError,
  type ApprovalGrant,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import type {
  NotionApiPort,
  NotionPageSnapshot,
  NotionRecoverySnapshot,
  NotionRecoveryStore,
} from "./contracts.ts";
import { NotionConnector } from "./notion-connector.ts";

class FakeApi implements NotionApiPort {
  snapshot: NotionPageSnapshot = {
    pageId: "11111111-1111-4111-8111-111111111111",
    title: "计划",
    markdown: "草稿",
    version: "v1",
    locator: "https://www.notion.so/11111111111141118111111111111111",
    writable: true,
    trashable: true,
    restorable: false,
    trashed: false,
  };
  readonly events: string[] = [];

  async readPage(accountId: string, pageId: string) {
    this.events.push(`read:${accountId}:${pageId}`);
    return { ...this.snapshot };
  }

  async replacePage(input: {
    accountId: string;
    pageId: string;
    expectedVersion: string;
    markdown: string;
  }) {
    this.events.push(`replace:${input.expectedVersion}:${input.markdown}`);
    if (input.expectedVersion !== this.snapshot.version) {
      throw new ConnectorError("conflict", "stale");
    }
    this.snapshot = {
      ...this.snapshot,
      markdown: input.markdown,
      version: "v2",
    };
    return { ...this.snapshot };
  }

  async createPage(input: {
    accountId: string;
    title: string;
    markdown: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }) {
    this.events.push(`create:${input.operationId}:${input.title}`);
    this.snapshot = {
      ...this.snapshot,
      pageId: "22222222-2222-4222-8222-222222222222",
      title: input.title,
      markdown: input.markdown,
      version: "created-v1",
      locator: "https://www.notion.so/22222222222242228222222222222222",
    };
    return { ...this.snapshot };
  }
}

class FakeRecovery implements NotionRecoveryStore {
  readonly events: string[];
  readonly snapshots: NotionRecoverySnapshot[] = [];

  constructor(events: string[]) {
    this.events = events;
  }

  async createRecoveryPoint(snapshot: NotionRecoverySnapshot) {
    this.events.push(`recovery:${snapshot.version}:${snapshot.markdown}`);
    this.snapshots.push({ ...snapshot });
    return { storageRef: "notion:recovery:1", version: snapshot.version };
  }

  async createCreationRecoveryPoint(input: { operationId: string }) {
    this.events.push(`creation-recovery:${input.operationId}`);
    return { storageRef: "notion:creation:1", version: "absent" };
  }
}

function approval(
  proposal: TextChangeProposal,
  id = "approval-1",
): ApprovalGrant {
  return {
    id,
    proposalId: proposal.id,
    patchHash: proposal.patchHash,
    connectorId: proposal.ref.connectorId,
    accountId: proposal.ref.accountId,
    resourceId: proposal.ref.resourceId,
    baseVersion: proposal.baseVersion,
    nonce: `${id}-nonce`,
    issuedAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:10:00.000Z",
  };
}

function fixture() {
  const api = new FakeApi();
  const recovery = new FakeRecovery(api.events);
  const connector = new NotionConnector({
    id: "notion-1",
    label: "Notion",
    accountId: "workspace-1",
    accountLabel: "Lecon",
    resources: [
      {
        id: "resource-1",
        projectId: "project-1",
        pageId: api.snapshot.pageId,
        displayName: "计划.md",
        locator: api.snapshot.locator,
        writable: true,
      },
    ],
    api,
    recovery,
    now: () => new Date("2026-08-05T00:05:00.000Z"),
    createId: (prefix) => `${prefix}-1`,
  });
  const ref = {
    connectorId: "notion-1",
    accountId: "workspace-1",
    resourceId: "resource-1",
    projectId: "project-1",
    kind: "notion-page",
    displayName: "计划.md",
    locator: api.snapshot.locator,
  };
  const proposal: TextChangeProposal = {
    id: "proposal-1",
    patchHash: "patch-1",
    ref,
    baseVersion: "v1",
    before: "草稿",
    after: "完成",
    summary: "更新计划",
  };
  return { api, connector, proposal, recovery };
}

test("Notion write rechecks, snapshots, replaces, and verifies", async () => {
  const { api, connector, proposal, recovery } = fixture();
  const result = await connector.applyTextChange(proposal, approval(proposal));

  assert.equal(result.version, "v2");
  assert.equal(recovery.snapshots[0]?.markdown, "草稿");
  assert.deepEqual(api.events, [
    `read:workspace-1:${api.snapshot.pageId}`,
    `read:workspace-1:${api.snapshot.pageId}`,
    "recovery:v1:草稿",
    "replace:v1:完成",
  ]);
});

test("Notion creation records absence before provider mutation", async () => {
  const { api, connector } = fixture();
  const proposal: TextChangeProposal = {
    id: "proposal-create",
    patchHash: "patch-create",
    ref: {
      connectorId: "notion-1",
      accountId: "workspace-1",
      resourceId: "resource-created",
      projectId: "project-1",
      kind: "notion-page-create",
      displayName: "新文档",
      locator: "notion:create:新文档",
    },
    baseVersion: "absent",
    before: "",
    after: "# 新文档\n正文",
    summary: "创建 Notion 页面",
  };

  const result = await connector.applyTextCreate!(
    proposal,
    approval(proposal, "approval-create"),
  );
  assert.equal(result.snapshot.text, proposal.after);
  assert.equal(result.snapshot.metadata.pageId, api.snapshot.pageId);
  assert.deepEqual(api.events, [
    "creation-recovery:proposal-create",
    "create:proposal-create:新文档",
  ]);
});

test("stale Notion page fails before recovery", async () => {
  const { api, connector, proposal, recovery } = fixture();
  api.snapshot = { ...api.snapshot, version: "v2", markdown: "他人修改" };

  await assert.rejects(
    connector.applyTextChange(proposal, approval(proposal)),
    (error) => error instanceof ConnectorError && error.code === "conflict",
  );
  assert.equal(recovery.snapshots.length, 0);
});

test("one read-only page does not disable another writable page", () => {
  const { api, recovery } = fixture();
  const connector = new NotionConnector({
    id: "notion-1",
    label: "Notion",
    accountId: "workspace-1",
    accountLabel: "Lecon",
    resources: [
      {
        id: "resource-read-only",
        projectId: "project-1",
        pageId: "33333333-3333-4333-8333-333333333333",
        displayName: "只读.md",
        locator: "https://www.notion.so/33333333333343338333333333333333",
        writable: false,
      },
      {
        id: "resource-1",
        projectId: "project-1",
        pageId: api.snapshot.pageId,
        displayName: "计划.md",
        locator: api.snapshot.locator,
        writable: true,
      },
    ],
    api,
    recovery,
  });

  assert.ok(connector.descriptor().capabilities.includes("write-text"));
});
