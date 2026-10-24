import assert from "node:assert/strict";
import test from "node:test";

import { verifyApprovalBinding } from "./approval.ts";
import type {
  ApprovalGrant,
  ConnectorResourceRef,
  TextChangeProposal,
} from "./contracts.ts";
import { ConnectorError } from "./errors.ts";

const ref: ConnectorResourceRef = {
  connectorId: "workspace",
  accountId: "account",
  resourceId: "plan",
  projectId: "project",
  kind: "text",
  displayName: "Plan",
  locator: "workspace/plan.txt",
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
  nonce: "one-time-nonce",
  issuedAt: "2026-08-03T00:00:00.000Z",
  expiresAt: "2026-08-03T00:10:00.000Z",
};

test("approval is accepted only for its exact patch binding", () => {
  assert.doesNotThrow(() =>
    verifyApprovalBinding(approval, proposal, new Date("2026-08-03T00:05:00Z")),
  );
  assert.throws(
    () =>
      verifyApprovalBinding(
        { ...approval, patchHash: "different" },
        proposal,
        new Date("2026-08-03T00:05:00Z"),
      ),
    (error) =>
      error instanceof ConnectorError && error.code === "invalid_approval",
  );
});

test("expired approval is rejected", () => {
  assert.throws(
    () =>
      verifyApprovalBinding(
        approval,
        proposal,
        new Date("2026-08-03T00:11:00Z"),
      ),
    (error) =>
      error instanceof ConnectorError && error.code === "approval_expired",
  );
});
