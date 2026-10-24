import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryProjectFileSystem,
  ProjectShell,
  type ProjectShellFetch,
  type ProjectShellFileSystem,
  type ProjectShellJavaScriptExecuteInput,
  type ProjectShellRuntimeCommand,
} from "./index.ts";

const BROWSER_COMMANDS = [
  "alias",
  "awk",
  "base64",
  "basename",
  "bash",
  "cat",
  "chmod",
  "clear",
  "column",
  "comm",
  "cp",
  "cut",
  "date",
  "diff",
  "dirname",
  "du",
  "echo",
  "egrep",
  "env",
  "expand",
  "expr",
  "false",
  "fgrep",
  "file",
  "find",
  "fold",
  "grep",
  "gunzip",
  "gzip",
  "head",
  "help",
  "history",
  "hostname",
  "html-to-markdown",
  "join",
  "jq",
  "ln",
  "ls",
  "md5sum",
  "mkdir",
  "mv",
  "nl",
  "od",
  "paste",
  "printenv",
  "printf",
  "pwd",
  "readlink",
  "rev",
  "rg",
  "rm",
  "rmdir",
  "sed",
  "seq",
  "sh",
  "sha1sum",
  "sha256sum",
  "sleep",
  "sort",
  "split",
  "stat",
  "strings",
  "tac",
  "tail",
  "tee",
  "time",
  "timeout",
  "touch",
  "tr",
  "tree",
  "true",
  "unalias",
  "unexpand",
  "uniq",
  "wc",
  "which",
  "whoami",
  "xargs",
  "zcat",
] as const;

function fixture() {
  const fileSystem = new MemoryProjectFileSystem({
    "/outside.txt": "not authorized\n",
    "/project/data.json": '{"items":[{"name":"zeta"},{"name":"alpha"}]}',
    "/project/delete.txt": "remove me\n",
    "/project/notes.txt": "draft\nalpha\nalpha\nzeta\n",
    "/project/nested/中文.txt": "你好 😀\n",
  });
  return {
    fileSystem,
    shell: new ProjectShell({ fileSystem, root: "/project" }),
  };
}

test("exposes every published browser command with explicit optional capabilities", () => {
  const { shell } = fixture();
  const capabilities = shell.getCommandCapabilities();
  assert.deepEqual(
    capabilities
      .filter((capability) => capability.status === "available")
      .map((capability) => capability.command),
    [...BROWSER_COMMANDS],
  );
  assert.equal(capabilities.length, 88);
  assert.deepEqual(
    capabilities.find((capability) => capability.command === "curl"),
    {
      command: "curl",
      status: "requires_fetch",
      reason: "curl requires a project-scoped fetch capability",
    },
  );
  assert.equal(
    capabilities.find((capability) => capability.command === "js-exec")?.status,
    "requires_javascript_runtime",
  );
  for (const command of [
    "node",
    "python",
    "python3",
    "sqlite3",
    "tar",
    "xan",
    "yq",
  ]) {
    assert.equal(
      capabilities.find((capability) => capability.command === command)?.status,
      "unavailable_on_react_native",
    );
  }
});

test("runs upstream pipelines, substitutions, functions, loops and data tools", async () => {
  const { shell } = fixture();
  const pipeline = await shell.execute({
    command: "cat notes.txt | grep alpha | sort | uniq -c",
    cwd: "/project",
  });
  assert.equal(pipeline.exitCode, 0);
  assert.equal(pipeline.stdout, "   2 alpha\n");

  const language = await shell.execute({
    command:
      "greet() { printf 'hi-%s\\n' \"$1\"; }; " +
      "name=$(jq -r '.items[1].name' data.json); " +
      'for suffix in one two; do greet "$name-$suffix"; done',
    cwd: "/project",
  });
  assert.equal(language.exitCode, 0);
  assert.equal(language.stdout, "hi-alpha-one\nhi-alpha-two\n");

  const unicode = await shell.execute({
    command: "cat nested/中文.txt | wc -lwm",
    cwd: "/project",
  });
  assert.equal(unicode.exitCode, 0);
  assert.match(unicode.stdout, /^\s*1\s+2\s+5\s*$/u);

  const cwd = await shell.execute({
    command: "cd nested; pwd",
    cwd: "/project",
  });
  assert.equal(cwd.stdout, "/project/nested\n");
  assert.equal(cwd.cwd, "/project/nested");
});

