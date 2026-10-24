import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";
import { ProjectH5CapabilityConsentLedger } from "./project-h5-capability-consent.ts";
import { parseProjectH5Manifest } from "./project-h5-manifest.ts";

function snapshot(contentSha256: string) {
  return {
    contentSha256,
    app: parseProjectH5Manifest(
      JSON.stringify({
        schema: 3,
        title: "体感游戏",
        entry: "index.html",
        profile: "vanilla",
        addons: [],
        resources: [],
        permissions: [
          {
            id: "location",
            purpose: "显示附近门店",
            mode: "once",
            recipients: ["store-api"],
          },
          {
            id: "motionSensors",
            purpose: "控制当前角色",
            mode: "session",
            recipients: [],
          },
        ],
        network: [
          {
            id: "store-api",
            origin: "https://stores.example.com",
            purpose: "查询附近门店",
          },
        ],
      }),
      "index.html",
    ),
  } satisfies Pick<ProjectPreviewSnapshot, "contentSha256" | "app">;
}

test("requires per-request consent for once capabilities", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  const current = snapshot("a".repeat(64));
  const decision = ledger.state("task-1", current, "location");
  assert.equal(decision.state, "prompt");
  if (decision.state === "prompt")
    ledger.grant("task-1", current, decision.declaration);
  assert.equal(ledger.state("task-1", current, "location").state, "prompt");
});

test("binds a session grant to one task and exact content hash", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  const first = snapshot("a".repeat(64));
  const decision = ledger.state("task-1", first, "motionSensors");
  assert.equal(decision.state, "prompt");
  if (decision.state === "prompt")
    ledger.grant("task-1", first, decision.declaration);
  assert.equal(ledger.state("task-1", first, "motionSensors").state, "granted");
  assert.equal(
    ledger.state("task-1", snapshot("b".repeat(64)), "motionSensors").state,
    "prompt",
  );
  assert.equal(ledger.state("task-2", first, "motionSensors").state, "prompt");
  ledger.revokeTask("task-1");
  assert.equal(ledger.state("task-1", first, "motionSensors").state, "prompt");
});

test("denies undeclared capabilities", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  assert.equal(
    ledger.state("task-1", snapshot("a".repeat(64)), "camera").state,
    "undeclared",
  );
});

test("suppresses repeated prompts after a denial until the user resets it", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  const current = snapshot("a".repeat(64));
  const decision = ledger.state("task-1", current, "location");
  assert.equal(decision.state, "prompt");
  if (decision.state === "prompt") {
    ledger.deny("task-1", current, decision.declaration);
  }
  assert.equal(ledger.state("task-1", current, "location").state, "denied");
  ledger.resetCapability("task-1", current, "location");
  assert.equal(ledger.state("task-1", current, "location").state, "prompt");
});

test("requires content-bound consent before declared network access", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  const current = snapshot("a".repeat(64));
  assert.equal(ledger.networkState("task-1", current), "prompt");
  ledger.grantNetwork("task-1", current);
  assert.equal(ledger.networkState("task-1", current), "granted");
  assert.equal(
    ledger.networkState("task-1", snapshot("b".repeat(64))),
    "prompt",
  );
  ledger.revokeTask("task-1");
  assert.equal(ledger.networkState("task-1", current), "prompt");
});

test("revoking an old content version cannot erase a decision for its replacement", () => {
  const ledger = new ProjectH5CapabilityConsentLedger();
  const previous = snapshot("a".repeat(64));
  const current = snapshot("b".repeat(64));
  ledger.grantNetwork("task-1", previous);
  ledger.denyNetwork("task-1", current);

  ledger.revokeContent("task-1", previous.contentSha256);

  assert.equal(ledger.networkState("task-1", previous), "prompt");
  assert.equal(ledger.networkState("task-1", current), "denied");
});
