import assert from "node:assert/strict";
import test from "node:test";

import { gzipSync } from "fflate";
import type { Command } from "just-bash/browser";

import {
  createProjectShellExtraCommands,
  createSqlite3Command,
  createTarCommand,
  createXanCommand,
  createYqCommand,
  DEFAULT_EXTRA_LIMITS,
  type ProjectShellSqliteAdapter,
  type SqliteExecutionResult,
} from "./index.ts";
import { FakeExtraFileSystem, testContext } from "./test-helpers.ts";

test("factory exposes four untrusted commands and validates every limit", () => {
  const commands = createProjectShellExtraCommands();
  const upstreamCompatible: readonly Command[] = commands;
  assert.equal(upstreamCompatible.length, 4);
  assert.deepEqual(
    commands.map(({ name }) => name),
    ["tar", "yq", "xan", "sqlite3"],
  );
  assert.ok(commands.every(({ trusted }) => trusted === false));
  assert.throws(
    () => createProjectShellExtraCommands({ limits: { maxInputBytes: 0 } }),
    /positive safe integer/,
  );
});

test("tar creates deterministic USTAR, lists it, and extracts through the VFS", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/source/a.txt": "alpha\n",
    "/project/source/sub/b.txt": "beta\n",
  });
  const command = createTarCommand({ ...DEFAULT_EXTRA_LIMITS });
  const context = testContext(fs);
  const first = await command.execute(
    ["-cf", "/project/one.tar", "-C", "/project/source", "a.txt", "sub"],
    context,
  );
  const second = await command.execute(
    ["-cf", "/project/two.tar", "-C", "/project/source", "a.txt", "sub"],
    context,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.deepEqual(
    await fs.readFileBuffer("/project/one.tar"),
    await fs.readFileBuffer("/project/two.tar"),
  );

  const listed = await command.execute(["-tf", "/project/one.tar"], context);
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(listed.stdout, "a.txt\nsub\nsub/b.txt\n");

  const extracted = await command.execute(
    ["-xf", "/project/one.tar", "-C", "/project/restored"],
    context,
  );
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.equal(await fs.readFile("/project/restored/a.txt"), "alpha\n");
  assert.equal(await fs.readFile("/project/restored/sub/b.txt"), "beta\n");
});

test("tar rejects traversal before writing any extracted member", async () => {
  const source = new FakeExtraFileSystem({ "/project/file": "secret" });
  const command = createTarCommand({ ...DEFAULT_EXTRA_LIMITS });
  await command.execute(
    ["-cf", "/project/archive.tar", "-C", "/project", "file"],
    testContext(source),
  );
  const archive = await source.readFileBuffer("/project/archive.tar");
  archive.fill(0, 0, 100);
  archive.set(new TextEncoder().encode("../escape"), 0);
  archive.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of archive.subarray(0, 512)) checksum += byte;
  archive.set(
    new TextEncoder().encode(`${checksum.toString(8).padStart(6, "0")}\0 `),
    148,
  );
  const destination = new FakeExtraFileSystem({
    "/project/archive.tar": archive,
  });
  const result = await command.execute(
    ["-xf", "/project/archive.tar", "-C", "/project/output"],
    testContext(destination),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /unsafe archive path/);
  assert.equal(await destination.exists("/project/output/file"), false);
  assert.equal(await destination.exists("/project/escape"), false);
});

test("tar streaming gzip decode enforces the expanded-data limit", async () => {
  const creatorFs = new FakeExtraFileSystem({
    "/project/large": "x".repeat(8_192),
  });
  const creator = createTarCommand({
    ...DEFAULT_EXTRA_LIMITS,
    maxExtractedBytes: 16_384,
  });
  const created = await creator.execute(
    ["-czf", "/project/archive.tgz", "-C", "/project", "large"],
    testContext(creatorFs),
  );
  assert.equal(created.exitCode, 0, created.stderr);
  const archive = await creatorFs.readFileBuffer("/project/archive.tgz");
  assert.ok(archive.byteLength < 8_192);
  const extractorFs = new FakeExtraFileSystem({
    "/project/archive.tgz": archive,
  });
  const extractor = createTarCommand({
    ...DEFAULT_EXTRA_LIMITS,
    maxExtractedBytes: 128,
    maxArchiveEntries: 2,
  });
  const result = await extractor.execute(
    ["-xzf", "/project/archive.tgz", "-C", "/project/out"],
    testContext(extractorFs),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /limit exceeded/);
  assert.equal(await extractorFs.exists("/project/out/large"), false);
});

