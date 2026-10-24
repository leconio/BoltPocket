import type {
  ApprovalGrant,
  ConnectorResourceRef,
  TextChangeProposal,
} from "./contracts.ts";
import { ConnectorError } from "./errors.ts";

export function sameResource(
  left: ConnectorResourceRef,
  right: ConnectorResourceRef,
) {
  return (
    left.connectorId === right.connectorId &&
    left.accountId === right.accountId &&
    left.resourceId === right.resourceId &&
    left.projectId === right.projectId &&
    left.locator === right.locator
  );
}

export function verifyApprovalBinding(
  approval: ApprovalGrant,
  proposal: TextChangeProposal,
  now = new Date(),
) {
  const expiresAt = Date.parse(approval.expiresAt);
  const issuedAt = Date.parse(approval.issuedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) {
    throw new ConnectorError(
      "invalid_approval",
      "Approval timestamps are invalid.",
    );
  }
  if (expiresAt <= now.getTime() || issuedAt > now.getTime()) {
    throw new ConnectorError(
      "approval_expired",
      "Approval is not currently valid.",
    );
  }
  const matches =
    approval.proposalId === proposal.id &&
    approval.patchHash === proposal.patchHash &&
    approval.connectorId === proposal.ref.connectorId &&
    approval.accountId === proposal.ref.accountId &&
    approval.resourceId === proposal.ref.resourceId &&
    approval.baseVersion === proposal.baseVersion;
  if (!matches || !approval.id || !approval.nonce) {
    throw new ConnectorError(
      "invalid_approval",
      "Approval is not bound to this exact text change.",
    );
  }
}
