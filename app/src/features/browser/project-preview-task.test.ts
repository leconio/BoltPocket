import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";

import type { BrowserTask } from "./browser-provider.tsx";
import { resolveOpenProjectPreviewTask } from "./project-preview-task.ts";

function previewSnapshot(
  id: string,
  projectId = "project-one",
  entryPath = "/project/apps/weather/index.html",
): ProjectPreviewSnapshot {
  return {
    id,
    projectId,
    entryPath,
    displayPath: "apps/weather/index.html",
    url: `https://preview-${id}.boltpocket.invalid/content/index.html`,
    rootUri: `file:///cache/boltpocket/project-previews/${id}/`,
    fileCount: 1,
    byteLength: 128,
    contentSha256: "a".repeat(64),
    app: {
      schema: 1,
      title: "天气",
      entry: "index.html",
      profile: "vanilla",
      addons: [],
      permissions: [],
    },
    runtime: { assetCount: 0, byteLength: 0 },
    createdAt: 1,
  };
}

function previewTask(snapshot: ProjectPreviewSnapshot): BrowserTask {
  return {
    id: "browser-existing",
    createdAt: 1,
    source: { kind: "project-preview", snapshot, agentOwned: false },
    navigation: {
      url: snapshot.url,
      title: snapshot.app.title,
      canGoBack: false,
      canGoForward: false,
      loading: false,
    },
    navigationRequest: { id: 1, url: snapshot.url },
  };
}

test("a user reopening the same project H5 reuses its existing tab", () => {
  const existing = previewTask(
    previewSnapshot("0123456789abcdef0123456789abcdef"),
  );
  const nextSnapshot = previewSnapshot("fedcba9876543210fedcba9876543210");

  assert.deepEqual(
    resolveOpenProjectPreviewTask([existing], nextSnapshot, false),
    { task: existing, replaceSnapshot: false },
  );
});

test("an Agent re-preview refreshes the snapshot in the existing H5 tab", () => {
  const existing = previewTask(
    previewSnapshot("0123456789abcdef0123456789abcdef"),
  );
  const nextSnapshot = previewSnapshot("fedcba9876543210fedcba9876543210");

  assert.deepEqual(
    resolveOpenProjectPreviewTask([existing], nextSnapshot, true),
    { task: existing, replaceSnapshot: true },
  );
});

test("H5 tabs remain distinct across projects and entry paths", () => {
  const existing = previewTask(
    previewSnapshot("0123456789abcdef0123456789abcdef"),
  );

  assert.equal(
    resolveOpenProjectPreviewTask(
      [existing],
      previewSnapshot("fedcba9876543210fedcba9876543210", "project-two"),
      false,
    ),
    null,
  );
  assert.equal(
    resolveOpenProjectPreviewTask(
      [existing],
      previewSnapshot(
        "fedcba9876543210fedcba9876543210",
        "project-one",
        "/project/apps/notes/index.html",
      ),
      false,
    ),
    null,
  );
});
