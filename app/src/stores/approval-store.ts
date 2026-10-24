import type { PendingAiDataConsent } from "@/application/ports/ai-data-consent";
import type { PendingCredentialAccess } from "@/application/ports/credential-vault";
import type { PendingDeviceCapabilityAccess } from "@/application/ports/device-capabilities";
import type { PendingMcpToolApproval } from "@/application/ports/mcp-tool-approval";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ApprovalState = Readonly<{
  credentialAccess: PendingCredentialAccess | null;
  aiDataConsent: PendingAiDataConsent | null;
  mcpTool: PendingMcpToolApproval | null;
  deviceCapability: PendingDeviceCapabilityAccess | null;
}>;

export type ApprovalStore = StoreApi<ApprovalState>;

export const initialApprovalState: ApprovalState = Object.freeze({
  credentialAccess: null,
  aiDataConsent: null,
  mcpTool: null,
  deviceCapability: null,
});

export function createApprovalStore(): ApprovalStore {
  return createStore<ApprovalState>()(() => initialApprovalState);
}
