import type { SshHostKey } from "./ssh-command-sessions.ts";

export type CredentialKind = "password" | "ssh" | "api-token" | "secret-text";

export type CredentialSource = "manual" | "conversation";

export type CredentialAgentAccess = "requestable" | "internal-only";

export type SshCredentialAuthentication = "password" | "private-key";

export type ApiCredentialAuthentication = "bearer" | "header";

export type CredentialSecret =
  | { kind: "password"; password: string }
  | {
      kind: "ssh";
      authentication: "password";
      password: string;
    }
  | {
      kind: "ssh";
      authentication: "private-key";
      privateKey: string;
      publicKey?: string;
      passphrase?: string;
    }
  | { kind: "api-token"; token: string }
  | { kind: "secret-text"; value: string };

export type CredentialVaultItem = {
  id: string;
  label: string;
  kind: CredentialKind;
  service?: string;
  username?: string;
  endpoint?: string;
  sshAuthentication?: SshCredentialAuthentication;
  sshHostKey?: SshHostKey;
  apiAuthentication?: ApiCredentialAuthentication;
  apiHeaderName?: string;
  agentAccess?: CredentialAgentAccess;
  projectIds: string[];
  source: CredentialSource;
  createdAt: string;
  updatedAt: string;
};

export type CredentialMetadataInput = {
  label: string;
  kind: CredentialKind;
  service?: string;
  username?: string;
  endpoint?: string;
  sshAuthentication?: SshCredentialAuthentication;
  sshHostKey?: SshHostKey;
  apiAuthentication?: ApiCredentialAuthentication;
  apiHeaderName?: string;
  agentAccess?: CredentialAgentAccess;
  projectIds: readonly string[];
};

export type CreateCredentialInput = CredentialMetadataInput & {
  source: CredentialSource;
  secret: CredentialSecret;
};

export type UpdateCredentialInput = CredentialMetadataInput & {
  secret?: CredentialSecret;
};

export interface CredentialVaultPort {
  list(): Promise<CredentialVaultItem[]>;
  create(input: CreateCredentialInput): Promise<CredentialVaultItem>;
  update(
    credentialId: string,
    input: UpdateCredentialInput,
  ): Promise<CredentialVaultItem>;
  remove(credentialId: string): Promise<void>;
  readForProject(
    credentialId: string,
    projectId: string,
  ): Promise<{ item: CredentialVaultItem; secret: CredentialSecret }>;
}

/** Host-only access for credentials that can never enter model context. */
export interface InternalCredentialVaultPort extends CredentialVaultPort {
  readInternal(
    credentialId: string,
  ): Promise<{ item: CredentialVaultItem; secret: CredentialSecret }>;
}

export type PendingCredentialAccess = {
  requestId: string;
  credentialId: string;
  credentialLabel: string;
  credentialKind: CredentialKind;
  credentialSshAuthentication?: SshCredentialAuthentication;
  credentialApiAuthentication?: ApiCredentialAuthentication;
  projectId: string;
  projectName: string;
  conversationId: string;
  purpose: string;
  requestedAt: string;
};

export type AgentCredentialAccessDecision =
  | { approved: false }
  | {
      approved: true;
      item: CredentialVaultItem;
      secret: CredentialSecret;
    };

export interface AgentCredentialAccessPort {
  listAuthorized(projectId: string): Promise<CredentialVaultItem[]>;
  requestAccess(
    input: {
      credentialId: string;
      projectId: string;
      projectName: string;
      conversationId: string;
      purpose: string;
    },
    signal?: AbortSignal,
  ): Promise<AgentCredentialAccessDecision>;
}
