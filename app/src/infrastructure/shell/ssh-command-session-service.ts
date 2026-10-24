import { SshConnectionTestError } from "../../application/ports/ssh-command-sessions.ts";
import type {
  ConnectSshCommandInput,
  SshCredentials,
  SshCommandSession,
  SshCommandSessionService,
  SshConnectionTestResult,
  SshHostKey,
  TestSshCommandInput,
} from "../../application/ports/ssh-command-sessions.ts";
import type {
  CredentialSecret,
  CredentialVaultPort,
} from "../../application/ports/credential-vault.ts";
import type { Project } from "../../domain/models.ts";
import {
  normalizeRemoteRoot,
  normalizeSshCommandAlias,
} from "./ssh-command-path.ts";
import {
  SshCommandProfileVault,
  type PersistedSshCommandProfile,
} from "./ssh-command-credential-vault.ts";

type NativeSshConnectionBase = {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  expectedFingerprint: string;
};

export interface NativeSshCommandClient {
  readonly isAvailable: boolean;
  probeHostKey(host: string, port: number): Promise<SshHostKey>;
  connectWithPassword(
    input: NativeSshConnectionBase & { password: string },
  ): Promise<SshHostKey>;
  connectWithKey(
    input: NativeSshConnectionBase & {
      privateKey: string;
      publicKey?: string;
      passphrase?: string;
    },
  ): Promise<SshHostKey>;
  resolveLoginDirectory(sessionId: string): Promise<string>;
  disconnect(sessionId: string): Promise<void>;
  disconnectAll(): Promise<void>;
}

type SshConnectionProfile = Omit<PersistedSshCommandProfile, "root"> & {
  root?: string;
};

