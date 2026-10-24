import type {
  SshProjectShellDiagnosticResult,
  SshProjectShellEntry,
  SshProjectShellExecuteOptions,
  SshProjectShellTransport,
} from "./ssh-project-shell-commands.ts";

export type BoltPocketSshNativeModulePort = {
  readonly isAvailable: boolean;
  execute(
    sessionId: string,
    command: string,
    options: SshProjectShellExecuteOptions,
  ): Promise<unknown>;
  list(sessionId: string, path: string): Promise<unknown>;
  stat(sessionId: string, path: string): Promise<unknown>;
  readText(sessionId: string, path: string, maxBytes: number): Promise<unknown>;
};

export type SshProjectShellNativeOperation =
  "load" | "execute" | "diagnose" | "stat" | "list" | "read";

export type SshProjectShellNativeErrorCode =
  | "unavailable"
  | "session_unavailable"
  | "timeout"
  | "permission_denied"
  | "not_found"
  | "invalid_request"
  | "invalid_response"
  | "io_error";

/** Stable, redacted error surfaced across the native-module boundary. */
export class SshProjectShellNativeTransportError extends Error {
  constructor(
    readonly code: SshProjectShellNativeErrorCode,
    readonly operation: SshProjectShellNativeOperation,
  ) {
    super(`Native SSH ${operation} failed (${code}).`);
    this.name = "SshProjectShellNativeTransportError";
  }
}

const MAX_DIAGNOSTIC_BYTES = 512_000;
const DIAGNOSTIC_TIMEOUT_MS = 30_000;
const MAX_COMMAND_BYTES = 64_000;
const MAX_EXEC_BYTES = 1_000_000;
const MAX_EXEC_TIMEOUT_MS = 60_000;

/** Fixed, read-only Linux health check. No Agent-provided text enters it. */
const READ_ONLY_SERVER_DIAGNOSTIC = [
  "LC_ALL=C; export LC_ALL",
  "printf '\\n=== identity_and_os ===\\n'",
  "printf 'time_utc='; date -u '+%Y-%m-%dT%H:%M:%SZ' 2>&1 || :",
  "printf 'hostname='; hostname 2>&1 || :",
  "uname -a 2>&1 || :",
  "if [ -r /etc/os-release ]; then sed -n '1,40p' /etc/os-release 2>&1; else printf '%s\\n' 'os-release unavailable'; fi",
  "printf '\\n=== cpu_load_uptime ===\\n'",
  "printf 'logical_cpus='; getconf _NPROCESSORS_ONLN 2>&1 || :",
  "uptime 2>&1 || :",
  "if [ -r /proc/loadavg ]; then printf 'loadavg='; cat /proc/loadavg 2>&1; fi",
  "printf '\\n=== memory_and_swap ===\\n'",
  "if command -v free >/dev/null 2>&1; then free -h 2>&1; elif [ -r /proc/meminfo ]; then sed -n '1,30p' /proc/meminfo 2>&1; else printf '%s\\n' 'memory information unavailable'; fi",
  "printf '\\n=== filesystems ===\\n'",
  "df -hP 2>&1 || :",
  "printf '\\n=== filesystem_inodes ===\\n'",
  "df -iP 2>&1 || :",
  "printf '\\n=== top_processes ===\\n'",
  "printf '%s\\n' 'PID PPID USER STAT %CPU %MEM COMMAND'",
  "ps -eo pid=,ppid=,user=,stat=,pcpu=,pmem=,comm= 2>&1 | sed -n '1,50p'",
  "printf '\\n=== network_addresses ===\\n'",
  "if command -v ip >/dev/null 2>&1; then ip -brief address 2>&1; else printf '%s\\n' 'ip command unavailable'; fi",
  "printf '\\n=== listening_ports ===\\n'",
  "if command -v ss >/dev/null 2>&1; then ss -tulpn 2>&1 | sed -n '1,100p'; elif command -v netstat >/dev/null 2>&1; then netstat -tulpn 2>&1 | sed -n '1,100p'; else printf '%s\\n' 'socket inspection unavailable'; fi",
  "printf '\\n=== failed_services ===\\n'",
  "if command -v systemctl >/dev/null 2>&1; then systemctl is-system-running 2>&1 || :; systemctl --failed --no-pager --plain 2>&1 || :; else printf '%s\\n' 'systemd unavailable'; fi",
  "printf '\\n=== recent_error_journal ===\\n'",
  "if command -v journalctl >/dev/null 2>&1; then journalctl --priority=0..3 --boot --no-pager --lines=80 --output=short-iso 2>&1 || :; else printf '%s\\n' 'journalctl unavailable'; fi",
  "exit 0",
].join("\n");