test("tar validates existing symlink parents before its first extraction write", async () => {
  const creatorFs = new FakeExtraFileSystem({
    "/project/source/a.txt": "safe",
    "/project/source/link/file.txt": "must not escape",
  });
  const command = createTarCommand({ ...DEFAULT_EXTRA_LIMITS });
  const created = await command.execute(
    ["-cf", "/project/archive.tar", "-C", "/project/source", "a.txt", "link"],
    testContext(creatorFs),
  );
  assert.equal(created.exitCode, 0, created.stderr);
  const destination = new FakeExtraFileSystem({
    "/project/archive.tar": await creatorFs.readFileBuffer(
      "/project/archive.tar",
    ),
  });
  destination.seedSymlink("/project/out/link", "/project/outside");
  const result = await command.execute(
    ["-xf", "/project/archive.tar", "-C", "/project/out"],
    testContext(destination),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(await destination.exists("/project/out/a.txt"), false);
  assert.equal(await destination.exists("/project/outside/file.txt"), false);
});

test("yq parses YAML and delegates a non-trivial filter through argv-safe jq exec", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.yaml": "users:\n  - name: Alice\n  - name: Bob\n",
  });
  let observedArgs: string[] | undefined;
  const command = createYqCommand({ ...DEFAULT_EXTRA_LIMITS });
  const result = await command.execute(
    ["-o", "json", ".users[1].name", "/project/data.yaml"],
    testContext(fs, "", {
      exec: async (name, options) => {
        assert.equal(name, "jq");
        observedArgs = options.args;
        assert.deepEqual(JSON.parse(options.stdin ?? ""), {
          users: [{ name: "Alice" }, { name: "Bob" }],
        });
        return { stdout: '"Bob"\n', stderr: "", exitCode: 0 };
      },
    }),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(observedArgs, ["-c", ".users[1].name"]);
  assert.equal(result.stdout, '"Bob"\n');
});

test("yq in-place writes only the VFS and XML entities fail closed", async () => {
  const fs = new FakeExtraFileSystem({ "/project/data.json": '{"value":1}' });
  const command = createYqCommand({ ...DEFAULT_EXTRA_LIMITS });
  const updated = await command.execute(
    ["-p", "json", "-o", "json", "-i", ".value = 2", "/project/data.json"],
    testContext(fs, "", {
      exec: async () => ({ stdout: '{"value":2}\n', stderr: "", exitCode: 0 }),
    }),
  );
  assert.equal(updated.exitCode, 0, updated.stderr);
  assert.equal(await fs.readFile("/project/data.json"), '{\n  "value": 2\n}\n');

  const entity = await command.execute(
    ["-p", "xml", "."],
    testContext(fs, "<!DOCTYPE x [<!ENTITY e 'boom'>]><x>&e;</x>"),
  );
  assert.notEqual(entity.exitCode, 0);
  assert.match(entity.stderr, /entities/);
});

test("xan covers common CSV operations and preserves UTF-8 pipeline text", async () => {
  const command = createXanCommand({ ...DEFAULT_EXTRA_LIMITS });
  const fs = new FakeExtraFileSystem({
    "/project/users.csv":
      "name,age,city\nAlice,30,上海\nBob,20,北京\nCarol,40,上海\n",
  });
  const selected = await command.execute(
    ["select", "name,city", "/project/users.csv"],
    testContext(fs),
  );
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.equal(
    selected.stdout,
    "name,city\nAlice,上海\nBob,北京\nCarol,上海\n",
  );

  const sorted = await command.execute(
    ["sort", "-s", "age", "-N", "-R", "/project/users.csv"],
    testContext(fs),
  );
  assert.equal(sorted.exitCode, 0, sorted.stderr);
  assert.match(sorted.stdout, /^name,age,city\nCarol,40,上海\n/);

  const counted = await command.execute(
    ["count"],
    testContext(fs, "city\n上海\n北京\n"),
  );
  assert.equal(counted.stdout, "2\n");

  const filtered = await command.execute(
    ["filter", "age >= 30", "/project/users.csv"],
    testContext(fs),
  );
  assert.equal(filtered.exitCode, 0, filtered.stderr);
  assert.equal(
    filtered.stdout,
    "name,age,city\nAlice,30,上海\nCarol,40,上海\n",
  );
});

test("xan rejects oversized derived output before returning it", async () => {
  const command = createXanCommand({
    ...DEFAULT_EXTRA_LIMITS,
    maxOutputBytes: 24,
  });
  const result = await command.execute(
    ["explode", "tags"],
    testContext(new FakeExtraFileSystem(), "id,tags\n1,a|b|c|d|e|f\n"),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /limit exceeded/);

  const widened = createXanCommand({
    ...DEFAULT_EXTRA_LIMITS,
    maxCsvCells: 10,
  });
  const selected = await widened.execute(
    ["select", "*,*,*,*"],
    testContext(new FakeExtraFileSystem(), "a,b\n1,2\n3,4\n"),
  );
  assert.notEqual(selected.exitCode, 0);
  assert.match(selected.stderr, /derived CSV cell limit exceeded/);
});

