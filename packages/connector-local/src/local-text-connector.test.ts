import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectorError,
  type ApprovalGrant,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import { LocalTextConnector } from "./local-text-connector.ts";
import { InMemoryLocalTextStorage } from "./testing.ts";

function fixture() {
  const now = new Date("2026-08-03T00:05:00.000Z");
  const storage = new InMemoryLocalTextStorage([
    { locator: "project/plan.txt", text: "draft", version: "7" },
  ]);
  const connector = new LocalTextConnector({
    id: "local",
    label: "Local workspace",
    accountId: "device",
    accountLabel: "This device",
    resources: [
      {
        id: "plan",
        projectId: "project",
        displayName: "Plan",
        locator: "project/plan.txt",
        mediaType: "text/plain",
      },
    ],
    storage,
    now: () => now,
    createId: (prefix) => `${prefix}-1`,
  });
  const ref = {
    connectorId: "local",
    accountId: "device",
    resourceId: "plan",
    projectId: "project",
    kind: "text",
    displayName: "Plan",
    locator: "project/plan.txt",
  };
  const proposal: TextChangeProposal = {
    id: "proposal-1",
    patchHash: "patch-1",
    ref,
    baseVersion: "7",
    before: "draft",
    after: "ready",
    summary: "Mark ready",
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
    issuedAt: "2026-08-03T00:00:00.000Z",
    expiresAt: "2026-08-03T00:10:00.000Z",
  };
  return { approval, connector, proposal, storage };
}

test("local text connector lists, searches and reads only scoped resources", async () => {
  const { connector } = fixture();
  assert.equal((await connector.list({ projectId: "project" })).length, 1);
  assert.equal(
    (await connector.search({ projectId: "project", query: "draft" })).length,
    1,
  );
  const [ref] = await connector.list({ projectId: "project" });
  assert.equal((await connector.read(ref!)).text, "draft");
});

test("approved local write creates recovery before safe replacement", async () => {
  const { approval, connector, proposal, storage } = fixture();
  const result = await connector.applyTextChange(proposal, approval);

  assert.equal((await connector.read(proposal.ref)).text, "ready");
  assert.equal(result.previousVersion, "7");
  assert.equal(result.version, "8");
  assert.equal(
    storage.recoveries.get(result.recoveryPoint.storageRef)?.text,
    "draft",
  );
});

test("stale source fails before recovery or write", async () => {
  const { approval, connector, proposal, storage } = fixture();
  await storage.replaceWithRecovery(
    "project/plan.txt",
    "7",
    "someone else changed it",
  );

  await assert.rejects(
    connector.applyTextChange(proposal, approval),
    (error) => error instanceof ConnectorError && error.code === "conflict",
  );
  assert.equal(storage.recoveries.size, 0);
});

test("recovery failure preserves source and does not consume approval", async () => {
  const { approval, connector, proposal, storage } = fixture();
  storage.failRecovery = true;
  await assert.rejects(
    connector.applyTextChange(proposal, approval),
    (error) =>
      error instanceof ConnectorError && error.code === "recovery_failed",
  );
  assert.equal((await connector.read(proposal.ref)).text, "draft");

  storage.failRecovery = false;
  await connector.applyTextChange(proposal, approval);
  assert.equal((await connector.read(proposal.ref)).text, "ready");
});

test("one approval cannot be replayed", async () => {
  const { approval, connector, proposal } = fixture();
  await connector.applyTextChange(proposal, approval);
  await assert.rejects(
    connector.applyTextChange(
      { ...proposal, baseVersion: "8", before: "ready", after: "published" },
      { ...approval, baseVersion: "8" },
    ),
    (error) =>
      error instanceof ConnectorError && error.code === "approval_replayed",
  );
});
