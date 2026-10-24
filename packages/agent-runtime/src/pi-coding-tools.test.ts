import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptPiCodingToolDefinition,
  createAllToolDefinitions,
} from "./pi-coding-tools.ts";

test("mobile bridge preserves every upstream Pi Coding Agent definition", () => {
  const files = new Map([["/project/a.txt", "alpha\n"]]);
  const definitions = createAllToolDefinitions("/project", {
    read: {
      operations: {
        access: async () => undefined,
        readFile: async (path) => Buffer.from(files.get(path) ?? ""),
      },
    },
    bash: {
      environment: {},
      exposeSessionEnvironment: false,
      persistTruncatedOutput: false,
      operations: {
        exec: async () => ({ exitCode: 0 }),
      },
    },
    edit: {
      operations: {
        access: async () => undefined,
        readFile: async (path) => Buffer.from(files.get(path) ?? ""),
        writeFile: async (path, content) => {
          files.set(path, content);
        },
      },
    },
    write: {
      operations: {
        mkdir: async () => undefined,
        writeFile: async (path, content) => {
          files.set(path, content);
        },
      },
    },
    grep: {
      operations: {
        isDirectory: async () => true,
        readFile: async (path) => files.get(path) ?? "",
        search: async () => ({ matches: [] }),
      },
    },
    find: {
      operations: {
        exists: async () => true,
        glob: async () => [],
      },
    },
    ls: {
      operations: {
        exists: async () => true,
        stat: async () => ({ isDirectory: () => true }),
        readdir: async () => [],
      },
    },
  });

  const names = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
  ] as const;
  for (const name of names) {
    const runtime = adaptPiCodingToolDefinition(definitions[name], {
      risk: ["bash", "edit", "write"].includes(name) ? "propose" : "read",
    });
    assert.equal(runtime.name, name);
    assert.equal(runtime.parameters, definitions[name].parameters);
    assert.equal(runtime.description, definitions[name].description);
    assert.equal(runtime.prepareArguments, definitions[name].prepareArguments);
  }
});

test("upstream edit argument preparation and unified patch survive the bridge", async () => {
  let content = "alpha\nsecond\n";
  const definition = createAllToolDefinitions("/project", {
    edit: {
      operations: {
        access: async () => undefined,
        readFile: async () => Buffer.from(content),
        writeFile: async (_path, next) => {
          content = next;
        },
      },
    },
  }).edit;
  const runtime = adaptPiCodingToolDefinition(definition, { risk: "propose" });
  const prepared = runtime.prepareArguments?.({
    path: "/project/a.txt",
    oldText: "alpha",
    newText: "beta",
  });
  assert.deepEqual(prepared, {
    path: "/project/a.txt",
    edits: [{ oldText: "alpha", newText: "beta" }],
  });

  const result = await runtime.execute(prepared!, {
    sessionId: "session",
    toolCallId: "edit-1",
    update: () => undefined,
  });
  assert.equal(content, "beta\nsecond\n");
  assert.match(result.content, /Successfully replaced 1 block/u);
  assert.match((result.details as { patch: string }).patch, /-alpha/u);
  assert.match((result.details as { patch: string }).patch, /\+beta/u);
});

test("mobile grep backend executes without a native ripgrep process", async () => {
  const source = ["before", "const Needle = true;", "after"].join("\n");
  let searchInput: unknown;
  const definition = createAllToolDefinitions("/project", {
    grep: {
      operations: {
        isDirectory: async () => true,
        readFile: async () => source,
        search: async (input) => {
          searchInput = input;
          return {
            matches: [
              {
                filePath: "/project/src/example.ts",
                lineNumber: 2,
                lineText: "const Needle = true;",
              },
            ],
          };
        },
      },
    },
  }).grep;
  const runtime = adaptPiCodingToolDefinition(definition, { risk: "read" });

  const result = await runtime.execute(
    {
      pattern: "needle",
      path: "src",
      ignoreCase: true,
      literal: true,
      context: 1,
      limit: 20,
    },
    {
      sessionId: "session",
      toolCallId: "grep-1",
      update: () => undefined,
    },
  );

  assert.deepEqual(searchInput, {
    pattern: "needle",
    path: "/project/src",
    glob: undefined,
    ignoreCase: true,
    literal: true,
    limit: 20,
    signal: undefined,
  });
  assert.match(result.content, /example\.ts-1- before/u);
  assert.match(result.content, /example\.ts:2: const Needle = true;/u);
  assert.match(result.content, /example\.ts-3- after/u);
});

test("mobile bash uses an explicit environment and never exposes a temp output path", async () => {
  let received:
    | {
        command: string;
        cwd: string;
        env: NodeJS.ProcessEnv | undefined;
      }
    | undefined;
  const definition = createAllToolDefinitions("/project", {
    bash: {
      environment: { BOLTPOCKET_SANDBOX: "enabled" },
      exposeSessionEnvironment: false,
      persistTruncatedOutput: false,
      operations: {
        exec: async (command, cwd, options) => {
          received = { command, cwd, env: options.env };
          options.onData(Buffer.from("x".repeat(70 * 1024)));
          return { exitCode: 0 };
        },
      },
    },
  }).bash;
  const runtime = adaptPiCodingToolDefinition(definition, { risk: "propose" });

  const result = await runtime.execute(
    { command: "generate-large-output" },
    {
      sessionId: "session",
      toolCallId: "bash-1",
      update: () => undefined,
    },
  );

  assert.deepEqual(received, {
    command: "generate-large-output",
    cwd: "/project",
    env: { BOLTPOCKET_SANDBOX: "enabled" },
  });
  assert.equal(
    (result.details as { fullOutputPath?: string } | undefined)?.fullOutputPath,
    undefined,
  );
  assert.doesNotMatch(result.content, /Full output:/u);
  assert.match(result.content, /Showing last/u);
});