/**
 * Loads the real Expo native module lazily so fake-module unit tests do not
 * initialize React Native. Supplying a module is useful for deterministic
 * tests and platform wrappers.
 */
export async function createBoltPocketSshProjectShellTransport(
  nativeModule?: BoltPocketSshNativeModulePort,
): Promise<SshProjectShellTransport> {
  if (nativeModule) return adaptBoltPocketSshNativeModule(nativeModule);
  try {
    const { BoltPocketSsh } = await import("@boltpocket/expo-ssh");
    return adaptBoltPocketSshNativeModule(BoltPocketSsh);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw normalizeNativeError("load", error);
  }
}

/** Maps the repository Expo SSH module onto the ProjectShell transport port. */
export function adaptBoltPocketSshNativeModule(
  nativeModule: BoltPocketSshNativeModulePort,
): SshProjectShellTransport {
  if (!nativeModule || typeof nativeModule !== "object") {
    throw new TypeError("An BoltPocketSsh native module is required");
  }

  const transport: SshProjectShellTransport = {
    async execute(sessionId, command, options, signal) {
      validateSessionId("execute", sessionId);
      if (
        typeof command !== "string" ||
        command.trim() === "" ||
        command.includes("\0") ||
        utf8ByteLength(command) > MAX_COMMAND_BYTES
      ) {
        throw transportError("invalid_request", "execute");
      }
      if (!options || typeof options !== "object") {
        throw transportError("invalid_request", "execute");
      }
      validateInteger("execute", options.maxOutputBytes, 1, MAX_EXEC_BYTES);
      validateInteger("execute", options.timeoutMs, 1_000, MAX_EXEC_TIMEOUT_MS);
      if (
        options.stdin !== undefined &&
        (typeof options.stdin !== "string" ||
          utf8ByteLength(options.stdin) > MAX_EXEC_BYTES)
      ) {
        throw transportError("invalid_request", "execute");
      }
      return invokeNativeRead(
        nativeModule,
        "execute",
        signal,
        () => nativeModule.execute(sessionId, command, options),
        (value) => validateNativeExecResult(value, options.maxOutputBytes),
      );
    },

    async diagnose(sessionId, signal) {
      validateSessionId("diagnose", sessionId);
      return invokeNativeRead(
        nativeModule,
        "diagnose",
        signal,
        () =>
          nativeModule.execute(sessionId, READ_ONLY_SERVER_DIAGNOSTIC, {
            maxOutputBytes: MAX_DIAGNOSTIC_BYTES,
            timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
          }),
        (value) => validateNativeExecResult(value, MAX_DIAGNOSTIC_BYTES),
      );
    },

    async stat(sessionId, path, signal) {
      validateSessionAndPath("stat", sessionId, path);
      return invokeNativeRead(
        nativeModule,
        "stat",
        signal,
        () => nativeModule.stat(sessionId, path),
        (value) => (value === null ? null : validateNativeEntry(value)),
      );
    },

    async list(sessionId, path, signal) {
      validateSessionAndPath("list", sessionId, path);
      return invokeNativeRead(
        nativeModule,
        "list",
        signal,
        () => nativeModule.list(sessionId, path),
        validateNativeEntries,
      );
    },

    async readText(sessionId, path, maxBytes, signal) {
      validateSessionAndPath("read", sessionId, path);
      validateInteger("read", maxBytes, 1, 1_000_000);
      return invokeNativeRead(
        nativeModule,
        "read",
        signal,
        () => nativeModule.readText(sessionId, path, maxBytes),
        (value) => {
          if (typeof value !== "string" || utf8ByteLength(value) > maxBytes) {
            throw new InvalidNativeResponseError();
          }
          return value;
        },
      );
    },
  };
  return Object.freeze(transport);
}

async function invokeNativeRead<T>(
  nativeModule: BoltPocketSshNativeModulePort,
  operation: Extract<
    SshProjectShellNativeOperation,
    "execute" | "diagnose" | "stat" | "list" | "read"
  >,
  signal: AbortSignal | undefined,
  invoke: () => Promise<unknown>,
  validate: (value: unknown) => T,
): Promise<T> {
  throwIfAborted(signal);
  ensureAvailable(nativeModule, operation);
  try {
    const value = await invoke();
    throwIfAborted(signal);
    return validate(value);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw normalizeNativeError(operation, error);
  }
}