test("returns one deterministic text change set and never writes the base", async () => {
  const { fileSystem, shell } = fixture();
  const before = fileSystem.snapshot();
  const result = await shell.execute({
    command:
      "sed -i 's/draft/ready/' notes.txt; " +
      "mkdir generated; printf 'new\\n' > generated/new.txt; " +
      "rm delete.txt",
    cwd: "/project",
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.changes, [
    {
      path: "/project/delete.txt",
      kind: "deleted",
      before: "remove me\n",
      after: null,
    },
    {
      path: "/project/generated/new.txt",
      kind: "created",
      before: null,
      after: "new\n",
    },
    {
      path: "/project/notes.txt",
      kind: "modified",
      before: "draft\nalpha\nalpha\nzeta\n",
      after: "ready\nalpha\nalpha\nzeta\n",
    },
  ]);
  assert.deepEqual(fileSystem.snapshot(), before);
});

test("root-scoped filesystem fails closed for reads, writes, cd and links", async () => {
  const { fileSystem, shell } = fixture();
  for (const command of [
    "cat /outside.txt",
    "cat ../outside.txt",
    "cd /",
    "mkdir -p /tmp",
    "printf leaked > /tmp/leak.txt",
    "ln -s /outside.txt local-link",
  ]) {
    const result = await shell.execute({ command, cwd: "/project" });
    assert.notEqual(result.exitCode, 0, command);
    assert.deepEqual(result.changes, [], command);
  }
  assert.equal(await fileSystem.readFile("/outside.txt"), "not authorized\n");
  assert.equal(await fileSystem.stat("/tmp/leak.txt"), null);
});

test("custom commands see only the scoped overlay and can supply excluded adapters", async () => {
  const base = new MemoryProjectFileSystem({
    "/outside.txt": "secret",
    "/project/value.txt": "before",
  });
  const rejectingBase: ProjectShellFileSystem = {
    readDirectory: (path, signal) => base.readDirectory(path, signal),
    readFile: (path, signal) => base.readFile(path, signal),
    stat: (path, signal) => base.stat(path, signal),
    async writeFile() {
      throw new Error("base write must never be called");
    },
  };
  const shell = new ProjectShell({
    fileSystem: rejectingBase,
    root: "/project",
    commands: {
      async replace({ fileSystem, signal }) {
        await fileSystem.writeFile("value.txt", "after", signal);
        return { stdout: await fileSystem.readFile("value.txt", signal) };
      },
      async escape({ fileSystem, signal }) {
        return { stdout: await fileSystem.readFile("/outside.txt", signal) };
      },
      tar: () => ({ stdout: "app-owned tar adapter\n" }),
    },
  });
  const result = await shell.execute({
    command: "replace; tar",
    cwd: "/project",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "afterapp-owned tar adapter\n");
  assert.deepEqual(result.changes, [
    {
      path: "/project/value.txt",
      kind: "modified",
      before: "before",
      after: "after",
    },
  ]);
  assert.equal(await base.readFile("/project/value.txt"), "before");
  const escape = await shell.execute({
    command: "escape",
    cwd: "/project",
  });
  assert.notEqual(escape.exitCode, 0);
  assert.equal(escape.stdout, "");
  assert.deepEqual(escape.changes, []);
  assert.deepEqual(
    shell
      .getCommandCapabilities()
      .filter((capability) => capability.command === "tar"),
    [{ command: "tar", status: "available" }],
  );
});

test("runtime commands interoperate with binary VFS, lstat, readdir and nested exec", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/project/data.json": '{"answer":42}',
    "/project/nested/value.txt": "alpha\n",
  });
  const runtimeCommand: ProjectShellRuntimeCommand = {
    name: "runtime-probe",
    trusted: false,
    async execute(_args, context) {
      const path = context.fs.resolvePath(context.cwd, "nested/value.txt");
      const bytes = await context.fs.readFileBuffer(path);
      const stat = await context.fs.lstat(path);
      const entries = await context.fs.readdir(context.cwd);
      const nested = await context.exec?.("jq", {
        cwd: context.cwd,
        stdin: await context.fs.readFile("data.json"),
        stdinKind: "text",
        args: ["-r", ".answer"],
        signal: context.signal,
      });
      if (!nested) throw new Error("nested exec is unavailable");
      await context.fs.writeFile(
        context.fs.resolvePath(context.cwd, "generated.txt"),
        new TextEncoder().encode(`nested=${nested.stdout.trim()}\n`),
      );
      return {
        stdout: `${new TextDecoder().decode(bytes).trim()}|${String(stat.isFile)}|${entries.join(",")}\n`,
        stderr: nested.stderr,
        exitCode: nested.exitCode,
      };
    },
  };
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    runtimeCommands: [runtimeCommand] as const,
  });
  const result = await shell.execute({
    command: "runtime-probe",
    cwd: "/project",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "alpha|true|data.json,nested\n");
  assert.deepEqual(result.changes, [
    {
      path: "/project/generated.txt",
      kind: "created",
      before: null,
      after: "nested=42\n",
    },
  ]);
  assert.equal(await fileSystem.stat("/project/generated.txt"), null);
  assert.deepEqual(
    shell
      .getCommandCapabilities()
      .filter((capability) => capability.command === "runtime-probe"),
    [{ command: "runtime-probe", status: "available" }],
  );
});

