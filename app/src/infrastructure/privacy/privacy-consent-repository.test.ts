import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadComplianceConfig } from "@/config/compliance";

import {
  MAINLAND_PRIVACY_POLICY_VERSION,
  parsePrivacyConsentRecord,
  PrivacyConsentRepository,
} from "./privacy-consent-repository.ts";

class MemorySecureStore {
  readonly values = new Map<string, string>();
  available = true;

  async isAvailableAsync() {
    return this.available;
  }

  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string) {
    this.values.set(key, value);
  }
}

const digestSha256 = async (value: string) =>
  createHash("sha256").update(value).digest("hex");

function mainlandConfig(operatorName = "测试运营者") {
  return loadComplianceConfig({
    distributionRegion: "china-mainland",
    operatorName,
    operatorAddress: "测试地址",
    supportEmail: "privacy@test.invalid",
  });
}

test("mainland privacy decisions round-trip only for the current legal text", async () => {
  const secureStore = new MemorySecureStore();
  const repository = new PrivacyConsentRepository(mainlandConfig(), {
    secureStore,
    digestSha256,
    now: () => new Date("2026-08-16T10:00:00.000Z"),
  });

  assert.equal(await repository.loadCurrent(), null);
  await assert.rejects(
    () => repository.decide("accepted"),
    /adult eligibility confirmation/iu,
  );
  const accepted = await repository.decide("accepted", true);
  assert.equal(accepted.policyVersion, MAINLAND_PRIVACY_POLICY_VERSION);
  assert.equal(accepted.decision, "accepted");
  assert.equal(accepted.adultEligibilityConfirmed, true);
  assert.equal(accepted.decidedAt, "2026-08-16T10:00:00.000Z");
  assert.match(accepted.documentsSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await repository.loadCurrent(), accepted);

  const changedDocuments = new PrivacyConsentRepository(
    mainlandConfig("另一备案主体"),
    { secureStore, digestSha256 },
  );
  assert.equal(await changedDocuments.loadCurrent(), null);
});

test("declining is persisted without enabling the application", async () => {
  const secureStore = new MemorySecureStore();
  const repository = new PrivacyConsentRepository(mainlandConfig(), {
    secureStore,
    digestSha256,
  });
  const declined = await repository.decide("declined");
  assert.equal(declined.decision, "declined");
  assert.deepEqual(await repository.loadCurrent(), declined);
});

test("invalid, expanded, or unavailable consent storage fails closed", async () => {
  assert.equal(parsePrivacyConsentRecord("not-json"), null);
  assert.equal(
    parsePrivacyConsentRecord(
      JSON.stringify({
        schema: 1,
        region: "china-mainland",
        policyVersion: MAINLAND_PRIVACY_POLICY_VERSION,
        documentsSha256: "a".repeat(64),
        decision: "accepted",
        decidedAt: "2026-08-16T10:00:00.000Z",
        unexpected: true,
      }),
    ),
    null,
  );

  const secureStore = new MemorySecureStore();
  secureStore.available = false;
  const repository = new PrivacyConsentRepository(mainlandConfig(), {
    secureStore,
    digestSha256,
  });
  await assert.rejects(() => repository.loadCurrent(), /unavailable/iu);
  await assert.rejects(
    () => repository.decide("accepted", true),
    /unavailable/iu,
  );
});

test("the global edition cannot accidentally create a mainland consent store", () => {
  assert.throws(
    () =>
      new PrivacyConsentRepository(
        loadComplianceConfig({ distributionRegion: "global" }),
      ),
    /only available/iu,
  );
});
