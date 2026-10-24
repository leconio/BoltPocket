import type {
  ProjectShellCommand,
  ProjectShellCommandContext,
  ProjectShellCommandResult,
  ProjectShellFileSystem,
} from "@boltpocket/project-shell";

import type { SshCommandSession } from "../../application/ports/ssh-command-sessions.ts";
import type { WorkspaceResource } from "../../domain/models.ts";
import {
  joinRemotePath,
  normalizeRemoteRoot,
  requireRemotePath,
} from "./ssh-command-path.ts";

export type SshProjectShellEntryType =
  "file" | "directory" | "symlink" | "other";

export type SshProjectShellEntry = {
  path: string;
  name: string;
  type: SshProjectShellEntryType;
  size: number;
  mode?: number;
};

export type SshProjectShellDiagnosticResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SshProjectShellExecuteOptions = {
  stdin?: string;
  maxOutputBytes: number;
  timeoutMs: number;
};

/** Native SSH capability used by the project-scoped just-bash clients. */
export interface SshProjectShellTransport {
  /** Executes one non-interactive command with the authenticated account. */
  execute(
    sessionId: string,
    command: string,
    options: SshProjectShellExecuteOptions,
    signal?: AbortSignal,
  ): Promise<SshProjectShellDiagnosticResult>;
  /** Runs the repository-owned, fixed server health-check program. */
  diagnose(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SshProjectShellDiagnosticResult>;
  stat(
    sessionId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SshProjectShellEntry | null>;
  list(
    sessionId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly SshProjectShellEntry[]>;
  readText(
    sessionId: string,
    path: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<string>;
}

export type SshProjectShellCommandOptions = {
  sessions: readonly SshCommandSession[];
  resources?: readonly WorkspaceResource[];
  transport: SshProjectShellTransport;
  /** Maps a selected project resource to its ProjectShell snapshot path. */
  localPathForResource?: (resource: WorkspaceResource) => string;
  /** Virtual ProjectShell root. Defaults to `/project`. */
  localRoot?: string;
  maxTextBytes?: number;
  maxListEntries?: number;
};

type SessionScope = {
  alias: string;
  sessionId: string;
  root: string;
};

type ValidatedOptions = {
  scopes: ReadonlyMap<string, SessionScope>;
  localTargets: ReadonlySet<string>;
  transport: SshProjectShellTransport;
  localRoot: string;
  maxTextBytes: number;
  maxListEntries: number;
};

type CommandImplementation = (
  context: ProjectShellCommandContext,
) => Promise<ProjectShellCommandResult>;

const DEFAULT_MAX_TEXT_BYTES = 100_000;
const DEFAULT_MAX_LIST_ENTRIES = 2_000;
const MAX_NATIVE_TEXT_BYTES = 1_000_000;
const MAX_REMOTE_COMMAND_BYTES = 64_000;
const MAX_REMOTE_STDIN_BYTES = 1_000_000;
const REMOTE_COMMAND_MAX_OUTPUT_BYTES = 1_000_000;
const REMOTE_COMMAND_TIMEOUT_MS = 60_000;

export function createSshProjectShellCommands(
  options: SshProjectShellCommandOptions,
): Readonly<Record<"ssh" | "scp" | "sftp", ProjectShellCommand>> {
  const validated = validateOptions(options);
  const ssh = guarded("ssh", (context) => runSsh(validated, context));
  const scp = guarded("scp", (context) => runScp(validated, context));
  const sftp = guarded("sftp", (context) => runSftp(validated, context));
  return Object.freeze({ ssh, scp, sftp });
}

function validateOptions(
  options: SshProjectShellCommandOptions,
): ValidatedOptions {
  if (!options || typeof options !== "object") {
    throw new TypeError("SSH ProjectShell commands require options");
  }
  if (!options.transport || typeof options.transport !== "object") {
    throw new TypeError("SSH ProjectShell commands require a transport");
  }
  const localRoot = normalizeLocalAbsolute(options.localRoot ?? "/project");
  if (localRoot === "/") {
    throw new TypeError("SSH ProjectShell localRoot must be narrower than /");
  }
  const maxTextBytes = boundedInteger(
    "maxTextBytes",
    options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES,
    MAX_NATIVE_TEXT_BYTES,
  );
  const maxListEntries = boundedInteger(
    "maxListEntries",
    options.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES,
    10_000,
  );
  const scopes = new Map<string, SessionScope>();
  let projectId: string | undefined;
  for (const session of options.sessions) {
    if (projectId === undefined) projectId = session.projectId;
    else if (projectId !== session.projectId) {
      throw new Error(
        "SSH command sessions must belong to one current project",
      );
    }
    if (
      session.alias.trim() === "" ||
      session.sessionId.trim() === "" ||
      /[\u0000-\u001f\u007f:]/u.test(session.alias) ||
      /[\u0000-\u001f\u007f]/u.test(session.sessionId)
    ) {
      throw new Error("SSH command session has an invalid alias or session ID");
    }
    if (scopes.has(session.alias)) {
      throw new Error("SSH command aliases must be unique inside one project");
    }
    scopes.set(session.alias, {
      alias: session.alias,
      sessionId: session.sessionId,
      root: normalizeRemoteRoot(session.root),
    });
  }
  const localTargets = new Set<string>();
  for (const resource of options.resources ?? []) {
    if (projectId !== undefined && resource.projectId !== projectId) {
      throw new Error(
        "SSH command resources must belong to the current project",
      );
    }
    if (!options.localPathForResource) continue;
    const localPath = normalizeLocalAbsolute(
      options.localPathForResource(resource),
    );
    requireWithinLocalRoot(localRoot, localPath);
    if (localPath === localRoot) {
      throw new Error("A project resource must map to an exact file");
    }
    localTargets.add(localPath);
  }
  return {
    scopes,
    localTargets,
    transport: options.transport,
    localRoot,
    maxTextBytes,
    maxListEntries,
  };
}

function boundedInteger(name: string, value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function guarded(
  name: string,
  implementation: CommandImplementation,
): ProjectShellCommand {
  return async (context) => {
    try {
      throwIfAborted(context.signal);
      return await implementation(context);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return commandFailure(name, safeErrorMessage(error));
    }
  };
}

async function runSsh(
  options: ValidatedOptions,
  context: ProjectShellCommandContext,
) {
  const alias = context.args[0];
  if (!alias || alias.startsWith("-")) return sshUsage();
  const scope = requireScope(options.scopes, alias);
  const commandArgs =
    context.args[1] === "--" ? context.args.slice(2) : context.args.slice(1);
  if (commandArgs.length === 0) return sshUsage();
  if (
    commandArgs.length === 1 &&
    commandArgs[0] === "diagnose" &&
    context.stdin === ""
  ) {
    return options.transport.diagnose(scope.sessionId, context.signal);
  }
  const command = serializeRemoteCommand(commandArgs);
  validateTextPayload("ssh command", command, MAX_REMOTE_COMMAND_BYTES);
  if (utf8ByteLength(context.stdin) > MAX_REMOTE_STDIN_BYTES) {
    throw new Error(`ssh stdin exceeds ${MAX_REMOTE_STDIN_BYTES} bytes`);
  }
  return options.transport.execute(
    scope.sessionId,
    command,
    {
      ...(context.stdin === "" ? {} : { stdin: context.stdin }),
      maxOutputBytes: REMOTE_COMMAND_MAX_OUTPUT_BYTES,
      timeoutMs: REMOTE_COMMAND_TIMEOUT_MS,
    },
    context.signal,
  );
}

function serializeRemoteCommand(args: readonly string[]) {
  if (args.length === 1) {
    const command = args[0]!.trim();
    if (command === "") throw new Error("remote command is required");
    return command;
  }
  return args.map(quoteRemoteArgument).join(" ");
}

function quoteRemoteArgument(argument: string) {
  if (argument === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'"'"'`)}'`;
}

async function runScp(
  options: ValidatedOptions,
  context: ProjectShellCommandContext,
) {
  const args = context.args[0] === "--" ? context.args.slice(1) : context.args;
  if (args.length !== 2 || args.some((argument) => argument.startsWith("-"))) {
    return usage("scp", "scp <alias>:<remote path> <existing project path>");
  }
  const sourceRemote = parseRemoteOperand(args[0]!);
  const destinationRemote = parseRemoteOperand(args[1]!);
  if (!sourceRemote || destinationRemote) {
    return commandFailure(
      "scp",
      "this structured scp form downloads into a project resource; use ssh with piped stdin for other remote file operations",
      126,
    );
  }
  const scope = requireScope(options.scopes, sourceRemote.alias);
  const remotePath = resolveRemotePath(scope, sourceRemote.path);
  const localPath = resolveLocalPath(options.localRoot, context.cwd, args[1]!);
  await requireAuthorizedLocalDestination(
    options,
    context.fileSystem,
    localPath,
    context.signal,
  );
  const contents = await readRemoteText(
    options,
    scope,
    remotePath,
    context.signal,
  );
  await context.fileSystem.writeFile(localPath, contents, context.signal);
  return commandSuccess(`${scope.alias}:${remotePath} -> ${localPath}\n`);
}

async function runSftp(
  options: ValidatedOptions,
  context: ProjectShellCommandContext,
) {
  const alias = context.args[0];
  const operation = context.args[1];
  if (!alias || alias.startsWith("-") || !operation) return sftpUsage();
  const scope = requireScope(options.scopes, alias);
  const args = context.args.slice(2);
  if (operation === "ls" || operation === "list") {
    if (args.length > 1) return sftpUsage();
    return listRemote(options, scope, args[0] ?? ".", context.signal);
  }
  if (operation === "cat") {
    if (args.length !== 1) return sftpUsage();
    return readRemote(options, scope, args[0]!, context.signal);
  }
  if (operation === "get") {
    if (args.length !== 2) return sftpUsage();
    return runScp(options, {
      ...context,
      args: [`${alias}:${args[0]!}`, args[1]!],
    });
  }
  if (
    operation === "write" ||
    operation === "put" ||
    operation === "rm" ||
    operation === "delete"
  ) {
    return commandFailure(
      "sftp",
      "this structured sftp form supports ls, cat, and get; use ssh for other remote file operations",
      126,
    );
  }
  return sftpUsage();
}

async function listRemote(
  options: ValidatedOptions,
  scope: SessionScope,
  input: string,
  signal?: AbortSignal,
) {
  const remotePath = resolveRemotePath(scope, input);
  await requireRemoteEntry(options, scope, remotePath, "directory", signal);
  const entries = await options.transport.list(
    scope.sessionId,
    remotePath,
    signal,
  );
  if (entries.length > options.maxListEntries) {
    return commandFailure("sftp", "directory entry limit exceeded");
  }
  const lines = entries.map((entry) => {
    validateDirectoryEntryName(entry.name);
    const path = resolveRemotePath(scope, `${remotePath}/${entry.name}`);
    const size =
      Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : 0;
    return `${entry.type}\t${size}\t${path}`;
  });
  lines.sort(compareStrings);
  return commandSuccess(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
}

async function readRemote(
  options: ValidatedOptions,
  scope: SessionScope,
  input: string,
  signal?: AbortSignal,
) {
  const remotePath = resolveRemotePath(scope, input);
  return commandSuccess(
    await readRemoteText(options, scope, remotePath, signal),
  );
}

async function readRemoteText(
  options: ValidatedOptions,
  scope: SessionScope,
  remotePath: string,
  signal?: AbortSignal,
) {
  await requireRemoteEntry(options, scope, remotePath, "file", signal);
  const contents = await options.transport.readText(
    scope.sessionId,
    remotePath,
    options.maxTextBytes,
    signal,
  );
  validateTextPayload("ssh", contents, options.maxTextBytes);
  return contents;
}

function requireScope(
  scopes: ReadonlyMap<string, SessionScope>,
  alias: string,
) {
  const scope = scopes.get(alias);
  if (!scope) {
    throw new Error(
      "SSH command profile is not available in the current project",
    );
  }
  return scope;
}

function parseRemoteOperand(operand: string) {
  const separator = operand.indexOf(":");
  if (separator <= 0) return null;
  const alias = operand.slice(0, separator);
  const path = operand.slice(separator + 1);
  if (!path) throw new Error("remote operand requires an exact path");
  return { alias, path };
}

function resolveRemotePath(scope: SessionScope, input: string) {
  if (input.trim() === "") throw new Error("remote path is required");
  return input.startsWith("/")
    ? requireRemotePath(scope.root, input)
    : joinRemotePath(scope.root, input);
}

async function requireRemoteEntry(
  options: ValidatedOptions,
  scope: SessionScope,
  path: string,
  expected: "file" | "directory",
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const normalized = requireRemotePath("/", path);
  const entry = await options.transport.stat(
    scope.sessionId,
    normalized,
    signal,
  );
  if (!entry) throw new Error(`remote path does not exist: ${normalized}`);
  if (entry.type !== expected) {
    throw new Error(`remote path is not a ${expected}: ${path}`);
  }
  return entry;
}

function validateDirectoryEntryName(name: string) {
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error("remote directory returned an unsafe entry name");
  }
}

async function requireAuthorizedLocalDestination(
  options: ValidatedOptions,
  fileSystem: ProjectShellFileSystem,
  path: string,
  signal?: AbortSignal,
) {
  if (!options.localTargets.has(path)) {
    throw new Error(
      "project destination is not an explicitly selected resource",
    );
  }
  throwIfAborted(signal);
  const stat = await fileSystem.stat(path, signal);
  if (stat?.type !== "file") {
    throw new Error("project destination must be an existing file");
  }
}

function resolveLocalPath(localRoot: string, cwd: string, input: string) {
  if (!input || input.includes("\0") || input.includes("\\")) {
    throw new Error("project path is invalid");
  }
  const normalizedCwd = normalizeLocalAbsolute(cwd);
  requireWithinLocalRoot(localRoot, normalizedCwd);
  const source = input.startsWith("/") ? input : `${normalizedCwd}/${input}`;
  const normalized = normalizeLocalAbsolute(source);
  requireWithinLocalRoot(localRoot, normalized);
  if (normalized === localRoot)
    throw new Error("project path must identify a file");
  return normalized;
}

function normalizeLocalAbsolute(path: string) {
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    throw new Error("project path must be an absolute POSIX path");
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0)
        throw new Error("project path escapes its root");
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function requireWithinLocalRoot(root: string, path: string) {
  if (path !== root && !path.startsWith(`${root}/`)) {
    throw new Error("project path is outside the current project root");
  }
}

function validateTextPayload(
  command: string,
  contents: string,
  maxBytes: number,
) {
  if (contents.includes("\0")) {
    throw new Error(`${command} only supports plain text transfers`);
  }
  if (utf8ByteLength(contents) > maxBytes) {
    throw new Error(`${command} text transfer exceeds ${maxBytes} bytes`);
  }
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  }
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "operation failed";
  return message.replace(/[\r\n]+/gu, " ").slice(0, 500);
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function commandSuccess(stdout = ""): ProjectShellCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function commandFailure(command: string, message: string, exitCode = 1) {
  return { stdout: "", stderr: `${command}: ${message}\n`, exitCode };
}

function usage(command: string, syntax: string) {
  return commandFailure(command, `usage: ${syntax}`, 2);
}

function sshUsage() {
  return usage(
    "ssh",
    "ssh <alias> diagnose | ssh <alias> [--] '<remote command>'",
  );
}

function sftpUsage() {
  return usage(
    "sftp",
    "sftp <alias> (ls [remote path] | cat <remote path> | get <remote path> <existing project path>)",
  );
}
