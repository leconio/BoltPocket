import {
  decodeByteString,
  decodeUtf8Strict,
  encodeUtf8,
  installProjectShellRuntimePolyfills,
} from "./runtime-polyfills.ts";

import {
  Bash,
  InMemoryFs,
  defineCommand,
  getCommandNames,
  getNetworkCommandNames,
  type BashOptions,
  type CommandName,
  type ExecResult,
  type IFileSystem,
  type ResolvedCommandContext,
} from "just-bash/browser";

import { utf8ByteLength } from "./memory-file-system.ts";
import { parentProjectPath, resolveProjectPath } from "./path.ts";
import type {
  ProjectShellCapabilityStatus,
  ProjectShellChange,
  ProjectShellCommand,
  ProjectShellCommandCapability,
  ProjectShellCommandResult,
  ProjectShellExecuteInput,
  ProjectShellExecuteResult,
  ProjectShellFetch,
  ProjectShellFileSystem,
  ProjectShellJavaScriptRuntime,
  ProjectShellLimits,
  ProjectShellOptions,
  ProjectShellRuntimeCommand,
} from "./types.ts";

const DEFAULT_LIMITS: ProjectShellLimits = {
  maxCommandLength: 64 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxProjectEntries: 10_000,
  maxProjectBytes: 16 * 1024 * 1024,
  maxExecutionTimeMs: 15_000,
  maxJavaScriptMemoryBytes: 16 * 1024 * 1024,
  maxJavaScriptStackBytes: 512 * 1024,
};

const BUILT_IN_COMMANDS = [...getCommandNames()].sort(compareText);
const NETWORK_COMMANDS = [...getNetworkCommandNames()].sort(compareText);
const REACT_NATIVE_EXCLUDED_COMMANDS = [
  "node",
  "python",
  "python3",
  "sqlite3",
  "tar",
  "xan",
  "yq",
] as const;
const RESERVED_COMMANDS = new Set([
  ...BUILT_IN_COMMANDS,
  ...NETWORK_COMMANDS,
  "js-exec",
]);

type ProjectSnapshot = {
  directories: ReadonlySet<string>;
  files: ReadonlyMap<string, string>;
};

type TimedExecution =
  | { kind: "completed"; result: Awaited<ReturnType<Bash["exec"]>> }
  | { kind: "timed_out" };

export class ProjectShell {
  readonly #options: ProjectShellOptions;
  readonly #commands: ReadonlyMap<string, ProjectShellCommand>;
  readonly #runtimeCommands: ReadonlyMap<string, ProjectShellRuntimeCommand>;
  readonly #limits: ProjectShellLimits;
  readonly #root: string;

  constructor(options: ProjectShellOptions) {
    if (!options || typeof options.fileSystem !== "object") {
      throw new TypeError("ProjectShell requires a fileSystem");
    }
    installProjectShellRuntimePolyfills();
    const custom = new Map<string, ProjectShellCommand>();
    for (const [name, command] of Object.entries(options.commands ?? {})) {
      validateCommandName(name, "custom");
      if (RESERVED_COMMANDS.has(name)) {
        throw new TypeError(`Custom command cannot replace built-in '${name}'`);
      }
      if (typeof command !== "function") {
        throw new TypeError(`Custom command '${name}' must be a function`);
      }
      custom.set(name, command);
    }
    const runtime = validateRuntimeCommands(options.runtimeCommands, custom);
    this.#options = options;
    this.#commands = custom;
    this.#runtimeCommands = runtime;
    this.#limits = validateLimits(options.limits);
    this.#root = validateRoot(options.root);
  }

  getCommandCapabilities(): readonly ProjectShellCommandCapability[] {
    const capabilities: ProjectShellCommandCapability[] = BUILT_IN_COMMANDS.map(
      (command) => ({ command, status: "available" }),
    );
    capabilities.push(
      this.#options.fetch
        ? { command: "curl", status: "available" }
        : {
            command: "curl",
            status: "requires_fetch",
            reason: "curl requires a project-scoped fetch capability",
          },
      this.#options.javaScriptRuntime
        ? { command: "js-exec", status: "available" }
        : {
            command: "js-exec",
            status: "requires_javascript_runtime",
            reason: "js-exec requires the isolated native JavaScript runtime",
          },
    );
    for (const command of REACT_NATIVE_EXCLUDED_COMMANDS) {
      if (!this.#commands.has(command) && !this.#runtimeCommands.has(command)) {
        capabilities.push({
          command,
          status: "unavailable_on_react_native",
          reason: `${command} is not available in the React Native runtime`,
        });
      }
    }
    for (const command of this.#commands.keys()) {
      capabilities.push({ command, status: "available" });
    }
    for (const command of this.#runtimeCommands.keys()) {
      capabilities.push({ command, status: "available" });
    }
    return capabilities.sort((left, right) =>
      compareText(left.command, right.command),
    );
  }