test("sqlite3 is honest when absent and rejects mutation before adapter execution", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.db": new Uint8Array([1, 2, 3]),
  });
  const absent = createSqlite3Command({ ...DEFAULT_EXTRA_LIMITS }, undefined);
  const unavailable = await absent.execute(
    ["/project/data.db", "SELECT 1"],
    testContext(fs),
  );
  assert.equal(unavailable.exitCode, 127);

  let calls = 0;
  const adapter: ProjectShellSqliteAdapter = {
    async execute() {
      calls++;
      return { resultSets: [], changed: false };
    },
  };
  const readOnly = createSqlite3Command({ ...DEFAULT_EXTRA_LIMITS }, adapter);
  const denied = await readOnly.execute(
    ["/project/data.db", "DELETE FROM items"],
    testContext(fs),
  );
  assert.equal(denied.exitCode, 126);
  assert.equal(calls, 0);
  assert.deepEqual(
    await fs.readFileBuffer("/project/data.db"),
    new Uint8Array([1, 2, 3]),
  );
});

test("sqlite3 formats a bounded read-only native result without touching database bytes", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.db": new Uint8Array([1]),
  });
  const adapter: ProjectShellSqliteAdapter = {
    async execute(input) {
      assert.equal(input.readOnly, true);
      assert.equal(input.timeoutMs, DEFAULT_EXTRA_LIMITS.maxSqlTimeMs);
      return {
        resultSets: [{ columns: ["rows"], rows: [[1]] }],
        changed: false,
      };
    },
  };
  const command = createSqlite3Command({ ...DEFAULT_EXTRA_LIMITS }, adapter);
  const result = await command.execute(
    ["-header", "/project/data.db", "SELECT count(*) AS rows FROM items"],
    testContext(fs),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "rows\n1\n");
  assert.deepEqual(
    await fs.readFileBuffer("/project/data.db"),
    new Uint8Array([1]),
  );
});

test("sqlite3 rejects an oversized adapter response without staging bytes", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.db": new Uint8Array([1]),
  });
  const adapter: ProjectShellSqliteAdapter = {
    async execute() {
      return {
        resultSets: [{ columns: ["value"], rows: [["too large"]] }],
        changed: false,
      };
    },
  };
  const command = createSqlite3Command(
    { ...DEFAULT_EXTRA_LIMITS, maxSqlCellBytes: 3 },
    adapter,
  );
  const result = await command.execute(
    ["/project/data.db", "SELECT value FROM data"],
    testContext(fs),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /limit exceeded/);
  assert.deepEqual(
    await fs.readFileBuffer("/project/data.db"),
    new Uint8Array([1]),
  );

  const aggregateAdapter: ProjectShellSqliteAdapter = {
    async execute() {
      return {
        resultSets: [{ columns: ["value"], rows: [["1234"], ["5678"]] }],
        changed: false,
      };
    },
  };
  const aggregateCommand = createSqlite3Command(
    { ...DEFAULT_EXTRA_LIMITS, maxOutputBytes: 10 },
    aggregateAdapter,
  );
  const aggregateResult = await aggregateCommand.execute(
    ["/project/data.db", "SELECT value FROM data"],
    testContext(fs),
  );
  assert.notEqual(aggregateResult.exitCode, 0);
  assert.match(aggregateResult.stderr, /aggregate result/);
});

test("sqlite3 rejects a write-capable adapter response at the trust boundary", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.db": new Uint8Array([1]),
  });
  const adapter: ProjectShellSqliteAdapter = {
    async execute() {
      return {
        resultSets: [],
        changed: true,
        database: new Uint8Array([2]),
      } as unknown as SqliteExecutionResult;
    },
  };
  const command = createSqlite3Command({ ...DEFAULT_EXTRA_LIMITS }, adapter);
  const result = await command.execute(
    ["/project/data.db", "SELECT 1"],
    testContext(fs),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /invalid SQLite adapter result/);
  assert.deepEqual(
    await fs.readFileBuffer("/project/data.db"),
    new Uint8Array([1]),
  );
});

test("sqlite3 timeout returns without allowing a late adapter result to write VFS", async () => {
  const fs = new FakeExtraFileSystem({
    "/project/data.db": new Uint8Array([1]),
  });
  const adapter: ProjectShellSqliteAdapter = {
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { resultSets: [], changed: false };
    },
  };
  const command = createSqlite3Command(
    { ...DEFAULT_EXTRA_LIMITS, maxSqlTimeMs: 5 },
    adapter,
  );
  const result = await command.execute(
    ["/project/data.db", "SELECT x FROM data"],
    testContext(fs),
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    await fs.readFileBuffer("/project/data.db"),
    new Uint8Array([1]),
  );
});

test("gzip fixture used by tests is generated without a native codec", () => {
  const compressed = gzipSync(new TextEncoder().encode("fixture"), {
    mtime: 0,
  });
  assert.equal(compressed[0], 0x1f);
  assert.equal(compressed[1], 0x8b);
});
