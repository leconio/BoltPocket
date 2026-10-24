import assert from "node:assert/strict";
import test from "node:test";

import type { McpToolApprovalRequest } from "@boltpocket/mcp-client";

import { McpToolApprovalBroker } from "./mcp-tool-approval-broker.ts";

const request: McpToolApprovalRequest = {
  approvalSessionId: "agent-session-1",
  arguments: { z: 2, a: { enabled: true } },
  projectId: "project-1",
  projectName: "Launch",
  risk: "write",
  serverId: "mcp-github",
  serverName: "GitHub",
  serverRevision: "revision-1",
  toolName: "create_issue",
  toolDefinitionRevision: '{"inputSchema":{"type":"object"}}',
  toolTitle: "Create issue",
};

const readRequest: McpToolApprovalRequest = {
  ...request,
  risk: "read",
  toolName: "get_issue",
  toolTitle: "Get issue",
};

async function queued() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function broker() {
  let sequence = 0;
  return new McpToolApprovalBroker({
    createRequestId: () => `approval-${(sequence += 1)}`,
    hashPatch: async () => "a".repeat(64),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
}

test("approval binds canonical arguments to a deterministic patch hash", async () => {
  const approval = broker();
  const decisionPromise = approval.authorize(request);
  await queued();
  const pending = approval.pending();
  assert.ok(pending);
  assert.equal(pending.patchHash, "a".repeat(64));
  assert.equal(pending.argumentsPreview, '{"a":{"enabled":true},"z":2}');
  assert.match(pending.patch, /mcp:\/\/mcp-github\/create_issue/u);
  assert.match(pending.patch, /revision-1/u);

  approval.approve(pending.requestId, "once");
  assert.deepEqual(await decisionPromise, { approved: true, scope: "once" });
});

test("session approval is scoped to session, server revision, and tool", async () => {
  const approval = broker();
  const first = approval.authorize(readRequest);
  await queued();
  approval.approve(approval.pending()!.requestId, "session");
  assert.deepEqual(await first, { approved: true, scope: "session" });

  assert.deepEqual(
    await approval.authorize({ ...readRequest, arguments: { z: 9 } }),
    {
      approved: true,
      scope: "session",
    },
  );
  const changedRevision = approval.authorize({
    ...readRequest,
    serverRevision: "revision-2",
  });
  await queued();
  assert.ok(approval.pending());
  approval.deny(approval.pending()!.requestId);
  assert.deepEqual(await changedRevision, { approved: false });
});

test("write approvals cannot persist for a session", async () => {
  const approval = broker();
  const first = approval.authorize(request);
  await queued();
  approval.approve(approval.pending()!.requestId, "session");
  assert.deepEqual(await first, { approved: true, scope: "once" });

  const second = approval.authorize(request);
  await queued();
  assert.ok(approval.pending());
  approval.deny(approval.pending()!.requestId);
  assert.deepEqual(await second, { approved: false });
});

test("abort and clearSession fail closed", async () => {
  const approval = broker();
  const controller = new AbortController();
  const pending = approval.authorize(request, controller.signal);
  await queued();
  controller.abort();
  assert.deepEqual(await pending, { approved: false });
  assert.equal(approval.pending(), null);

  const next = approval.authorize(request);
  await queued();
  approval.clearSession("agent-session-1");
  assert.deepEqual(await next, { approved: false });
});
