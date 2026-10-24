import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptBoltPocketSshNativeModule,
  createBoltPocketSshProjectShellTransport,
  type BoltPocketSshNativeModulePort,
  SshProjectShellNativeTransportError,
} from "./boltpocket-ssh-project-shell-transport.ts";
import type { SshProjectShellExecuteOptions } from "./ssh-project-shell-commands.ts";

class FakeBoltPocketSshModule implements BoltPocketSshNativeModulePort {
  isAvailable = true;
  readonly calls: string[] = [];
  lastCommand = "";
  lastExecuteOptions: SshProjectShellExecuteOptions | null = null;
  executeResult: unknown = {
    stdout: "=== identity_and_os ===\nFixture Linux\n",
    stderr: "",
    exitCode: 0,
  };
  statResult: unknown = {
    path: "/srv/project/file.txt",
    name: "file.txt",
    type: "file",
    size: 5,
    mode: 0o644,
  };
  listResult: unknown = [this.statResult];
  readResult: unknown = "hello";
  failure: Error | null = null;

  async execute(
    sessionId: string,
    command: string,
    options: SshProjectShellExecuteOptions,
  ): Promise<unknown> {
    this.calls.push(
      `execute:${sessionId}:${options.maxOutputBytes}:${options.timeoutMs}`,
    );
    this.lastCommand = command;
    this.lastExecuteOptions = options;
    this.throwFailure();
    return this.executeResult;
  }

  async stat(sessionId: string, path: string): Promise<unknown> {
    this.calls.push(`stat:${sessionId}:${path}`);
    this.throwFailure();
    return this.statResult;
  }

  async list(sessionId: string, path: string): Promise<unknown> {
    this.calls.push(`list:${sessionId}:${path}`);
    this.throwFailure();
    return this.listResult;
  }

  async readText(
    sessionId: string,
    path: string,
    maxBytes: number,
  ): Promise<unknown> {
    this.calls.push(`read:${sessionId}:${path}:${maxBytes}`);
    this.throwFailure();
    return this.readResult;
  }

  private throwFailure(): void {
    if (this.failure) throw this.failure;
  }
}

test("maps complete command execution, fixed diagnosis, and file reads to the native API", async () => {
  const nativeModule = new FakeBoltPocketSshModule();
  const transport = await createBoltPocketSshProjectShellTransport(nativeModule);

  assert.deepEqual(await transport.diagnose("session-a"), {
    stdout: "=== identity_and_os ===\nFixture Linux\n",
    stderr: "",
    exitCode: 0,
  });
  const diagnosticCommand = nativeModule.lastCommand;
  assert.deepEqual(
    await transport.stat("session-a", "/srv/project/file.txt"),
    nativeModule.statResult,
  );
  assert.deepEqual(
    await transport.list("session-a", "/srv/project"),
    nativeModule.listResult,
  );
  assert.equal(
    await transport.readText("session-a", "/srv/project/file.txt", 100),
    "hello",
  );
  assert.deepEqual(
    await transport.execute("session-a", "cat > /tmp/config && id", {
      stdin: "value=1\n",
      maxOutputBytes: 200_000,
      timeoutMs: 60_000,
    }),
    nativeModule.executeResult,
  );
  assert.deepEqual(nativeModule.calls, [
    "execute:session-a:512000:30000",
    "stat:session-a:/srv/project/file.txt",
    "list:session-a:/srv/project",
    "read:session-a:/srv/project/file.txt:100",
    "execute:session-a:200000:60000",
  ]);
  assert.equal(nativeModule.lastCommand, "cat > /tmp/config && id");
  assert.deepEqual(nativeModule.lastExecuteOptions, {
    stdin: "value=1\n",
    maxOutputBytes: 200_000,
    timeoutMs: 60_000,
  });
  assert.match(diagnosticCommand, /uname -a/u);
  assert.match(diagnosticCommand, /free -h/u);
  assert.match(diagnosticCommand, /systemctl --failed/u);
  assert.match(diagnosticCommand, /journalctl --priority=0\.\.3/u);
  assert.deepEqual(Object.keys(transport).sort(), [
    "diagnose",
    "execute",
    "list",
    "readText",
    "stat",
  ]);
});

