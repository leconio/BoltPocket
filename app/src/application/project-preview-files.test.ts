import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceResource } from "../domain/models.ts";
import { workspaceResourceToProjectPreviewFile } from "./project-preview-files.ts";

test("project preview preserves copied binary resource metadata after restore", () => {
  const resource: WorkspaceResource = {
    id: "resource-arrow",
    projectId: "project-h5",
    connectionId: "workspace-project-h5",
    path: "apps/demo/assets/vendor/kenney-ui/png/blue/arrow.png",
    content: "iVBORw0KGgo=",
    version: "sha256:resource-arrow",
    storage: {
      kind: "project-workspace",
      binary: {
        encoding: "base64",
        mimeType: "image/png",
        byteLength: 8,
        sha256: "a".repeat(64),
        source: {
          kind: "builtin-h5-resource",
          packId: "kenney-ui",
          path: "png/blue/arrow.png",
        },
      },
    },
  };

  assert.deepEqual(
    workspaceResourceToProjectPreviewFile(
      resource,
      "/project/apps/demo/assets/vendor/kenney-ui/png/blue/arrow.png",
    ),
    {
      path: "/project/apps/demo/assets/vendor/kenney-ui/png/blue/arrow.png",
      content: "iVBORw0KGgo=",
      encoding: "base64",
      mimeType: "image/png",
      byteLength: 8,
      sha256: "a".repeat(64),
      source: {
        kind: "builtin-h5-resource",
        packId: "kenney-ui",
        path: "png/blue/arrow.png",
      },
    },
  );
});

test("project preview keeps ordinary workspace files as text", () => {
  const resource: WorkspaceResource = {
    id: "resource-index",
    projectId: "project-h5",
    connectionId: "workspace-project-h5",
    path: "apps/demo/index.html",
    content: "<main>Demo</main>",
    version: "1",
    storage: { kind: "project-workspace" },
  };

  assert.deepEqual(
    workspaceResourceToProjectPreviewFile(
      resource,
      "/project/apps/demo/index.html",
    ),
    {
      path: "/project/apps/demo/index.html",
      content: "<main>Demo</main>",
    },
  );
});