test("runtime adapters replace React Native unavailable stubs exactly once", async () => {
  const names = ["tar", "yq", "xan", "sqlite3"] as const;
  const runtimeCommands: readonly ProjectShellRuntimeCommand[] = names.map(
    (name) => ({
      name,
      trusted: false,
      async execute() {
        return { stdout: `${name}\n`, stderr: "", exitCode: 0 };
      },
    }),
  );
  const shell = new ProjectShell({
    fileSystem: new MemoryProjectFileSystem(),
    runtimeCommands,
  });
  const result = await shell.execute({ command: names.join(";") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "tar\nyq\nxan\nsqlite3\n");
  for (const name of names) {
    assert.deepEqual(
      shell
        .getCommandCapabilities()
        .filter((capability) => capability.command === name),
      [{ command: name, status: "available" }],
    );
  }
});

test("runtime command filesystem and nested exec remain inside the project root", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/outside.txt": "secret\n",
    "/project/inside.txt": "safe\n",
  });
  const runtimeCommands: readonly ProjectShellRuntimeCommand[] = [
    {
      name: "runtime-read-outside",
      trusted: false,
      async execute(_args, context) {
        const stdout = new TextDecoder().decode(
          await context.fs.readFileBuffer("/outside.txt"),
        );
        return { stdout, stderr: "", exitCode: 0 };
      },
    },
    {
      name: "runtime-write-outside",
      trusted: false,
      async execute(_args, context) {
        await context.fs.writeFile("../outside.txt", "changed\n");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
    {
      name: "runtime-exec-outside",
      trusted: false,
      async execute(_args, context) {
        if (!context.exec) throw new Error("nested exec is unavailable");
        return context.exec("cat", {
          cwd: context.cwd,
          args: ["/outside.txt"],
          signal: context.signal,
        });
      },
    },
  ];
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    runtimeCommands,
  });
  for (const command of runtimeCommands.map(({ name }) => name)) {
    const result = await shell.execute({ command, cwd: "/project" });
    assert.notEqual(result.exitCode, 0, command);
    assert.deepEqual(result.changes, [], command);
  }
  assert.equal(await fileSystem.readFile("/outside.txt"), "secret\n");
});

test("repository commands cannot be replaced by custom commands", () => {
  const fileSystem = new MemoryProjectFileSystem();
  for (const command of ["cat", "curl", "js-exec"]) {
    assert.throws(
      () =>
        new ProjectShell({
          fileSystem,
          commands: { [command]: () => ({}) },
        }),
      /cannot replace built-in/u,
    );
  }
});

