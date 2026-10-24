import assert from "node:assert/strict";
import test from "node:test";

import { MemoryProjectFileSystem, ProjectShell } from "@boltpocket/project-shell";

import type { SshCommandSession } from "../../application/ports/ssh-command-sessions.ts";
import type { WorkspaceResource } from "../../domain/models.ts";
import {
  createSshProjectShellCommands,
  type SshProjectShellEntry,
  type SshProjectShellExecuteOptions,
  type SshProjectShellTransport,
} from "./ssh-project-shell-commands.ts";

const ALIAS = "production";
const SESSION_ID = "native-session-a";
const REMOTE_ROOT = "/srv/project";

const session: SshCommandSession = {
  profileId: "ssh-0123456789abcdef",
  credentialId: "credential-01234567-89ab-4def-8123-456789abcdef",
  projectId: "project-a",
  alias: ALIAS,
  sessionId: SESSION_ID,
  root: REMOTE_ROOT,
  account: "deploy@server.internal:22",
  access: "session",
  verification: "ssh-ed25519 SHA256:fixture",
};

const localResource: WorkspaceResource = {
  id: "download",
  projectId: "project-a",
  connectionId: "local-fixture",
  path: "download.txt",
  content: "old download\n",
  version: "v1",
  storage: { kind: "memory" },
};

type RemoteNode = {
  type: SshProjectShellEntry["type"];
  contents?: string;
};

class FakeSshTransport implements SshProjectShellTransport {
  readonly calls: string[] = [];
  readonly executions: {
    sessionId: string;
    command: string;
    options: SshProjectShellExecuteOptions;
  }[] = [];
  readonly nodes = new Map<string, RemoteNode>([
    ["/", { type: "directory" }],
    ["/srv", { type: "directory" }],
    [REMOTE_ROOT, { type: "directory" }],
    [`${REMOTE_ROOT}/docs`, { type: "directory" }],
    [
      `${REMOTE_ROOT}/docs/notes.txt`,
      { type: "file", contents: "remote notes\n" },
    ],
    [`${REMOTE_ROOT}/docs/other.txt`, { type: "file", contents: "other\n" }],
    ["/etc", { type: "directory" }],
    [
      "/etc/os-release",
      { type: "file", contents: 'PRETTY_NAME="Fixture Linux"\n' },
    ],
  ]);

  async diagnose(sessionId: string) {
    this.calls.push(`diagnose:${sessionId}`);
    return {
      stdout:
        "=== identity_and_os ===\nPRETTY_NAME=Fixture Linux\n=== failed_services ===\n0 loaded units listed.\n",
      stderr: "",
      exitCode: 0,
    };
  }

  async execute(
    sessionId: string,
    command: string,
    options: SshProjectShellExecuteOptions,
  ) {
    this.calls.push(`execute:${sessionId}:${command}`);
    this.executions.push({ sessionId, command, options });
    return {
      stdout: command === "cat docs/notes.txt" ? "remote notes\n" : "ok\n",
      stderr: "",
      exitCode: 0,
    };
  }

  async stat(sessionId: string, path: string) {
    this.calls.push(`stat:${sessionId}:${path}`);
    const node = this.nodes.get(path);
    return node ? this.entry(path, node) : null;
  }

  async list(sessionId: string, path: string) {
    this.calls.push(`list:${sessionId}:${path}`);
    const prefix = `${path}/`;
    return [...this.nodes.entries()]
      .filter(
        ([candidate]) =>
          candidate.startsWith(prefix) &&
          !candidate.slice(prefix.length).includes("/"),
      )
      .map(([candidate, node]) => this.entry(candidate, node));
  }

  async readText(sessionId: string, path: string, maxBytes: number) {
    this.calls.push(`read:${sessionId}:${path}:${maxBytes}`);
    const node = this.nodes.get(path);
    if (node?.type !== "file" || node.contents === undefined) {
      throw new Error("not a file");
    }
    return node.contents;
  }

