import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAuthorizedProjectResources,
  mergeProjectConnections,
} from "./agent-run-document-scope.ts";

test("a document connected during preflight is available to the same Agent run", () => {
  const resources = mergeAuthorizedProjectResources({
    current: [
      {
        id: "existing",
        projectId: "project-1",
        connectionId: "workspace",
        value: "existing",
      },
      {
        id: "late",
        projectId: "project-1",
        connectionId: "workspace",
        value: "not-authorized",
      },
    ],
    justConnected: [
      {
        id: "fresh-link",
        projectId: "project-1",
        connectionId: "google-slides-1",
        value: "slides",
      },
    ],
    projectId: "project-1",
    authorizedResourceIds: new Set(["existing", "fresh-link"]),
  });

  assert.deepEqual(
    resources.map((resource) => resource.id),
    ["existing", "fresh-link"],
  );
});

test("a fresh connector bundle replaces stale resource identities from that connection", () => {
  const resources = mergeAuthorizedProjectResources({
    current: [
      {
        id: "created-placeholder-id",
        projectId: "project-1",
        connectionId: "google-slides-1",
        value: "stale",
      },
    ],
    justConnected: [
      {
        id: "canonical-linked-id",
        projectId: "project-1",
        connectionId: "google-slides-1",
        value: "fresh",
      },
    ],
    projectId: "project-1",
    authorizedResourceIds: new Set([
      "created-placeholder-id",
      "canonical-linked-id",
    ]),
  });

  assert.deepEqual(resources, [
    {
      id: "canonical-linked-id",
      projectId: "project-1",
      connectionId: "google-slides-1",
      value: "fresh",
    },
  ]);
});

test("a preflight connection overrides stale state for the same run", () => {
  const connections = mergeProjectConnections({
    current: [
      { id: "google-slides-1", projectId: "project-1", status: "stale" },
    ],
    justConnected: [
      { id: "google-slides-1", projectId: "project-1", status: "connected" },
    ],
    projectId: "project-1",
  });

  assert.deepEqual(connections, [
    { id: "google-slides-1", projectId: "project-1", status: "connected" },
  ]);
});
