import type { DownloadedSkill } from "@/application/ports/downloaded-skills";
import type { CredentialVaultItem } from "@/application/ports/credential-vault";
import type { McpConnection } from "@/application/ports/mcp-connections";
import { createStore, type StoreApi } from "zustand/vanilla";

export type SessionState = Readonly<{
  credentialVaultItems: readonly CredentialVaultItem[];
  credentialVaultLoading: boolean;
  downloadedSkillItems: readonly DownloadedSkill[];
  downloadedSkillsLoading: boolean;
  mcpConnectionItems: readonly McpConnection[];
  mcpConnectionsLoading: boolean;
}>;

export type SessionStore = StoreApi<SessionState>;

export const initialSessionState: SessionState = Object.freeze({
  credentialVaultItems: Object.freeze([]),
  credentialVaultLoading: true,
  downloadedSkillItems: Object.freeze([]),
  downloadedSkillsLoading: true,
  mcpConnectionItems: Object.freeze([]),
  mcpConnectionsLoading: true,
});

export function createSessionStore(): SessionStore {
  return createStore<SessionState>()(() => initialSessionState);
}
