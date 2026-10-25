import assert from "node:assert/strict";
import test from "node:test";

import {
  basePiMobileAgentToolNames,
  restorablePiMobileAgentToolNames,
} from "./pi-mobile-agent-tools.ts";

const tools = [
  "read",
  "device",
  "preview_project",
  "browser",
  "sshpass",
  "project_resource_catalog",
  "project_resource_copy",
].map((name) => ({ name }));

test("permission-brokered device access has no hidden Skill activation gate", () => {
  assert.deepEqual(basePiMobileAgentToolNames(tools), ["read", "device"]);
});

test("every specialized Skill contributes its tools to the durable allow-list", () => {
  const cases = new Map<string, string[]>([
    ["build-h5", ["read", "device", "preview_project"]],
    ["operate-browser", ["read", "device", "preview_project", "browser"]],
    ["operate-device", ["read", "device"]],
    ["manage-calendar-reminders", ["read", "device"]],
    ["read-device-sensors", ["read", "device"]],
    ["play-device-audio", ["read", "device"]],
    ["operate-ssh", ["read", "device", "sshpass"]],
    [
      "use-bootstrap-icons",
      ["read", "device", "project_resource_catalog", "project_resource_copy"],
    ],
    [
      "use-h5-resources",
      ["read", "device", "project_resource_catalog", "project_resource_copy"],
    ],
    [
      "use-kenney-1bit",
      ["read", "device", "project_resource_catalog", "project_resource_copy"],
    ],
    [
      "use-kenney-ui",
      ["read", "device", "project_resource_catalog", "project_resource_copy"],
    ],
  ]);

  for (const [skillName, expected] of cases) {
    assert.deepEqual(
      restorablePiMobileAgentToolNames([skillName], tools),
      expected,
      skillName,
    );
  }
});

test("multiple Skills loaded over multiple turns accumulate without exposing disabled groups", () => {
  assert.deepEqual(
    restorablePiMobileAgentToolNames(["operate-browser", "operate-ssh"], tools),
    ["read", "device", "preview_project", "browser", "sshpass"],
  );

  assert.deepEqual(restorablePiMobileAgentToolNames([], tools), [
    "read",
    "device",
  ]);
});
