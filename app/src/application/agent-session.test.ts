import assert from "node:assert/strict";
import test from "node:test";

import { agentSessionIdForConversation } from "./agent-session.ts";

test("agent history is stable within one conversation", () => {
  assert.equal(
    agentSessionIdForConversation("conversation-launch"),
    agentSessionIdForConversation("conversation-launch"),
  );
});

test("conversations remain isolated even when they belong to one project", () => {
  assert.notEqual(
    agentSessionIdForConversation("conversation-launch"),
    agentSessionIdForConversation("conversation-support"),
  );
});

test("an empty conversation cannot silently create a shared agent session", () => {
  assert.throws(
    () => agentSessionIdForConversation("  "),
    /conversation ID is required/u,
  );
});
