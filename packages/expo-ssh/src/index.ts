import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeSftpEntry = {
  path: string;
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: number;
};

export type NativeSshHostKey = {
  algorithm: string;
  fingerprint: string;
};

export type NativeSshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type NativeSshConnectionBase = {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  expectedFingerprint: string;
  timeoutMs?: number;
};

export type NativeSshPasswordConnection = NativeSshConnectionBase & {
  password: string;
};

export type NativeSshKeyConnection = NativeSshConnectionBase & {
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
};

type NativeBoltPocketSshModule = {
  probeHostKey(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<NativeSshHostKey>;
  connectWithPassword(
    input: NativeSshPasswordConnection,
  ): Promise<NativeSshHostKey>;
  connectWithKey(input: NativeSshKeyConnection): Promise<NativeSshHostKey>;
  disconnect(sessionId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  list(sessionId: string, path: string): Promise<NativeSftpEntry[]>;
  stat(sessionId: string, path: string): Promise<NativeSftpEntry | null>;
  readText(sessionId: string, path: string, maxBytes: number): Promise<string>;
  execute(
    sessionId: string,
    command: string,
    stdin: string | null,
    maxOutputBytes: number,
    timeoutMs: number,
  ): Promise<NativeSshExecResult>;
  writeText(sessionId: string, path: string, text: string): Promise<void>;
  makeDirectory(sessionId: string, path: string): Promise<void>;
  rename(sessionId: string, from: string, to: string): Promise<void>;
  remove(sessionId: string, path: string): Promise<void>;
  setMode(sessionId: string, path: string, mode: number): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<NativeBoltPocketSshModule>("BoltPocketSsh");

function requiredModule(): NativeBoltPocketSshModule {
  if (!nativeModule) {
    throw new Error(
      "SSH/SFTP native transport is not available on this platform build.",
    );
  }
  return nativeModule;
}

export const BoltPocketSsh = {
  isAvailable: Boolean(nativeModule),
  probeHostKey(host: string, port = 22, timeoutMs = 10_000) {
    return requiredModule().probeHostKey(host, port, timeoutMs);
  },
  connectWithPassword(input: NativeSshPasswordConnection) {
    return requiredModule().connectWithPassword(input);
  },
  connectWithKey(input: NativeSshKeyConnection) {
    return requiredModule().connectWithKey(input);
  },
  disconnect(sessionId: string) {
    return requiredModule().disconnect(sessionId);
  },
  disconnectAll() {
    return requiredModule().disconnectAll();
  },
  list(sessionId: string, path: string) {
    return requiredModule().list(sessionId, path);
  },
  stat(sessionId: string, path: string) {
    return requiredModule().stat(sessionId, path);
  },
  readText(sessionId: string, path: string, maxBytes: number) {
    return requiredModule().readText(sessionId, path, maxBytes);
  },
  async resolveLoginDirectory(sessionId: string) {
    const result = await requiredModule().execute(
      sessionId,
      "pwd",
      null,
      4_096,
      10_000,
    );
    let output = result.stdout;
    if (output.endsWith("\n")) output = output.slice(0, -1);
    if (output.endsWith("\r")) output = output.slice(0, -1);
    if (
      result.exitCode !== 0 ||
      result.stderr.trim() ||
      !output ||
      output.includes("\n") ||
      output.includes("\r")
    ) {
      throw new Error("Could not determine the SSH login directory.");
    }
    return output;
  },
  execute(
    sessionId: string,
    command: string,
    options: {
      stdin?: string;
      maxOutputBytes?: number;
      timeoutMs?: number;
    } = {},
  ) {
    return requiredModule().execute(
      sessionId,
      command,
      options.stdin ?? null,
      options.maxOutputBytes ?? 1_000_000,
      options.timeoutMs ?? 30_000,
    );
  },
  writeText(sessionId: string, path: string, text: string) {
    return requiredModule().writeText(sessionId, path, text);
  },
  makeDirectory(sessionId: string, path: string) {
    return requiredModule().makeDirectory(sessionId, path);
  },
  rename(sessionId: string, from: string, to: string) {
    return requiredModule().rename(sessionId, from, to);
  },
  remove(sessionId: string, path: string) {
    return requiredModule().remove(sessionId, path);
  },
  setMode(sessionId: string, path: string, mode: number) {
    return requiredModule().setMode(sessionId, path, mode);
  },
};