  private entry(path: string, node: RemoteNode): SshProjectShellEntry {
    return {
      path,
      name: path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1),
      type: node.type,
      size: node.contents?.length ?? 0,
    };
  }
}

test("SSH exposes the fixed diagnosis as an explicit shortcut", async () => {
  const { shell, transport } = shellFixture();

  const result = await shell.execute({
    command: `ssh ${ALIAS} diagnose`,
    cwd: "/project",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Fixture Linux/u);
  assert.deepEqual(transport.calls, [`diagnose:${SESSION_ID}`]);
  assert.equal(result.changes.length, 0);

  const missing = await shell.execute({
    command: `ssh ${ALIAS}`,
    cwd: "/project",
  });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stderr, /remote command/u);
});

function shellFixture(
  options: {
    transport?: FakeSshTransport;
    sessions?: SshCommandSession[];
    resources?: WorkspaceResource[];
  } = {},
) {
  const transport = options.transport ?? new FakeSshTransport();
  const resources = options.resources ?? [localResource];
  const fileSystem = new MemoryProjectFileSystem({
    "/project/download.txt": "old download\n",
    "/project/unselected.txt": "not selected\n",
  });
  const commands = createSshProjectShellCommands({
    sessions: options.sessions ?? [session],
    resources,
    transport,
    localRoot: "/project",
    localPathForResource: (resource) => `/project/${resource.path}`,
  });
  return {
    transport,
    fileSystem,
    shell: new ProjectShell({ fileSystem, root: "/project", commands }),
  };
}

test("SSH/SFTP reads use only the secure project command session", async () => {
  const { shell, transport } = shellFixture();

  const listed = await shell.execute({
    command: `sftp ${ALIAS} ls docs`,
    cwd: "/project",
  });
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(
    listed.stdout,
    [
      `file\t13\t${REMOTE_ROOT}/docs/notes.txt`,
      `file\t6\t${REMOTE_ROOT}/docs/other.txt`,
      "",
    ].join("\n"),
  );

  const read = await shell.execute({
    command: `ssh ${ALIAS} -- 'cat docs/notes.txt'`,
    cwd: "/project",
  });
  assert.equal(read.exitCode, 0, read.stderr);
  assert.equal(read.stdout, "remote notes\n");
  assert.equal(read.changes.length, 0);
  assert.ok(transport.calls.every((call) => call.includes(SESSION_ID)));
});

test("scp download writes only to an explicitly selected ProjectShell resource", async () => {
  const { shell, fileSystem, transport } = shellFixture();
  const result = await shell.execute({
    command: `scp ${ALIAS}:docs/notes.txt /project/download.txt`,
    cwd: "/project",
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.changes, [
    {
      path: "/project/download.txt",
      kind: "modified",
      before: "old download\n",
      after: "remote notes\n",
    },
  ]);
  assert.equal(
    await fileSystem.readFile("/project/download.txt"),
    "old download\n",
  );
  assert.ok(
    transport.calls.includes(
      `read:${SESSION_ID}:${REMOTE_ROOT}/docs/notes.txt:100000`,
    ),
  );

  transport.calls.length = 0;
  const rejected = await shell.execute({
    command: `scp ${ALIAS}:docs/notes.txt /project/unselected.txt`,
    cwd: "/project",
  });
  assert.notEqual(rejected.exitCode, 0);
  assert.match(rejected.stderr, /explicitly selected resource/i);
  assert.equal(transport.calls.length, 0);
});

test("remote reads are not sandboxed to the SSH login directory", async () => {
  const { shell, transport } = shellFixture();
  for (const command of [
    `sftp ${ALIAS} cat ../../etc/os-release`,
    `sftp ${ALIAS} cat /etc/os-release`,
  ]) {
    transport.calls.length = 0;
    const result = await shell.execute({ command, cwd: "/project" });
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stdout, 'PRETTY_NAME="Fixture Linux"\n');
    assert.ok(
      transport.calls.includes(`read:${SESSION_ID}:/etc/os-release:100000`),
      command,
    );
    assert.equal(result.changes.length, 0, command);
  }

  const sshResult = await shell.execute({
    command: `ssh ${ALIAS} -- 'cat /etc/os-release'`,
    cwd: "/project",
  });
  assert.equal(sshResult.exitCode, 0, sshResult.stderr);
  assert.deepEqual(transport.executions.at(-1), {
    sessionId: SESSION_ID,
    command: "cat /etc/os-release",
    options: { maxOutputBytes: 1_000_000, timeoutMs: 60_000 },
  });
});