test("an already aborted signal prevents every native call", async () => {
  const nativeModule = new FakeBoltPocketSshModule();
  const transport = adaptBoltPocketSshNativeModule(nativeModule);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    transport.execute(
      "session-a",
      "id",
      { maxOutputBytes: 100, timeoutMs: 1_000 },
      controller.signal,
    ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    transport.diagnose("session-a", controller.signal),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    transport.stat("session-a", "/srv/project/file.txt", controller.signal),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    transport.list("session-a", "/srv/project", controller.signal),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    transport.readText(
      "session-a",
      "/srv/project/file.txt",
      100,
      controller.signal,
    ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(nativeModule.calls.length, 0);
});

test("read operations observe cancellation after an in-flight native result", async () => {
  const nativeModule = new FakeBoltPocketSshModule();
  const controller = new AbortController();
  nativeModule.readText = async (sessionId, path, maxBytes) => {
    nativeModule.calls.push(`read:${sessionId}:${path}:${maxBytes}`);
    controller.abort();
    return "late text";
  };
  const transport = adaptBoltPocketSshNativeModule(nativeModule);

  await assert.rejects(
    transport.readText(
      "session-a",
      "/srv/project/file.txt",
      100,
      controller.signal,
    ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.deepEqual(nativeModule.calls, [
    "read:session-a:/srv/project/file.txt:100",
  ]);
});

test("native errors are normalized and discard sensitive native messages", async () => {
  const nativeModule = new FakeBoltPocketSshModule();
  nativeModule.failure = new Error(
    "Authentication denied for secret-user@private-host /srv/project/file.txt",
  );
  const transport = adaptBoltPocketSshNativeModule(nativeModule);

  await assert.rejects(
    transport.readText("session-secret", "/srv/project/file.txt", 100),
    (error: unknown) => {
      assert.ok(error instanceof SshProjectShellNativeTransportError);
      assert.equal(error.code, "permission_denied");
      assert.equal(error.operation, "read");
      assert.doesNotMatch(
        error.message,
        /secret-user|private-host|session-secret|srv\/project/u,
      );
      return true;
    },
  );
});

test("unavailable modules, invalid paths, and invalid responses fail closed", async () => {
  const nativeModule = new FakeBoltPocketSshModule();
  nativeModule.isAvailable = false;
  const unavailable = adaptBoltPocketSshNativeModule(nativeModule);
  await assert.rejects(
    unavailable.list("session-a", "/srv/project"),
    (error: unknown) => {
      assert.ok(error instanceof SshProjectShellNativeTransportError);
      assert.equal(error.code, "unavailable");
      return true;
    },
  );
  assert.equal(nativeModule.calls.length, 0);

  nativeModule.isAvailable = true;
  const transport = adaptBoltPocketSshNativeModule(nativeModule);
  await assert.rejects(
    transport.stat("session-a", "/srv/project/../secret"),
    (error: unknown) => {
      assert.ok(error instanceof SshProjectShellNativeTransportError);
      assert.equal(error.code, "invalid_request");
      return true;
    },
  );
  assert.equal(nativeModule.calls.length, 0);

  nativeModule.listResult = [
    {
      path: "/srv/project/../secret",
      name: "secret",
      type: "file",
      size: 1,
    },
  ];
  await assert.rejects(
    transport.list("session-a", "/srv/project"),
    (error: unknown) => {
      assert.ok(error instanceof SshProjectShellNativeTransportError);
      assert.equal(error.code, "invalid_response");
      assert.equal(error.operation, "list");
      return true;
    },
  );

  nativeModule.executeResult = {
    stdout: "ok\0not-text",
    stderr: "",
    exitCode: 0,
  };
  await assert.rejects(transport.diagnose("session-a"), (error: unknown) => {
    assert.ok(error instanceof SshProjectShellNativeTransportError);
    assert.equal(error.code, "invalid_response");
    assert.equal(error.operation, "diagnose");
    return true;
  });

  await assert.rejects(
    transport.execute("session-a", "id", {
      maxOutputBytes: 100,
      timeoutMs: 1_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SshProjectShellNativeTransportError);
      assert.equal(error.code, "invalid_response");
      assert.equal(error.operation, "execute");
      return true;
    },
  );
});
