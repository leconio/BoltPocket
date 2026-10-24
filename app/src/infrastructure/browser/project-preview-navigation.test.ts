import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserTask } from "../../features/browser/browser-provider.tsx";
import {
  isProjectPreviewDocumentUrl,
  isProjectPreviewResourceUrl,
} from "./project-preview-navigation.ts";

const id = "0123456789abcdef0123456789abcdef";
const origin = "http://127.0.0.1:54321";
const task = {
  source: {
    kind: "project-preview",
    agentOwned: false,
    snapshot: {
      id,
      url: `${origin}/${id}/content/index.html`,
    },
  },
} as BrowserTask;
const androidOrigin = `https://preview-${id}.boltpocket.invalid`;
const androidTask = {
  source: {
    kind: "project-preview",
    agentOwned: false,
    snapshot: {
      id,
      url: `${androidOrigin}/content/index.html`,
    },
  },
} as BrowserTask;

test("project preview documents stay on injected HTML pages", () => {
  assert.equal(
    isProjectPreviewDocumentUrl(task, `${origin}/${id}/content/index.html`),
    true,
  );
  assert.equal(
    isProjectPreviewDocumentUrl(task, `${origin}/${id}/content/about.htm?q=1`),
    true,
  );
  assert.equal(
    isProjectPreviewDocumentUrl(task, `${origin}/${id}/content/image.svg`),
    false,
  );
  assert.equal(
    isProjectPreviewDocumentUrl(task, `https://example.com/index.html`),
    false,
  );
  assert.equal(
    isProjectPreviewDocumentUrl(
      androidTask,
      `${androidOrigin}/content/index.html`,
    ),
    true,
  );
});

test("project preview resources accept content and exact cached runtime files", () => {
  assert.equal(
    isProjectPreviewResourceUrl(task, `${origin}/${id}/content/scripts/app.js`),
    true,
  );
  assert.equal(
    isProjectPreviewResourceUrl(
      task,
      `${origin}/${id}/runtime/${"a".repeat(64)}.js`,
    ),
    true,
  );
  assert.equal(
    isProjectPreviewResourceUrl(task, `${origin}/${id}/runtime/not-pinned.js`),
    false,
  );
  assert.equal(
    isProjectPreviewResourceUrl(
      androidTask,
      `${androidOrigin}/runtime/${"b".repeat(64)}.js`,
    ),
    true,
  );
});
