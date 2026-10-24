import assert from "node:assert/strict";
import test from "node:test";

import { SshCommandOperationCoordinator } from "./ssh-command-operation-coordinator.ts";

test("SSH session operations never reconnect during an active lease", async () => {
  const coordinator = new SshCommandOperationCoordinator();
  const events: string[] = [];
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = coordinator.run(async () => {
    events.push("apply-start");
    await blocked;
    events.push("apply-finish");
  });
  const second = coordinator.run(async () => {
    events.push("revalidate");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["apply-start"]);
  release?.();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["apply-start", "apply-finish", "revalidate"]);
});

test("a cancelled queued operation never acquires the session lease", async () => {
  const coordinator = new SshCommandOperationCoordinator();
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = coordinator.run(() => blocked);
  const queued = coordinator.run(async () => "unexpected", controller.signal);

  controller.abort();
  release?.();
  await first;
  await assert.rejects(queued, { name: "AbortError" });
});

test("one Agent run may reconnect through sshpass inside its own SSH lease", async () => {
  const coordinator = new SshCommandOperationCoordinator();
  const controller = new AbortController();
  const events: string[] = [];

  const result = await coordinator.run(async () => {
    events.push("run-start");
    const session = await coordinator.run(async () => {
      events.push("sshpass-connect");
      return "session-ready";
    }, controller.signal);
    events.push("run-finish");
    return session;
  }, controller.signal);

  assert.equal(result, "session-ready");
  assert.deepEqual(events, ["run-start", "sshpass-connect", "run-finish"]);
});
