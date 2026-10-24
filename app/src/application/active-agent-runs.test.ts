import assert from "node:assert/strict";
import test from "node:test";

import { ActiveAgentRunRegistry } from "./active-agent-runs.ts";

function run(conversationId: string) {
  return {
    runId: `run-${conversationId}`,
    conversationId,
    controller: new AbortController(),
    termination: null,
  } as const;
}

test("reserves three different conversations and rejects the fourth", () => {
  const registry = new ActiveAgentRunRegistry();
  assert.equal(registry.reserve(run("one")).accepted, true);
  assert.equal(registry.reserve(run("two")).accepted, true);
  assert.equal(registry.reserve(run("three")).accepted, true);
  assert.deepEqual(registry.reserve(run("four")), {
    accepted: false,
    reason: "capacity",
  });
  assert.equal(registry.size, 3);
});

test("never replaces an active run for the same conversation", () => {
  const registry = new ActiveAgentRunRegistry();
  const first = run("one");
  assert.equal(registry.reserve(first).accepted, true);
  assert.deepEqual(registry.reserve(run("one")), {
    accepted: false,
    reason: "already-active",
  });
  assert.equal(registry.get("one")?.controller, first.controller);
});

test("release reopens capacity and abort records why a run stopped", () => {
  const registry = new ActiveAgentRunRegistry();
  const one = run("one");
  registry.reserve(one);
  registry.reserve(run("two"));
  registry.reserve(run("three"));

  assert.equal(registry.abort("one", "interrupted"), one);
  assert.equal(one.controller.signal.aborted, true);
  assert.equal(one.termination, "interrupted");
  assert.equal(registry.release("one", one.controller), one);
  assert.equal(registry.reserve(run("four")).accepted, true);
});