test("runtime commands reject invalid, trusted, duplicate and reserved adapters", async () => {
  const fileSystem = new MemoryProjectFileSystem();
  const command = (name: string, trusted: boolean = false) =>
    ({
      name,
      trusted,
      async execute() {
        return { stdout: "original\n", stderr: "", exitCode: 0 };
      },
    }) as unknown as ProjectShellRuntimeCommand;

  for (const name of ["cat", "curl", "js-exec"]) {
    assert.throws(
      () => new ProjectShell({ fileSystem, runtimeCommands: [command(name)] }),
      /cannot replace built-in/u,
    );
  }
  assert.throws(
    () =>
      new ProjectShell({ fileSystem, runtimeCommands: [command("bad/name")] }),
    /Invalid runtime command name/u,
  );
  assert.throws(
    () =>
      new ProjectShell({
        fileSystem,
        runtimeCommands: [command("trusted", true)],
      }),
    /trusted to false/u,
  );
  const missingTrust = {
    name: "missing-trust",
    async execute() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  assert.throws(
    () =>
      new ProjectShell({
        fileSystem,
        runtimeCommands: [
          missingTrust as unknown as ProjectShellRuntimeCommand,
        ],
      }),
    /trusted to false/u,
  );
  assert.throws(
    () =>
      new ProjectShell({
        fileSystem,
        runtimeCommands: [command("duplicate"), command("duplicate")],
      }),
    /Duplicate custom command/u,
  );
  assert.throws(
    () =>
      new ProjectShell({
        fileSystem,
        commands: { duplicate: () => ({}) },
        runtimeCommands: [command("duplicate")],
      }),
    /Duplicate custom command/u,
  );

  const mutableCommand = command("stable");
  const shell = new ProjectShell({
    fileSystem,
    runtimeCommands: [mutableCommand],
  });
  const mutable = mutableCommand as unknown as {
    name: string;
    trusted: boolean;
    execute: ProjectShellRuntimeCommand["execute"];
  };
  mutable.name = "cat";
  mutable.trusted = true;
  mutable.execute = async () => ({
    stdout: "mutated\n",
    stderr: "",
    exitCode: 0,
  });
  const result = await shell.execute({ command: "stable" });
  assert.equal(result.stdout, "original\n");
});

test("curl uses only an injected read capability and rejects mutation methods", async () => {
  const calls: {
    headers: Record<string, string>;
    method: string;
    url: string;
  }[] = [];
  const fetch: ProjectShellFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    return {
      status: 200,
      statusText: "OK",
      headers: {
        forEach(callback) {
          callback("application/json", "content-type");
        },
      },
      async text() {
        return '{"answer":42}';
      },
    };
  };
  const fileSystem = new MemoryProjectFileSystem();
  const shell = new ProjectShell({
    fileSystem,
    fetch,
    commands: {
      async "custom-post"({ fetch: scopedFetch }) {
        await scopedFetch?.("https://example.test/data", {
          method: "POST",
          headers: {},
          body: "mutation",
        });
        return { stdout: "unexpected\n" };
      },
    },
  });
  const read = await shell.execute({
    command: "curl -sS https://example.test/data | jq -r .answer",
  });
  assert.equal(read.stdout, "42\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");

  const mutation = await shell.execute({
    command: "curl -X POST https://example.test/data",
  });
  assert.notEqual(mutation.exitCode, 0);
  assert.match(mutation.stderr, /high-risk approval/u);
  assert.equal(calls.length, 1);

  const customMutation = await shell.execute({ command: "custom-post" });
  assert.notEqual(customMutation.exitCode, 0);
  assert.match(customMutation.stderr, /high-risk approval/u);
  assert.equal(calls.length, 1);

  const offline = await new ProjectShell({ fileSystem }).execute({
    command: "curl https://example.test/data",
  });
  assert.equal(offline.exitCode, 126);
  assert.match(offline.stderr, /requires_fetch|fetch capability/u);
});

test("js-exec delegates only to the finite isolated runtime port", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/project/value.txt": "before",
  });
  let received: ProjectShellJavaScriptExecuteInput | undefined;
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    javaScriptRuntime: {
      async execute(input) {
        received = input;
        return {
          stdout: "js-ok\n",
          stderr: "",
          result: '{"answer":1}',
          exitCode: 0,
          changes: [
            {
              path: "/project/value.txt",
              kind: "modified",
              before: "before",
              after: "after",
            },
          ],
        };
      },
    },
  });
  const result = await shell.execute({
    command:
      "printf payload | js-exec --input-file value.txt -c '({ answer: 1 })' arg-one",
    cwd: "/project",
  });
  assert.equal(result.stdout, 'js-ok\n{"answer":1}\n');
  assert.equal(received?.source, "({ answer: 1 })");
  assert.deepEqual(received?.args, ["arg-one"]);
  assert.equal(received?.stdin, "payload");
  assert.deepEqual(received?.files, [
    { path: "/project/value.txt", contents: "before" },
  ]);
  assert.ok((received?.limits.timeoutMs ?? 0) <= 15_000);
  assert.ok((received?.limits.memoryBytes ?? 0) <= 16 * 1024 * 1024);
  assert.deepEqual(result.changes, [
    {
      path: "/project/value.txt",
      kind: "modified",
      before: "before",
      after: "after",
    },
  ]);
  assert.equal(await fileSystem.readFile("/project/value.txt"), "before");
});

test("js-exec validates runtime changes against root and baseline", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/project/value.txt": "before",
  });
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    javaScriptRuntime: {
      async execute() {
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          changes: [
            {
              path: "/outside.txt",
              kind: "created",
              before: null,
              after: "escape",
            },
          ],
        };
      },
    },
  });
  const result = await shell.execute({
    command: "js-exec -c 1",
    cwd: "/project",
  });
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(result.changes, []);
  assert.equal(await fileSystem.stat("/outside.txt"), null);
});