test("remote parent traversal follows POSIX root semantics", async () => {
  const { shell, transport } = shellFixture();
  const result = await shell.execute({
    command: `sftp ${ALIAS} cat ../../../../etc/os-release`,
    cwd: "/project",
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'PRETTY_NAME="Fixture Linux"\n');
  assert.ok(
    transport.calls.includes(`read:${SESSION_ID}:/etc/os-release:100000`),
  );
});

test("SSH forwards complete remote commands and piped stdin", async () => {
  const { shell, transport } = shellFixture();

  const mutation = await shell.execute({
    command: `ssh ${ALIAS} -- 'touch /tmp/marker && systemctl restart app'`,
    cwd: "/project",
  });
  assert.equal(mutation.exitCode, 0, mutation.stderr);
  assert.deepEqual(transport.executions.at(-1), {
    sessionId: SESSION_ID,
    command: "touch /tmp/marker && systemctl restart app",
    options: { maxOutputBytes: 1_000_000, timeoutMs: 60_000 },
  });

  const upload = await shell.execute({
    command: `printf 'new config\\n' | ssh ${ALIAS} -- 'cat > /tmp/config'`,
    cwd: "/project",
  });
  assert.equal(upload.exitCode, 0, upload.stderr);
  assert.deepEqual(transport.executions.at(-1), {
    sessionId: SESSION_ID,
    command: "cat > /tmp/config",
    options: {
      stdin: "new config\n",
      maxOutputBytes: 1_000_000,
      timeoutMs: 60_000,
    },
  });

  const argv = await shell.execute({
    command: `ssh ${ALIAS} -- sh -lc 'printf "%s" "hello world"'`,
    cwd: "/project",
  });
  assert.equal(argv.exitCode, 0, argv.stderr);
  assert.equal(
    transport.executions.at(-1)?.command,
    `sh -lc 'printf "%s" "hello world"'`,
  );
});

test("structured SCP and SFTP mutations remain outside their download syntax", async () => {
  const { shell, transport } = shellFixture();
  for (const command of [
    `scp /project/download.txt ${ALIAS}:docs/notes.txt`,
    `sftp ${ALIAS} put /project/download.txt docs/notes.txt`,
    `sftp ${ALIAS} rm docs/notes.txt`,
  ]) {
    transport.calls.length = 0;
    const result = await shell.execute({ command, cwd: "/project" });
    assert.equal(result.exitCode, 126, command);
    assert.equal(result.changes.length, 0, command);
    assert.equal(transport.calls.length, 0, command);
  }
});

test("server-resolved readable paths are not blocked as symlinks", async () => {
  const transport = new FakeSshTransport();
  transport.nodes.set(`${REMOTE_ROOT}/docs/link.txt`, {
    type: "file",
    contents: "resolved target\n",
  });
  const { shell } = shellFixture({ transport });
  const result = await shell.execute({
    command: `sftp ${ALIAS} cat docs/link.txt`,
    cwd: "/project",
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "resolved target\n");
  assert.ok(transport.calls.some((call) => call.startsWith("read:")));
});

test("SSH command aliases cannot cross projects or map twice", () => {
  const transport = new FakeSshTransport();
  assert.throws(
    () =>
      createSshProjectShellCommands({
        sessions: [session, { ...session, projectId: "project-b" }],
        transport,
      }),
    /one current project/i,
  );
  assert.throws(
    () =>
      createSshProjectShellCommands({
        sessions: [session, { ...session, sessionId: "native-session-b" }],
        transport,
      }),
    /aliases must be unique/i,
  );
  assert.equal(transport.calls.length, 0);
});
