import assert from "node:assert/strict";
import test from "node:test";

import { miniAppProductionReleaseIssues } from "./mini-app-release.ts";

test("fails closed until Apple's mini-app native API approval is archived", () => {
  assert.equal(miniAppProductionReleaseIssues().length, 1);
  assert.deepEqual(
    miniAppProductionReleaseIssues({
      status: "approved",
      caseId: "APPLE-CASE-1234",
      approvedAt: "2026-08-21",
    }),
    [],
  );
});
