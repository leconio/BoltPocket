import assert from "node:assert/strict";
import test from "node:test";

import { createIosSafariUserAgent } from "./browser-user-agent.ts";

test("iOS web tasks use a Safari-shaped browser identity", () => {
  assert.equal(
    createIosSafariUserAgent("26.5"),
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  );
  assert.equal(
    createIosSafariUserAgent(17),
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
});

test("invalid platform versions use the oldest supported Safari identity", () => {
  assert.match(createIosSafariUserAgent("unknown"), /iPhone OS 17_0/u);
  assert.match(createIosSafariUserAgent("unknown"), /Version\/17\.0/u);
});