export class SshCommandSessionManager implements SshCommandSessionService {
  readonly #native: NativeSshCommandClient;
  readonly #profileVault: SshCommandProfileVault;
  readonly #credentialVault: CredentialVaultPort;
  readonly #createSessionId: () => string;
  readonly #profileId: (projectId: string, alias: string) => Promise<string>;
  readonly #sessions = new Map<string, SshCommandSession>();
  readonly #blockedAutomaticProfiles = new Set<string>();
  #operationQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    native: NativeSshCommandClient;
    profileVault: SshCommandProfileVault;
    credentialVault: CredentialVaultPort;
    createSessionId: () => string;
    profileId: (projectId: string, alias: string) => Promise<string>;
  }) {
    this.#native = options.native;
    this.#profileVault = options.profileVault;
    this.#credentialVault = options.credentialVault;
    this.#createSessionId = options.createSessionId;
    this.#profileId = options.profileId;
  }

  load(projects: readonly Project[]) {
    return this.#enqueue(() => this.#load(projects));
  }

  async #load(projects: readonly Project[]) {
    const records = await this.#profileVault.list();
    const sessions: SshCommandSession[] = [];
    for (const record of records) {
      const project = projects.find((item) => item.id === record.projectId);
      if (!project) {
        await this.#disconnectProfile(record.profileId);
        await this.#profileVault.remove(record.profileId);
        continue;
      }
      if (this.#blockedAutomaticProfiles.has(record.profileId)) {
        await this.#disconnectProfile(record.profileId);
        continue;
      }
      try {
        const expectedId = await this.#profileId(project.id, record.alias);
        if (expectedId !== record.profileId) {
          throw new Error("SSH command profile identity changed.");
        }
        const probed = await this.#native.probeHostKey(
          record.host,
          record.port,
        );
        if (!sameHostKey(probed, record.expectedHostKey)) {
          throw new Error("SSH host key changed.");
        }
        const candidate = await this.#establish(project, record, "persistent");
        await this.#activate(candidate);
        sessions.push(candidate);
      } catch {
        this.#blockedAutomaticProfiles.add(record.profileId);
        await this.#disconnectProfile(record.profileId);
      }
    }
    return sessions;
  }

  probeHostKey(input: { host: string; port: number }) {
    return this.#native.probeHostKey(input.host, input.port);
  }

  testConnection(input: TestSshCommandInput) {
    return this.#enqueue(() => this.#testConnection(input));
  }

  async #testConnection(
    input: TestSshCommandInput,
  ): Promise<SshConnectionTestResult> {
    const username = input.username.trim();
    if (
      !username ||
      username.length > 160 ||
      /[\u0000-\u001f\u007f]/u.test(username)
    ) {
      throw new Error("SSH 用户名无效。");
    }
    const credentials = input.credentials
      ? input.credentials
      : sshCredentialsFor(
          (
            await this.#credentialVault.readForProject(
              input.credentialId,
              input.projectId,
            )
          ).secret,
        );
    const sessionId = this.#createSessionId();
    try {
      const base = {
        sessionId,
        host: input.host,
        port: input.port,
        username,
        expectedFingerprint: input.expectedHostKey.fingerprint,
      };
      const connectedHostKey =
        credentials.kind === "password"
          ? await this.#native.connectWithPassword({
              ...base,
              password: credentials.password,
            })
          : await this.#native.connectWithKey({
              ...base,
              privateKey: credentials.privateKey,
              ...(credentials.publicKey
                ? { publicKey: credentials.publicKey }
                : {}),
              ...(credentials.passphrase
                ? { passphrase: credentials.passphrase }
                : {}),
            });
      if (!sameHostKey(connectedHostKey, input.expectedHostKey)) {
        throw new Error("SSH 主机指纹在确认后发生变化，连接测试已阻止。");
      }
      const root = await this.#resolveLoginDirectory(sessionId);
      return {
        account: `${username}@${input.host}:${input.port}`,
        root,
        verification: `${connectedHostKey.algorithm} ${connectedHostKey.fingerprint}`,
      };
    } catch (error) {
      throw normalizeSshConnectionTestError(error);
    } finally {
      await this.#native.disconnect(sessionId).catch(() => undefined);
    }
  }

  connect(project: Project, input: ConnectSshCommandInput) {
    return this.#enqueue(() => this.#connect(project, input));
  }

  async #connect(project: Project, input: ConnectSshCommandInput) {
    const alias = normalizeSshCommandAlias(input.alias);
    const profileId = await this.#profileId(project.id, alias);
    const connection: SshConnectionProfile = {
      version: 3,
      profileId,
      projectId: project.id,
      alias,
      host: input.host,
      port: input.port,
      username: input.username,
      ...(input.root ? { root: normalizeRemoteRoot(input.root) } : {}),
      expectedHostKey: { ...input.expectedHostKey },
      credentialId: input.credentialId,
    };
    const candidate = await this.#establish(
      project,
      connection,
      input.persistProfile ? "persistent" : "session",
    );
    const record: PersistedSshCommandProfile = {
      ...connection,
      root: candidate.root,
    };
    try {
      if (input.persistProfile) await this.#profileVault.save(record);
      else await this.#profileVault.remove(profileId);
    } catch (error) {
      await this.#native.disconnect(candidate.sessionId).catch(() => undefined);
      throw error;
    }
    await this.#activate(candidate);
    this.#blockedAutomaticProfiles.delete(profileId);
    return candidate;
  }

  activeForProject(projectId: string) {
    return Object.freeze(
      [...this.#sessions.values()].filter(
        (session) => session.projectId === projectId,
      ),
    );
  }

  invalidateCredential(credentialId: string, removeProfiles: boolean) {
    return this.#enqueue(async () => {
      const profileIds = new Set<string>();
      for (const session of this.#sessions.values()) {
        if (session.credentialId === credentialId)
          profileIds.add(session.profileId);
      }
      for (const profileId of profileIds) {
        await this.#disconnectProfile(profileId);
      }
      const records = await this.#profileVault.list();
      for (const record of records) {
        if (record.credentialId === credentialId)
          profileIds.add(record.profileId);
      }
      for (const profileId of profileIds) {
        await this.#disconnectProfile(profileId);
        if (removeProfiles) {
          await this.#profileVault.remove(profileId);
          this.#blockedAutomaticProfiles.delete(profileId);
        } else {
          this.#blockedAutomaticProfiles.add(profileId);
        }
      }
    });
  }

  disconnectAll() {
    return this.#enqueue(async () => {
      this.#sessions.clear();
      if (this.#native.isAvailable) await this.#native.disconnectAll();
    });
  }

  async #establish(
    project: Project,
    record: SshConnectionProfile,
    access: "persistent" | "session",
  ): Promise<SshCommandSession> {
    const sessionId = this.#createSessionId();
    try {
      const base = {
        sessionId,
        host: record.host,
        port: record.port,
        username: record.username,
        expectedFingerprint: record.expectedHostKey.fingerprint,
      };
      const resolved = await this.#credentialVault.readForProject(
        record.credentialId,
        project.id,
      );
      const credentials = sshCredentialsFor(resolved.secret);
      const connectedHostKey =
        credentials.kind === "password"
          ? await this.#native.connectWithPassword({
              ...base,
              password: credentials.password,
            })
          : await this.#native.connectWithKey({
              ...base,
              privateKey: credentials.privateKey,
              ...(credentials.publicKey
                ? { publicKey: credentials.publicKey }
                : {}),
              ...(credentials.passphrase
                ? { passphrase: credentials.passphrase }
                : {}),
            });
      if (!sameHostKey(connectedHostKey, record.expectedHostKey)) {
        throw new Error("SSH 主机指纹在确认后发生变化，命令会话已阻止。");
      }
      const root =
        record.root ?? (await this.#resolveLoginDirectory(sessionId));
      return {
        profileId: record.profileId,
        credentialId: record.credentialId,
        projectId: project.id,
        alias: record.alias,
        sessionId,
        root,
        account: `${record.username}@${record.host}:${record.port}`,
        access,
        verification: `${connectedHostKey.algorithm} ${connectedHostKey.fingerprint}`,
      };
    } catch (error) {
      await this.#native.disconnect(sessionId).catch(() => undefined);
      throw error;
    }
  }

  async #resolveLoginDirectory(sessionId: string) {
    let output: string;
    try {
      output = await this.#native.resolveLoginDirectory(sessionId);
    } catch {
      throw new Error("无法确定 SSH 登录目录。");
    }
    try {
      const root = normalizeRemoteRoot(output);
      if (root !== output) throw new Error("invalid login directory");
      return root;
    } catch {
      throw new Error("无法确定 SSH 登录目录。");
    }
  }

  async #activate(candidate: SshCommandSession) {
    const previous = this.#sessions.get(candidate.profileId);
    this.#sessions.set(candidate.profileId, candidate);
    if (previous && previous.sessionId !== candidate.sessionId) {
      await this.#native.disconnect(previous.sessionId).catch(() => undefined);
    }
  }

  async #disconnectProfile(profileId: string) {
    const session = this.#sessions.get(profileId);
    this.#sessions.delete(profileId);
    if (session) {
      await this.#native.disconnect(session.sessionId).catch(() => undefined);
    }
  }

  #enqueue<T>(operation: () => Promise<T>) {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function sshCredentialsFor(secret: CredentialSecret): SshCredentials {
  if (secret.kind === "password") {
    return { kind: "password", password: secret.password };
  }
  if (secret.kind !== "ssh") {
    throw new Error("所选密码本记录不能用于 SSH 认证。");
  }
  if (secret.authentication === "password") {
    return { kind: "password", password: secret.password };
  }
  return {
    kind: "private-key",
    privateKey: secret.privateKey,
    ...(secret.publicKey ? { publicKey: secret.publicKey } : {}),
    ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
  };
}

function sameHostKey(left: SshHostKey, right: SshHostKey) {
  return (
    left.algorithm === right.algorithm && left.fingerprint === right.fingerprint
  );
}

function normalizeSshConnectionTestError(error: unknown) {
  if (error instanceof SshConnectionTestError) return error;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("authentication") ||
    message.includes("authenticate") ||
    message.includes("permission denied") ||
    message.includes("not authorized")
  ) {
    return new SshConnectionTestError("authentication_failed");
  }
  if (message.includes("host-key") || message.includes("fingerprint")) {
    return new SshConnectionTestError("host_key_failed");
  }
  if (message.includes("timed out") || message.includes("timeout")) {
    return new SshConnectionTestError("timeout");
  }
  if (
    message.includes("connection") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("unavailable") ||
    message.includes("not available") ||
    message.includes("refused") ||
    message.includes("unreachable")
  ) {
    return new SshConnectionTestError("unavailable");
  }
  return new SshConnectionTestError("unknown");
}