function validateNativeExecResult(
  value: unknown,
  maxOutputBytes: number,
): SshProjectShellDiagnosticResult {
  if (!isRecord(value)) throw new InvalidNativeResponseError();
  const { stdout, stderr, exitCode } = value;
  if (
    typeof stdout !== "string" ||
    typeof stderr !== "string" ||
    stdout.includes("\0") ||
    stderr.includes("\0") ||
    utf8ByteLength(stdout) + utf8ByteLength(stderr) > maxOutputBytes ||
    !Number.isSafeInteger(exitCode) ||
    (exitCode as number) < -1 ||
    (exitCode as number) > 255
  ) {
    throw new InvalidNativeResponseError();
  }
  return { stdout, stderr, exitCode: exitCode as number };
}

function validateNativeEntries(
  value: unknown,
): readonly SshProjectShellEntry[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new InvalidNativeResponseError();
  }
  return value.map(validateNativeEntry);
}

function validateNativeEntry(value: unknown): SshProjectShellEntry {
  if (!isRecord(value)) throw new InvalidNativeResponseError();
  const { path, name, type, size, mode } = value;
  if (
    typeof path !== "string" ||
    !isSafeAbsoluteRemotePath(path) ||
    typeof name !== "string" ||
    !isSafeRemoteEntryName(path, name) ||
    (type !== "file" &&
      type !== "directory" &&
      type !== "symlink" &&
      type !== "other") ||
    !Number.isSafeInteger(size) ||
    (size as number) < 0 ||
    (mode !== undefined &&
      (!Number.isSafeInteger(mode) || (mode as number) < 0))
  ) {
    throw new InvalidNativeResponseError();
  }
  return {
    path,
    name,
    type,
    size: size as number,
    ...(mode === undefined ? {} : { mode: mode as number }),
  };
}

function isSafeRemoteEntryName(path: string, name: string) {
  if (path === "/") return name === "/";
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !/[\u0000-\u001f\u007f/\\]/u.test(name)
  );
}

function validateSessionAndPath(
  operation: SshProjectShellNativeOperation,
  sessionId: string,
  path: string,
): void {
  validateSessionId(operation, sessionId);
  if (!isSafeAbsoluteRemotePath(path)) {
    throw transportError("invalid_request", operation);
  }
}

function validateSessionId(
  operation: SshProjectShellNativeOperation,
  sessionId: string,
): void {
  if (
    typeof sessionId !== "string" ||
    sessionId.trim() === "" ||
    /[\u0000-\u001f\u007f]/u.test(sessionId)
  ) {
    throw transportError("invalid_request", operation);
  }
}

function validateInteger(
  operation: SshProjectShellNativeOperation,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw transportError("invalid_request", operation);
  }
}

function isSafeAbsoluteRemotePath(path: string): boolean {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.includes("//")
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "." && segment !== "..");
}

function ensureAvailable(
  nativeModule: BoltPocketSshNativeModulePort,
  operation: SshProjectShellNativeOperation,
): void {
  if (!nativeModule.isAvailable) throw transportError("unavailable", operation);
}

function normalizeNativeError(
  operation: SshProjectShellNativeOperation,
  error: unknown,
): SshProjectShellNativeTransportError {
  if (error instanceof SshProjectShellNativeTransportError) return error;
  if (error instanceof InvalidNativeResponseError) {
    return transportError("invalid_response", operation);
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not available") || message.includes("unavailable")) {
    return transportError("unavailable", operation);
  }
  if (
    message.includes("session") &&
    (message.includes("not connected") ||
      message.includes("not found") ||
      message.includes("expired"))
  ) {
    return transportError("session_unavailable", operation);
  }
  if (message.includes("timed out") || message.includes("timeout")) {
    return transportError("timeout", operation);
  }
  if (
    message.includes("permission") ||
    message.includes("denied") ||
    message.includes("authentication") ||
    message.includes("authorized")
  ) {
    return transportError("permission_denied", operation);
  }
  if (
    message.includes("no such") ||
    message.includes("not found") ||
    message.includes("missing")
  ) {
    return transportError("not_found", operation);
  }
  return transportError("io_error", operation);
}

function transportError(
  code: SshProjectShellNativeErrorCode,
  operation: SshProjectShellNativeOperation,
): SshProjectShellNativeTransportError {
  return new SshProjectShellNativeTransportError(code, operation);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  }
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0xfffd;
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }
  return length;
}

class InvalidNativeResponseError extends Error {}
