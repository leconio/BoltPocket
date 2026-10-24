import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceResource } from "./models.ts";
import { getProjectH5Apps } from "./project-h5-apps.ts";
import {
  createProjectWorkspaceFileResource,
  projectWorkspaceConnectionId,
} from "./project-workspace.ts";

function workspaceResource(projectId: string, path: string, content: string) {
  return createProjectWorkspaceFileResource({ projectId, path, content });
}

test("lists every safe project-owned H5 entry with a stable project address", () => {
  const snake = workspaceResource(
    "project-one",
    "apps/snake/index.html",
    "<title>贪吃蛇 &amp; 好友</title>",
  );
  const scanner = workspaceResource(
    "project-one",
    "apps/scanner/index.html",
    "<title>扫码&#x5668;</title>",
  );

  assert.deepEqual(
    getProjectH5Apps([scanner, snake], "project-one").map(
      ({ resourceId, title, path, address, manifestStatus, manifest }) => ({
        resourceId,
        title,
        path,
        address,
        manifestStatus,
        permissions: manifest?.permissions,
        network: manifest?.network,
      }),
    ),
    [
      {
        resourceId: scanner.id,
        title: "扫码器",
        path: "apps/scanner/index.html",
        address: "/project/apps/scanner/index.html",
        manifestStatus: "missing",
        permissions: [],
        network: [],
      },
      {
        resourceId: snake.id,
        title: "贪吃蛇 & 好友",
        path: "apps/snake/index.html",
        address: "/project/apps/snake/index.html",
        manifestStatus: "missing",
        permissions: [],
        network: [],
      },
    ],
  );
});

test("only treats apps/<slug>/index.html as an H5 app", () => {
  const visible = workspaceResource(
    "project-one",
    "apps/visible/index.html",
    "<title>Visible</title>",
  );
  const connected: WorkspaceResource = {
    id: "connected-html",
    projectId: "project-one",
    connectionId: "imported-source",
    path: "site/index.html",
    content: "<title>Imported</title>",
    version: "1",
    storage: {
      kind: "source-file",
      locator: "snapshot/site/index.html",
      snapshotId: "snapshot-one",
      sourceKind: "github-public",
      sourceLabel: "Repository",
      mountPath: "site",
      revision: "main",
      versionLabel: "main",
      manifestPath: "manifest.json",
      access: "persistent",
    },
  };
  const hidden = [
    workspaceResource("project-two", "apps/other/index.html", "Other"),
    workspaceResource("project-one", "index.html", "Root"),
    workspaceResource("project-one", "demos/legacy/index.html", "Legacy"),
    workspaceResource("project-one", "apps/visible/about.html", "Secondary"),
    workspaceResource("project-one", "apps/nested/site/index.html", "Nested"),
    workspaceResource("project-one", "apps/upper/index.htm", "HTM"),
    workspaceResource("project-one", "skills/demo/index.html", "Skill"),
    workspaceResource("project-one", "memory/index.html", "Memory"),
    workspaceResource("project-one", ".env.html", "Secret"),
    {
      ...workspaceResource(
        "project-one",
        "archive/copy/index.html",
        "Artifact",
      ),
      connectionId: projectWorkspaceConnectionId("project-one"),
    },
    connected,
  ];

  assert.deepEqual(
    getProjectH5Apps([visible, ...hidden], "project-one").map(
      (entry) => entry.resourceId,
    ),
    [visible.id],
  );
});

test("uses the app directory name when an index page has no title", () => {
  const app = workspaceResource(
    "project-one",
    "apps/expense_tracker/index.html",
    "<!doctype html><main>App</main>",
  );

  assert.equal(
    getProjectH5Apps([app], "project-one")[0]?.title,
    "expense tracker",
  );
});

test("uses reviewed H5 manifest metadata before authored HTML markup", () => {
  const entry = workspaceResource(
    "project-one",
    "apps/inventory/index.html",
    "<title>旧标题</title>",
  );
  const manifest = workspaceResource(
    "project-one",
    "apps/inventory/boltpocket.h5.json",
    JSON.stringify({
      schema: 1,
      title: "库存看板",
      entry: "index.html",
      profile: "preact-htm",
      addons: ["echarts"],
      permissions: [],
    }),
  );

  assert.equal(
    getProjectH5Apps([entry, manifest], "project-one")[0]?.title,
    "库存看板",
  );
});
