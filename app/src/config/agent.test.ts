import assert from "node:assert/strict";
import test from "node:test";

import { getAgentConfig } from "./agent.ts";

test("agent configuration has a bounded default inactivity timeout", () => {
  const config = getAgentConfig();

  assert.equal(config.runTimeoutMs, 600_000);
});

test("agent timeout accepts no build-environment override", () => {
  assert.equal(getAgentConfig.length, 0);
  assert.equal(getAgentConfig().runTimeoutMs, 600_000);
});
