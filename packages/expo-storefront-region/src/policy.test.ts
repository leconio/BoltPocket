import assert from "node:assert/strict";
import test from "node:test";

import {
  distributionRegionForStorefrontCountryCode,
  resolveStorefrontDistributionRegion,
} from "./policy.ts";

test("only the exact Mainland China storefront selects the mainland policy", () => {
  assert.equal(
    distributionRegionForStorefrontCountryCode("CHN"),
    "china-mainland",
  );
  assert.equal(distributionRegionForStorefrontCountryCode(" chn "), "global");
  assert.equal(distributionRegionForStorefrontCountryCode("USA"), "global");
  assert.equal(distributionRegionForStorefrontCountryCode("HKG"), "global");
});

test("native StoreKit failures fall back to global", async () => {
  assert.equal(
    await resolveStorefrontDistributionRegion(async () => {
      throw new Error("StoreKit unavailable");
    }),
    "global",
  );
  assert.equal(
    await resolveStorefrontDistributionRegion(async () => "CHN"),
    "china-mainland",
  );
});

test("missing, malformed, and unknown storefronts fall back to global", () => {
  for (const value of [
    undefined,
    null,
    "",
    "chn",
    "CN",
    "CHINA",
    156,
    {},
    [],
  ]) {
    assert.equal(distributionRegionForStorefrontCountryCode(value), "global");
  }
});