  async execute(
    input: ProjectShellExecuteInput,
  ): Promise<ProjectShellExecuteResult> {
    if (!input || typeof input.command !== "string") {
      throw new TypeError("execute requires a command string");
    }
    installProjectShellRuntimePolyfills();
    throwIfAborted(input.signal);

    let cwd = this.#root;
    try {
      cwd = resolveProjectPath(this.#root, input.cwd ?? this.#root);
      assertWithinRoot(cwd, this.#root);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return shellFailure("shell: invalid working directory\n", this.#root, 2);
    }
    if (input.command.length > this.#limits.maxCommandLength) {
      return shellFailure(
        `shell: command exceeds ${this.#limits.maxCommandLength} character limit\n`,
        cwd,
        2,
      );
    }

    let initial: ProjectSnapshot;
    try {
      initial = await loadProjectSnapshot(
        this.#options.fileSystem,
        this.#limits,
        this.#root,
        input.signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      return shellFailure("shell: unable to read project snapshot\n", cwd, 1);
    }
    if (!initial.directories.has(cwd)) {
      return shellFailure(`shell: ${cwd}: not a directory\n`, cwd, 2);
    }

    const backing = await createInMemoryFileSystem(initial, this.#limits);
    const fileSystem = createScopedAsyncOnlyFileSystem(backing, this.#root);
    const executionController = new AbortController();
    const forwardAbort = (): void => executionController.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });

    const bash = new Bash({
      commands: getCommandNames() as CommandName[],
      cwd,
      customCommands: this.#createCommands(),
      defenseInDepth: false,
      executionLimitProfile: "hardened",
      executionLimits: createExecutionLimits(this.#limits),
      fs: fileSystem,
      ...(this.#options.fetch
        ? {
            fetch: createSecureFetchAdapter(
              this.#options.fetch,
              this.#limits.maxProjectBytes,
            ),
          }
        : {}),
    });

    try {
      const execution = await executeWithTimeout(
        bash,
        input.command,
        executionController,
        this.#limits.maxExecutionTimeMs,
        input.signal,
      );
      if (execution.kind === "timed_out") {
        return shellFailure(
          `shell: execution timed out after ${this.#limits.maxExecutionTimeMs}ms\n`,
          cwd,
          124,
        );
      }
      throwIfAborted(input.signal);

      const resultCwd = execution.result.env.PWD;
      if (
        typeof resultCwd !== "string" ||
        !isWithinRoot(resultCwd, this.#root)
      ) {
        return shellFailure(
          `shell: working directory escaped project root ${this.#root}\n`,
          cwd,
          1,
        );
      }

      let changes: readonly ProjectShellChange[];
      try {
        changes = await collectTextChanges(
          initial,
          backing,
          this.#root,
          this.#limits,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        return {
          stdout: execution.result.stdout,
          stderr: `${execution.result.stderr}shell: changes exceed the text Diff safety boundary (binary, symbolic link, or project limit)\n`,
          exitCode: 1,
          cwd: resultCwd,
          changes: [],
        };
      }
      return {
        stdout: execution.result.stdout,
        stderr: execution.result.stderr,
        exitCode: execution.result.exitCode,
        cwd: resultCwd,
        changes,
      };
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) throw abortError();
      return shellFailure("shell: execution failed\n", cwd, 1);
    } finally {
      input.signal?.removeEventListener("abort", forwardAbort);
    }
  }

  #createCommands(): BashOptions["customCommands"] {
    const commands = [];
    if (!this.#options.fetch) {
      commands.push(
        unavailableCommand(
          "curl",
          "requires_fetch",
          "curl requires a project-scoped fetch capability",
        ),
      );
    }
    commands.push(
      this.#options.javaScriptRuntime
        ? createJavaScriptCommand(this.#options.javaScriptRuntime, this.#limits)
        : unavailableCommand(
            "js-exec",
            "requires_javascript_runtime",
            "js-exec requires the isolated native JavaScript runtime",
          ),
    );
    for (const name of REACT_NATIVE_EXCLUDED_COMMANDS) {
      if (!this.#commands.has(name) && !this.#runtimeCommands.has(name)) {
        commands.push(
          unavailableCommand(
            name,
            "unavailable_on_react_native",
            `${name} is not available in the React Native runtime`,
          ),
        );
      }
    }
    commands.push(...this.#runtimeCommands.values());
    for (const [name, command] of this.#commands) {
      commands.push(createCustomCommand(name, command, this.#options.fetch));
    }
    return commands;
  }
}

function validateRuntimeCommands(
  input: readonly ProjectShellRuntimeCommand[] | undefined,
  customCommands: ReadonlyMap<string, ProjectShellCommand>,
): ReadonlyMap<string, ProjectShellRuntimeCommand> {
  if (input !== undefined && !Array.isArray(input)) {
    throw new TypeError("ProjectShell runtimeCommands must be an array");
  }
  const commands = new Map<string, ProjectShellRuntimeCommand>();
  for (const candidate of input ?? []) {
    if (!candidate || typeof candidate !== "object") {
      throw new TypeError("ProjectShell runtime command must be an object");
    }
    const { name, trusted, execute } = candidate;
    validateCommandName(name, "runtime");
    if (trusted !== false) {
      throw new TypeError(
        `Runtime command '${name}' must set trusted to false`,
      );
    }
    if (RESERVED_COMMANDS.has(name)) {
      throw new TypeError(`Runtime command cannot replace built-in '${name}'`);
    }
    if (customCommands.has(name) || commands.has(name)) {
      throw new TypeError(`Duplicate custom command '${name}'`);
    }
    if (typeof execute !== "function") {
      throw new TypeError(`Runtime command '${name}' must provide execute`);
    }
    // Snapshot the validated surface so later mutation of the source object
    // cannot change its name, trust level, or implementation.
    commands.set(name, Object.freeze({ name, trusted: false, execute }));
  }
  return commands;
}

function validateCommandName(
  name: unknown,
  kind: "custom" | "runtime",
): asserts name is string {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name)) {
    throw new TypeError(`Invalid ${kind} command name '${String(name)}'`);
  }
}

async function loadProjectSnapshot(
  fileSystem: ProjectShellFileSystem,
  limits: ProjectShellLimits,
  root: string,
  signal?: AbortSignal,
): Promise<ProjectSnapshot> {
  throwIfAborted(signal);
  const rootStat = await fileSystem.stat(root, signal);
  if (rootStat?.type !== "directory")
    throw new Error("project root is missing");

  const directories = new Set<string>(root === "/" ? ["/"] : ["/", root]);
  const files = new Map<string, string>();
  const pending = [root];
  let entryCount = 0;
  let totalBytes = 0;

  for (let index = 0; index < pending.length; index += 1) {
    throwIfAborted(signal);
    const directory = pending[index];
    if (!directory) throw new Error("invalid project traversal state");
    const rawEntries = await fileSystem.readDirectory(directory, signal);
    if (!Array.isArray(rawEntries)) {
      throw new TypeError("readDirectory must return an array");
    }
    const entries = [...rawEntries].sort((left, right) =>
      compareText(left.name, right.name),
    );
    for (const entry of entries) {
      throwIfAborted(signal);
      validateDirectoryEntry(entry);
      const path =
        directory === "/" ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (directories.has(path) || files.has(path)) {
        throw new Error(`duplicate project path: ${path}`);
      }
      entryCount += 1;
      if (entryCount > limits.maxProjectEntries) {
        throw new Error("project entry limit exceeded");
      }
      const current = await fileSystem.stat(path, signal);
      if (current === null || current.type !== entry.type) {
        throw new Error(`project changed while reading: ${path}`);
      }
      if (!Number.isSafeInteger(current.size) || current.size < 0) {
        throw new Error(`invalid project stat: ${path}`);
      }
      if (entry.type === "directory") {
        directories.add(path);
        pending.push(path);
        continue;
      }
      if (
        current.size > limits.maxProjectBytes - totalBytes ||
        entry.size > limits.maxProjectBytes - totalBytes
      ) {
        throw new Error("project byte limit exceeded");
      }
      const contents = await fileSystem.readFile(path, signal);
      if (typeof contents !== "string") {
        throw new TypeError("readFile must return a string");
      }
      const normalized = decodeUtf8Strict(encodeUtf8(contents));
      if (normalized !== contents) {
        throw new Error(`project file is not valid UTF-8 text: ${path}`);
      }
      totalBytes += utf8ByteLength(contents);
      if (totalBytes > limits.maxProjectBytes) {
        throw new Error("project byte limit exceeded");
      }
      files.set(path, contents);
    }
  }
  return { directories, files };
}

function validateDirectoryEntry(entry: {
  name: string;
  type: string;
  size: number;
}): void {
  if (
    !entry ||
    typeof entry.name !== "string" ||
    entry.name.length === 0 ||
    entry.name === "." ||
    entry.name === ".." ||
    entry.name.includes("/") ||
    entry.name.includes("\0")
  ) {
    throw new Error("invalid project directory entry name");
  }
  if (entry.type !== "file" && entry.type !== "directory") {
    throw new Error("invalid project directory entry type");
  }
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new Error("invalid project directory entry size");
  }
}

async function createInMemoryFileSystem(
  snapshot: ProjectSnapshot,
  limits: ProjectShellLimits,
): Promise<InMemoryFs> {
  const files = Object.fromEntries(snapshot.files);
  const fileSystem = new InMemoryFs(files, {
    maxTotalBytes: limits.maxProjectBytes,
  });
  const directories = [...snapshot.directories]
    .filter((path) => path !== "/")
    .sort((left, right) => {
      const depth = pathDepth(left) - pathDepth(right);
      return depth === 0 ? compareText(left, right) : depth;
    });
  for (const directory of directories) {
    if (!(await fileSystem.exists(directory))) {
      await fileSystem.mkdir(directory, { recursive: true });
    }
  }
  return fileSystem;
}

function createScopedAsyncOnlyFileSystem(
  fileSystem: InMemoryFs,
  root: string,
): IFileSystem {
  const scopedPath = (path: string): string => {
    const resolved = fileSystem.resolvePath(root, path);
    assertWithinRoot(resolved, root);
    return resolved;
  };
  const existingPath = (path: string): string | null => {
    const resolved = fileSystem.resolvePath(root, path);
    return isWithinRoot(resolved, root) ? resolved : null;
  };
  return {
    appendFile: (path, content, options) =>
      fileSystem.appendFile(scopedPath(path), content, options),
    chmod: (path, mode) => fileSystem.chmod(scopedPath(path), mode),
    cp: (source, destination, options) =>
      fileSystem.cp(scopedPath(source), scopedPath(destination), options),
    exists: (path) => {
      const resolved = existingPath(path);
      return resolved === null
        ? Promise.resolve(false)
        : fileSystem.exists(resolved);
    },
    getAllPaths: () =>
      fileSystem.getAllPaths().filter((path) => isWithinRoot(path, root)),
    link: (existing, newPath) =>
      fileSystem.link(scopedPath(existing), scopedPath(newPath)),
    lstat: (path) => fileSystem.lstat(scopedPath(path)),
    mkdir: (path, options) => fileSystem.mkdir(scopedPath(path), options),
    mv: (source, destination) => {
      const scopedSource = scopedPath(source);
      const scopedDestination = scopedPath(destination);
      if (scopedSource === root || scopedDestination === root) {
        throw scopeError(root);
      }
      return fileSystem.mv(scopedSource, scopedDestination);
    },
    readFile: (path, options) => fileSystem.readFile(scopedPath(path), options),
    readFileBuffer: (path) => fileSystem.readFileBuffer(scopedPath(path)),
    readFileBytes: (path) => fileSystem.readFileBytes(scopedPath(path)),
    readdir: (path) => fileSystem.readdir(scopedPath(path)),
    readdirWithFileTypes: (path) =>
      fileSystem.readdirWithFileTypes(scopedPath(path)),
    readlink: (path) => fileSystem.readlink(scopedPath(path)),
    async realpath(path) {
      const resolved = await fileSystem.realpath(scopedPath(path));
      assertWithinRoot(resolved, root);
      return resolved;
    },
    resolvePath: (base, path) => {
      const resolved = fileSystem.resolvePath(base, path);
      assertWithinRoot(resolved, root);
      return resolved;
    },
    rm: (path, options) => {
      const resolved = scopedPath(path);
      if (resolved === root) throw scopeError(root);
      return fileSystem.rm(resolved, options);
    },
    stat: (path) => fileSystem.stat(scopedPath(path)),
    symlink: () => {
      throw new Error(
        "EACCES: symbolic links are disabled in the project shell",
      );
    },
    utimes: (path, accessTime, modifiedTime) =>
      fileSystem.utimes(scopedPath(path), accessTime, modifiedTime),
    writeFile: (path, content, options) =>
      fileSystem.writeFile(scopedPath(path), content, options),
  };
}

async function collectTextChanges(
  initial: ProjectSnapshot,
  fileSystem: InMemoryFs,
  root: string,
  limits: ProjectShellLimits,
): Promise<readonly ProjectShellChange[]> {
  const finalFiles = new Map<string, string>();
  let entryCount = 0;
  let totalBytes = 0;
  for (const path of fileSystem.getAllPaths().sort(compareText)) {
    if (!isWithinRoot(path, root)) continue;
    if (path !== root) {
      entryCount += 1;
      if (entryCount > limits.maxProjectEntries) {
        throw new Error("project entry limit exceeded");
      }
    }
    const stat = await fileSystem.lstat(path);
    if (stat.isSymbolicLink) {
      throw new Error("symbolic links cannot be represented by a text patch");
    }
    if (!stat.isFile) continue;
    const bytes = await fileSystem.readFileBuffer(path);
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxProjectBytes) {
      throw new Error("project byte limit exceeded");
    }
    finalFiles.set(path, decodeUtf8Strict(bytes));
  }

  const paths = new Set([...initial.files.keys(), ...finalFiles.keys()]);
  const changes: ProjectShellChange[] = [];
  for (const path of [...paths].sort(compareText)) {
    const before = initial.files.get(path);
    const after = finalFiles.get(path);
    if (before === after) continue;
    if (before === undefined && after !== undefined) {
      changes.push({ path, kind: "created", before: null, after });
    } else if (before !== undefined && after === undefined) {
      changes.push({ path, kind: "deleted", before, after: null });
    } else if (before !== undefined && after !== undefined) {
      changes.push({ path, kind: "modified", before, after });
    }
  }
  return changes;
}

function createCustomCommand(
  name: string,
  command: ProjectShellCommand,
  fetch?: ProjectShellFetch,
) {
  const readOnlyFetch = fetch ? createReadOnlyProjectFetch(fetch) : undefined;
  return defineCommand(
    name,
    async (args, context) => {
      const result = await command({
        args,
        cwd: context.cwd,
        fileSystem: createProjectFileSystemAdapter(context),
        stdin: decodeByteString(String(context.stdin)),
        ...(readOnlyFetch ? { fetch: readOnlyFetch } : {}),
        ...(context.signal ? { signal: context.signal } : {}),
      });
      if (result.cwd !== undefined) {
        return {
          stdout: "",
          stderr: `${name}: custom commands cannot change the parent shell directory\n`,
          exitCode: 2,
        };
      }
      return validateCommandResult(name, result);
    },
    { trusted: false },
  );
}

function createProjectFileSystemAdapter(
  context: ResolvedCommandContext,
): ProjectShellFileSystem {
  const normalize = (path: string): string =>
    context.fs.resolvePath(context.cwd, path);
  return {
    async readDirectory(path, signal) {
      throwIfAborted(signal);
      const normalized = normalize(path);
      const names = await context.fs.readdir(normalized);
      const entries = await Promise.all(
        names.sort(compareText).map(async (name) => {
          const stat = await context.fs.stat(
            context.fs.resolvePath(normalized, name),
          );
          return {
            name,
            type: stat.isDirectory ? ("directory" as const) : ("file" as const),
            size: stat.size,
          };
        }),
      );
      throwIfAborted(signal);
      return entries;
    },
    async readFile(path, signal) {
      throwIfAborted(signal);
      const contents = await context.fs.readFile(normalize(path));
      throwIfAborted(signal);
      return contents;
    },
    async stat(path, signal) {
      throwIfAborted(signal);
      try {
        const stat = await context.fs.stat(normalize(path));
        return {
          type: stat.isDirectory ? ("directory" as const) : ("file" as const),
          size: stat.size,
        };
      } catch (error) {
        if (isMissingFileSystemError(error)) return null;
        throw error;
      }
    },
    async writeFile(path, contents, signal) {
      throwIfAborted(signal);
      await context.fs.writeFile(normalize(path), contents);
      throwIfAborted(signal);
    },
  };
}

function createJavaScriptCommand(
  runtime: ProjectShellJavaScriptRuntime,
  limits: ProjectShellLimits,
) {
  return defineCommand(
    "js-exec",
    async (args, context) => {
      const parsed = parseJavaScriptArgs(args);
      if ("exitCode" in parsed) return parsed;
      if (parsed.help) return javascriptHelp();
      if (parsed.version) {
        return {
          stdout: "BoltPocket isolated JavaScript runtime\n",
          stderr: "",
          exitCode: 0,
        };
      }

      let source: string;
      let filename: string;
      let stdin: string;
      if (parsed.code !== null) {
        source = parsed.code;
        filename = "<command>";
        stdin = decodeByteString(String(context.stdin));
      } else if (parsed.file !== null) {
        filename = context.fs.resolvePath(context.cwd, parsed.file);
        try {
          source = await context.fs.readFile(filename);
        } catch {
          return {
            stdout: "",
            stderr: `js-exec: can't open file '${parsed.file}'\n`,
            exitCode: 1,
          };
        }
        stdin = decodeByteString(String(context.stdin));
      } else {
        source = decodeByteString(String(context.stdin));
        filename = "<stdin>";
        stdin = "";
        if (source.length === 0) {
          return {
            stdout: "",
            stderr:
              "js-exec: no input provided (use -c CODE or provide a script file)\n",
            exitCode: 2,
          };
        }
      }
      let files: { path: string; contents: string }[];
      try {
        files = await snapshotJavaScriptFiles(
          context.fs,
          context.cwd,
          parsed.inputFiles,
        );
      } catch (error) {
        return commandFailure(
          `${error instanceof Error ? error.message : "js-exec: invalid input file"}\n`,
          1,
        );
      }

      const result = await runtime.execute({
        args: parsed.scriptArgs,
        cwd: context.cwd,
        filename,
        files,
        stdin,
        limits: {
          memoryBytes: limits.maxJavaScriptMemoryBytes,
          outputBytes: limits.maxOutputBytes,
          stackBytes: limits.maxJavaScriptStackBytes,
          timeoutMs: limits.maxExecutionTimeMs,
        },
        source,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      const validated = validateJavaScriptResult(result, limits);
      await applyJavaScriptChanges(context.fs, validated.changes ?? [], limits);
      return {
        stdout: validated.stdout,
        stderr: validated.stderr,
        exitCode: validated.exitCode,
      };
    },
    { trusted: false },
  );
}

type ParsedJavaScriptArgs =
  | {
      code: string | null;
      file: string | null;
      help: boolean;
      inputFiles: string[];
      scriptArgs: string[];
      version: boolean;
    }
  | ExecResult;

function parseJavaScriptArgs(args: readonly string[]): ParsedJavaScriptArgs {
  const parsed = {
    code: null as string | null,
    file: null as string | null,
    help: false,
    inputFiles: [] as string[],
    scriptArgs: [] as string[],
    version: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      parsed.help = true;
      return parsed;
    }
    if (argument === "--version" || argument === "-V") {
      parsed.version = true;
      return parsed;
    }
    if (argument === "-c") {
      const code = args[index + 1];
      if (code === undefined) {
        return commandFailure(
          "js-exec: option requires an argument -- 'c'\n",
          2,
        );
      }
      parsed.code = code;
      parsed.scriptArgs = args.slice(index + 2);
      return parsed;
    }
    if (argument === "--input-file") {
      const inputFile = args[index + 1];
      if (inputFile === undefined) {
        return commandFailure(
          "js-exec: option requires an argument -- 'input-file'\n",
          2,
        );
      }
      parsed.inputFiles.push(inputFile);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--input-file=")) {
      const inputFile = argument.slice("--input-file=".length);
      if (!inputFile) {
        return commandFailure(
          "js-exec: option requires an argument -- 'input-file'\n",
          2,
        );
      }
      parsed.inputFiles.push(inputFile);
      continue;
    }
    if (argument === "--") {
      const file = args[index + 1];
      if (file !== undefined) {
        parsed.file = file;
        parsed.scriptArgs = args.slice(index + 2);
      }
      return parsed;
    }
    if (argument?.startsWith("-") && argument !== "-") {
      return commandFailure(`js-exec: unsupported option '${argument}'\n`, 2);
    }
    if (argument !== undefined) {
      parsed.file = argument;
      parsed.scriptArgs = args.slice(index + 1);
      return parsed;
    }
  }
  return parsed;
}

function javascriptHelp(): ExecResult {
  return {
    stdout:
      "js-exec - finite JavaScript execution in BoltPocket's isolated native runtime\n\n" +
      "Usage: js-exec [--input-file PATH]... [-c CODE | FILE] [ARGS...]\n" +
      "Piped data is available as input.stdin for -c CODE or FILE.\n" +
      "Only explicitly selected input files are copied into input.files.\n" +
      "The runtime has fixed memory, stack, output and wall-time limits.\n" +
      "It has no host eval, system shell, network, import, require, or native bridge.\n",
    stderr: "",
    exitCode: 0,
  };
}

async function snapshotJavaScriptFiles(
  fileSystem: IFileSystem,
  cwd: string,
  selectedPaths: readonly string[],
): Promise<{ path: string; contents: string }[]> {
  const files: { path: string; contents: string }[] = [];
  const seen = new Set<string>();
  for (const selectedPath of selectedPaths) {
    const path = fileSystem.resolvePath(cwd, selectedPath);
    if (seen.has(path)) {
      throw new Error(`js-exec: duplicate input file '${selectedPath}'`);
    }
    seen.add(path);
    const stat = await fileSystem.lstat(path);
    if (stat.isSymbolicLink) {
      throw new Error(
        `js-exec: input file is a symbolic link '${selectedPath}'`,
      );
    }
    if (!stat.isFile) {
      throw new Error(`js-exec: input path is not a file '${selectedPath}'`);
    }
    files.push({
      path,
      contents: decodeUtf8Strict(await fileSystem.readFileBuffer(path)),
    });
  }
  return files;
}

function javascriptCommandStdout(
  stdout: string,
  result: string | null,
): string {
  if (result === null) {
    return stdout;
  }
  const separator = stdout.length === 0 || stdout.endsWith("\n") ? "" : "\n";
  const suffix = result.endsWith("\n") ? "" : "\n";
  return `${stdout}${separator}${result}${suffix}`;
}

function validateJavaScriptResult(
  result: Awaited<ReturnType<ProjectShellJavaScriptRuntime["execute"]>>,
  limits: ProjectShellLimits,
) {
  if (!result || typeof result !== "object") {
    throw new TypeError("js-exec: invalid runtime result");
  }
  const validated = validateCommandResult("js-exec", result);
  if (result.changes !== undefined && !Array.isArray(result.changes)) {
    throw new TypeError("js-exec: changes must be an array");
  }
  if (
    result.result !== undefined &&
    result.result !== null &&
    typeof result.result !== "string"
  ) {
    throw new TypeError("js-exec: result must be a string or null");
  }
  const expressionResult = result.result ?? null;
  const stdout = javascriptCommandStdout(validated.stdout, expressionResult);
  if (
    utf8ByteLength(stdout) + utf8ByteLength(validated.stderr) >
    limits.maxOutputBytes
  ) {
    throw new Error("js-exec: output limit exceeded");
  }
  if ((result.changes?.length ?? 0) > limits.maxProjectEntries) {
    throw new Error("js-exec: change count limit exceeded");
  }
  return {
    ...validated,
    stdout,
    result: expressionResult,
    changes: result.changes,
  };
}

async function applyJavaScriptChanges(
  fileSystem: IFileSystem,
  rawChanges: readonly ProjectShellChange[],
  limits: ProjectShellLimits,
): Promise<void> {
  const changes = [...rawChanges].sort((left, right) =>
    compareText(left.path, right.path),
  );
  const seen = new Set<string>();
  const currentPaths = fileSystem.getAllPaths();
  let projectedEntries = Math.max(0, currentPaths.length - 1);
  let projectedBytes = 0;
  for (const path of currentPaths) {
    const stat = await fileSystem.lstat(path);
    if (stat.isFile) projectedBytes += stat.size;
  }
  for (const change of changes) {
    validateJavaScriptChange(change);
    const path = resolveProjectPath("/", change.path);
    if (path !== change.path || seen.has(path)) {
      throw new Error("js-exec: invalid or duplicate change path");
    }
    seen.add(path);
    const exists = await fileSystem.exists(path);
    const current = exists
      ? decodeUtf8Strict(await fileSystem.readFileBuffer(path))
      : null;
    if (current !== change.before) {
      throw new Error(`js-exec: stale change for ${path}`);
    }
    const beforeBytes = current === null ? 0 : utf8ByteLength(current);
    const afterBytes =
      change.kind === "deleted" ? 0 : utf8ByteLength(change.after);
    projectedBytes += afterBytes - beforeBytes;
    if (change.kind === "created") projectedEntries += 1;
    if (change.kind === "deleted") projectedEntries -= 1;
    if (
      projectedBytes > limits.maxProjectBytes ||
      projectedEntries > limits.maxProjectEntries
    ) {
      throw new Error("js-exec: project limit exceeded");
    }
    if (change.kind === "created") {
      const parent = await fileSystem.stat(parentProjectPath(path));
      if (!parent.isDirectory) {
        throw new Error(`js-exec: parent directory is missing for ${path}`);
      }
    }
  }
  for (const change of changes) {
    if (change.kind === "deleted") {
      await fileSystem.rm(change.path);
    } else {
      await fileSystem.writeFile(change.path, change.after);
    }
  }
}

function validateJavaScriptChange(change: ProjectShellChange): void {
  if (
    !change ||
    typeof change !== "object" ||
    typeof change.path !== "string"
  ) {
    throw new TypeError("js-exec: invalid file change");
  }
  if (change.kind === "created") {
    if (change.before !== null || typeof change.after !== "string") {
      throw new TypeError("js-exec: invalid created file change");
    }
    assertValidText(change.after);
    return;
  }
  if (change.kind === "modified") {
    if (typeof change.before !== "string" || typeof change.after !== "string") {
      throw new TypeError("js-exec: invalid modified file change");
    }
    assertValidText(change.before);
    assertValidText(change.after);
    return;
  }
  if (change.kind === "deleted") {
    if (typeof change.before !== "string" || change.after !== null) {
      throw new TypeError("js-exec: invalid deleted file change");
    }
    assertValidText(change.before);
    return;
  }
  throw new TypeError("js-exec: invalid file change kind");
}

function assertValidText(value: string): void {
  if (decodeUtf8Strict(encodeUtf8(value)) !== value) {
    throw new TypeError("js-exec: file changes must contain valid UTF-8 text");
  }
}

function unavailableCommand(
  name: string,
  status: ProjectShellCapabilityStatus,
  reason: string,
) {
  return defineCommand(
    name,
    async () => ({
      stdout: "",
      stderr: `${name}: unavailable (${status}): ${reason}\n`,
      exitCode: 126,
    }),
    { trusted: false },
  );
}

function createSecureFetchAdapter(
  fetch: ProjectShellFetch,
  maxResponseBytes: number,
): NonNullable<BashOptions["fetch"]> {
  return async (url, options = {}) => {
    const method = (options.method ?? "GET").toUpperCase();
    assertReadOnlyFetchRequest(method, options.body);
    const response = await fetch(url, {
      method,
      headers: normalizeHeaders(options.headers),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response || typeof response.text !== "function") {
      throw new TypeError("fetch capability returned an invalid response");
    }
    if (
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599 ||
      typeof response.statusText !== "string"
    ) {
      throw new TypeError(
        "fetch capability returned invalid HTTP status metadata",
      );
    }
    const body = await response.text();
    if (typeof body !== "string") {
      throw new TypeError("fetch response text() must return a string");
    }
    const headers: Record<string, string> = {};
    response.headers?.forEach((value, key) => {
      if (typeof value !== "string" || typeof key !== "string") {
        throw new TypeError("fetch response headers must contain strings");
      }
      headers[key.toLowerCase()] = value;
    });
    const encodedBody = encodeUtf8(body);
    if (encodedBody.byteLength > maxResponseBytes) {
      throw new Error(`fetch response exceeds ${maxResponseBytes} byte limit`);
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: encodedBody,
      url,
    };
  };
}

function createReadOnlyProjectFetch(
  fetch: ProjectShellFetch,
): ProjectShellFetch {
  return (url, init) => {
    const method = init.method.toUpperCase();
    assertReadOnlyFetchRequest(method, init.body);
    return fetch(url, { ...init, method });
  };
}

function assertReadOnlyFetchRequest(
  method: string,
  body: string | undefined,
): void {
  if ((method !== "GET" && method !== "HEAD") || body !== undefined) {
    throw new Error(
      `${method} requires high-risk approval and is unavailable through the read-only fetch capability`,
    );
  }
}

function normalizeHeaders(
  value: Headers | Record<string, string> | undefined,
): Record<string, string> {
  if (value === undefined) return {};
  const headers: Record<string, string> = {};
  if (typeof (value as Headers).forEach === "function") {
    (value as Headers).forEach((headerValue, key) => {
      headers[key] = headerValue;
    });
  } else {
    for (const [key, headerValue] of Object.entries(value)) {
      if (typeof headerValue !== "string") {
        throw new TypeError("fetch headers must contain strings");
      }
      headers[key] = headerValue;
    }
  }
  return headers;
}

function createExecutionLimits(limits: ProjectShellLimits) {
  return {
    maxArrayElements: 50_000,
    maxAwkIterations: 5_000,
    maxAwkParserDepth: 64,
    maxAwkParserOperations: 50_000,
    maxAwkParserTokens: 12_500,
    maxBraceExpansionResults: 5_000,
    maxCallDepth: 64,
    maxCommandCount: 5_000,
    maxCsvCells: 500_000,
    maxCsvRows: 50_000,
    maxExecDepth: 32,
    maxExecutionTimeMs: limits.maxExecutionTimeMs,
    maxExtensionCleanupTimeMs: 20,
    maxFileDescriptors: 256,
    maxFileSystemBytes: limits.maxProjectBytes,
    maxGlobOperations: 50_000,
    maxInputBytes: limits.maxProjectBytes,
    maxJqIterations: 5_000,
    maxLiveBytes: Math.max(
      limits.maxProjectBytes * 2,
      limits.maxOutputBytes * 4,
    ),
    maxLoopIterations: 5_000,
    maxOutputSize: limits.maxOutputBytes,
    maxQueryDepth: 128,
    maxQueryElements: 50_000,
    maxQueryTokens: 12_500,
    maxSedIterations: 5_000,
    maxSourceBytes: limits.maxCommandLength * 4,
    maxSourceDepth: 50,
    maxHeredocSize: 128 * 1024,
    maxStringLength: Math.min(
      Math.max(limits.maxProjectBytes, limits.maxOutputBytes),
      8 * 1024 * 1024,
    ),
    maxSubstitutionDepth: 25,
    maxTraversalEntries: limits.maxProjectEntries,
    maxTraversalDepth: 128,
    maxTraversalWork: limits.maxProjectEntries * 4,
    maxWorkUnits: 50_000,
  };
}

async function executeWithTimeout(
  bash: Bash,
  command: string,
  controller: AbortController,
  timeoutMs: number,
  userSignal?: AbortSignal,
): Promise<TimedExecution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<TimedExecution>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timed_out" });
    }, timeoutMs);
  });
  try {
    const completed = bash
      .exec(command, {
        rawScript: true,
        signal: controller.signal,
      })
      .then((result): TimedExecution => ({ kind: "completed", result }));
    const execution = await Promise.race([completed, timedOut]);
    throwIfAborted(userSignal);
    return execution;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateLimits(
  limits: ProjectShellOptions["limits"],
): ProjectShellLimits {
  const result = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(
        `ProjectShell limit '${name}' must be a positive integer`,
      );
    }
    const maximum = DEFAULT_LIMITS[name as keyof ProjectShellLimits];
    if (value > maximum) {
      throw new TypeError(
        `ProjectShell limit '${name}' cannot exceed mobile maximum ${maximum}`,
      );
    }
  }
  return result;
}

