import type { Project } from "../../domain/models.ts";

export type SshHostKey = {
  algorithm: string;
  fingerprint: string;
};

export type SshCredentials =
  | { kind: "password"; password: string }
  | {
      kind: "private-key";
      privateKey: string;
      publicKey?: string;
      passphrase?: string;
    };

export type SshEndpointInput = {
  host: string;
  port: number;
};

export type ConnectSshCommandInput = SshEndpointInput & {
  alias: string;
  username: string;
  /** Existing credentials may retain an explicit start directory; otherwise use the login directory. */
  root?: string;
  expectedHostKey: SshHostKey;
  credentialId: string;
  persistProfile: boolean;
};

export type TestSshCommandInput = SshEndpointInput & {
  username: string;
  expectedHostKey: SshHostKey;
} & (
    | {
        credentials: SshCredentials;
        credentialId?: never;
        projectId?: never;
      }
    | {
        credentials?: never;
        credentialId: string;
        projectId: string;
      }
  );

export type SshConnectionTestResult = {
  account: string;
  root: string;
  verification: string;
};

export type SshConnectionTestErrorCode =
  | "authentication_failed"
  | "host_key_failed"
  | "timeout"
  | "unavailable"
  | "unknown";

export class SshConnectionTestError extends Error {
  constructor(readonly code: SshConnectionTestErrorCode) {
    super(`SSH connection test failed (${code}).`);
    this.name = "SshConnectionTestError";
  }
}

export type SshCommandSession = {
  profileId: string;
  credentialId: string;
  projectId: string;
  alias: string;
  sessionId: string;
  root: string;
  account: string;
  access: "persistent" | "session";
  verification: string;
};

export interface SshCommandSessionService {
  load(projects: readonly Project[]): Promise<SshCommandSession[]>;
  probeHostKey(input: SshEndpointInput): Promise<SshHostKey>;
  testConnection(input: TestSshCommandInput): Promise<SshConnectionTestResult>;
  connect(
    project: Project,
    input: ConnectSshCommandInput,
  ): Promise<SshCommandSession>;
  activeForProject(projectId: string): readonly SshCommandSession[];
  invalidateCredential(
    credentialId: string,
    removeProfiles: boolean,
  ): Promise<void>;
  disconnectAll(): Promise<void>;
}

/** Resolves and authenticates an authorized SSH vault entry when `sshpass` is invoked. */
export interface AgentSshCredentialConnectionPort {
  connect(
    project: Project,
    credentialId: string,
    signal?: AbortSignal,
  ): Promise<SshCommandSession>;
}
