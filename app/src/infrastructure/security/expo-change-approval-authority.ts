import type { ApprovalGrant, TextChangeProposal } from "@boltpocket/connector-core";
import * as Crypto from "expo-crypto";

import type { ChangeApprovalAuthority } from "@/application/connector-change-workflow";

type UnsignedTextChange = Omit<TextChangeProposal, "patchHash">;

function canonicalChange(change: UnsignedTextChange) {
  return JSON.stringify({
    id: change.id,
    connectorId: change.ref.connectorId,
    accountId: change.ref.accountId,
    resourceId: change.ref.resourceId,
    projectId: change.ref.projectId,
    locator: change.ref.locator,
    baseVersion: change.baseVersion,
    before: change.before,
    after: change.after,
    summary: change.summary,
  });
}

export class ExpoChangeApprovalAuthority implements ChangeApprovalAuthority {
  async authorize(change: UnsignedTextChange) {
    const patchHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      canonicalChange(change),
    );
    const now = new Date();
    const proposal: TextChangeProposal = { ...change, patchHash };
    const approval: ApprovalGrant = {
      id: Crypto.randomUUID(),
      proposalId: proposal.id,
      patchHash,
      connectorId: proposal.ref.connectorId,
      accountId: proposal.ref.accountId,
      resourceId: proposal.ref.resourceId,
      baseVersion: proposal.baseVersion,
      nonce: Crypto.randomUUID(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    };
    return { proposal, approval };
  }
}