test("js-exec defaults to no project snapshot and rejects duplicate input files", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/project/value.txt": "before",
  });
  const calls: ProjectShellJavaScriptExecuteInput[] = [];
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    javaScriptRuntime: {
      async execute(input) {
        calls.push(input);
        return {
          stdout: "",
          stderr: "",
          result: "1",
          exitCode: 0,
        };
      },
    },
  });

  const isolated = await shell.execute({
    command: "js-exec -c 1",
    cwd: "/project",
  });
  assert.equal(isolated.stdout, "1\n");
  assert.deepEqual(calls[0]?.files, []);
  assert.equal(calls[0]?.stdin, "");

  const duplicate = await shell.execute({
    command: "js-exec --input-file value.txt --input-file ./value.txt -c 1",
    cwd: "/project",
  });
  assert.notEqual(duplicate.exitCode, 0);
  assert.match(duplicate.stderr, /duplicate input file/u);
  assert.equal(calls.length, 1);
});

test("mobile limits stop loops, aggregate output and overlay amplification", async () => {
  const loop = await fixture().shell.execute({
    command: "while true; do :; done",
    cwd: "/project",
  });
  assert.notEqual(loop.exitCode, 0);
  assert.match(loop.stderr, /too many commands|limit/u);

  const outputShell = new ProjectShell({
    fileSystem: new MemoryProjectFileSystem(),
    limits: { maxOutputBytes: 32 },
    commands: { big: () => ({ stdout: "x".repeat(1_000) }) },
  });
  const output = await outputShell.execute({ command: "big" });
  assert.notEqual(output.exitCode, 0);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /output size exceeded|output limit/u);

  const overlayBase = new MemoryProjectFileSystem({
    "/project/blob.txt": "x".repeat(32),
  });
  const overlayShell = new ProjectShell({
    fileSystem: overlayBase,
    root: "/project",
    limits: { maxProjectBytes: 64 },
  });
  const overlay = await overlayShell.execute({
    command:
      "cat blob.txt >> blob.txt; cat blob.txt >> blob.txt; cat blob.txt >> blob.txt",
    cwd: "/project",
  });
  assert.notEqual(overlay.exitCode, 0);
  for (const change of overlay.changes) {
    assert.ok((change.after?.length ?? 0) <= 64);
  }
  assert.equal((await overlayBase.readFile("/project/blob.txt")).length, 32);
});

test("gzip works in pipelines but binary file writes never become text patches", async () => {
  const { fileSystem, shell } = fixture();
  const roundTrip = await shell.execute({
    command: "printf hello | gzip | gunzip",
    cwd: "/project",
  });
  assert.equal(roundTrip.exitCode, 0);
  assert.equal(roundTrip.stdout, "hello");

  const binaryWrite = await shell.execute({
    command: "gzip notes.txt",
    cwd: "/project",
  });
  assert.notEqual(binaryWrite.exitCode, 0);
  assert.match(binaryWrite.stderr, /text Diff|binary/u);
  assert.deepEqual(binaryWrite.changes, []);
  assert.equal(
    await fileSystem.readFile("/project/notes.txt"),
    "draft\nalpha\nalpha\nzeta\n",
  );
});

test("AbortError propagates while ordinary command failures stay typed", async () => {
  const { shell } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    shell.execute({
      command: "cat notes.txt",
      cwd: "/project",
      signal: controller.signal,
    }),
    (error) => error instanceof Error && error.name === "AbortError",
  );

  const missing = await shell.execute({
    command: "cat missing.txt",
    cwd: "/project",
  });
  assert.notEqual(missing.exitCode, 0);
});

test("constructor accepts only mobile-safe limit reductions and absolute roots", () => {
  const fileSystem = new MemoryProjectFileSystem();
  assert.throws(
    () => new ProjectShell({ fileSystem, root: "project" }),
    /absolute path/u,
  );
  assert.throws(
    () => new ProjectShell({ fileSystem, root: "/project/../outside" }),
    /normalized/u,
  );
  assert.throws(
    () =>
      new ProjectShell({
        fileSystem,
        limits: { maxExecutionTimeMs: 15_001 },
      }),
    /mobile maximum/u,
  );
});

test("directory ordering is independent of the device locale", async () => {
  const fileSystem = new MemoryProjectFileSystem({
    "/中": "",
    "/a": "",
    "/é": "",
    "/😀": "",
  });
  assert.deepEqual(
    (await fileSystem.readDirectory("/")).map((entry) => entry.name),
    ["a", "é", "中", "😀"],
  );
});