function validateRoot(value: string | undefined): string {
  const root = value ?? "/";
  if (
    typeof root !== "string" ||
    !root.startsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(root)
  ) {
    throw new TypeError("ProjectShell root must be an absolute path");
  }
  const canonicalInput = root === "/" ? root : root.replace(/\/+$/u, "");
  const normalized = resolveProjectPath("/", canonicalInput);
  if (normalized !== canonicalInput) {
    throw new TypeError("ProjectShell root must already be normalized");
  }
  return normalized;
}

function assertWithinRoot(path: string, root: string): void {
  if (!isWithinRoot(path, root)) throw scopeError(path);
}

function isWithinRoot(path: string, root: string): boolean {
  return root === "/" || path === root || path.startsWith(`${root}/`);
}

function scopeError(path: string): Error {
  return new Error(`EACCES: path escapes project root: ${path}`);
}

function validateCommandResult(
  name: string,
  result: ProjectShellCommandResult,
): Required<Pick<ProjectShellCommandResult, "stdout" | "stderr" | "exitCode">> {
  if (!result || typeof result !== "object") {
    throw new TypeError(`${name}: invalid command result`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.exitCode ?? 0;
  if (typeof stdout !== "string" || typeof stderr !== "string") {
    throw new TypeError(`${name}: stdout and stderr must be strings`);
  }
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new TypeError(`${name}: exitCode must be an integer from 0 to 255`);
  }
  return { stdout, stderr, exitCode };
}

function commandFailure(stderr: string, exitCode: number): ExecResult {
  return { stdout: "", stderr, exitCode };
}

function shellFailure(
  stderr: string,
  cwd: string,
  exitCode: number,
): ProjectShellExecuteResult {
  return { stdout: "", stderr, exitCode, cwd, changes: [] };
}

function isMissingFileSystemError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "ENOENT" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("ENOENT"))
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}
