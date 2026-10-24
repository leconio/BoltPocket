import assert from "node:assert/strict";
import test from "node:test";

import type { AppAction } from "../../domain/app-state.ts";
import { shouldPersistAppAction } from "./app-state-persistence-policy.ts";

test("persistence policy records recoverable run lifecycle state", () => {
  for (const type of [
    "project/created",
    "project/set-pinned",
    "run/start",
    "run/interrupted",
    "run/fail",
    "run/complete",
  ] as const) {
    assert.equal(shouldPersistAppAction({ type } as AppAction), true, type);
  }
});

test("persistence policy records global Skill defaults and project overrides", () => {
  assert.equal(
    shouldPersistAppAction({
      type: "skill/set-enabled",
      scope: "global",
      skillId: "build-h5",
      enabled: false,
    }),
    true,
  );
  assert.equal(
    shouldPersistAppAction({
      type: "skill/set-enabled",
      scope: "project",
      projectId: "project-a",
      skillId: "build-h5",
      enabled: true,
    }),
    true,
  );
});

test("persistence policy skips volatile UI and native session snapshots", () => {
  for (const type of [
    "chat/new",
    "chat/new-project",
    "chat/open-project",
    "chat/open-conversation",
    "project/opened",
    "draft/change",
    "run/status",
    "proposal/auto-apply-start",
    "proposal/auto-apply-failed",
    "connection/upsert",
    "resources/refreshed",
  ] as const) {
    assert.equal(shouldPersistAppAction({ type } as AppAction), false, type);
  }
});
