import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeGoogleSlidesText } from "@boltpocket/connector-google-slides";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";

import { GoogleSlidesHttpApi } from "./google-slides-http-api.ts";

const PRESENTATION_ID = "presentation_12345678901234567890";

class FakeAuthorization implements GoogleDocsAuthorizationPort {
  async connect() {
    return null;
  }

  async restore() {
    return null;
  }

  async accessTokenFor() {
    return "slides-test-token";
  }

  async clearAccessToken() {}
}

function presentation(
  slides: readonly (readonly string[])[],
  revisionId: string,
) {
  return {
    presentationId: PRESENTATION_ID,
    title: "验收幻灯片",
    revisionId,
    slides: slides.map((texts, slideIndex) => ({
      objectId: `slide-${slideIndex + 1}`,
      pageElements: texts.map((text, textIndex) => ({
        objectId: `shape-${slideIndex + 1}-${textIndex + 1}`,
        shape: {
          text: {
            textElements: [{ textRun: { content: `${text}\n` } }],
          },
        },
      })),
    })),
  };
}

function driveMetadata(trashed = false) {
  return {
    id: PRESENTATION_ID,
    mimeType: "application/vnd.google-apps.presentation",
    trashed,
    capabilities: { canEdit: true },
  };
}

test("Google Slides reads text boxes and revision-binds minimal text edits", async () => {
  let texts = [["Old", "Keep"]];
  let revisionId = "revision-7";
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleSlidesHttpApi(new FakeAuthorization(), (async (
    input,
    init,
  ) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith(":batchUpdate")) {
      texts = [["New", "Keep"]];
      revisionId = "revision-8";
      return new Response("{}");
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(JSON.stringify(driveMetadata()));
    }
    return new Response(JSON.stringify(presentation(texts, revisionId)));
  }) as typeof fetch);

  const before = await api.readResource("account-1", PRESENTATION_ID);
  assert.deepEqual(JSON.parse(before.text), {
    slides: [{ texts: ["Old", "Keep"] }],
  });
  const after = canonicalizeGoogleSlidesText(
    JSON.stringify({ slides: [{ texts: ["New", "Keep"] }] }),
  );
  const written = await api.replaceResource({
    accountId: "account-1",
    resourceId: PRESENTATION_ID,
    expectedVersion: before.version,
    text: after,
  });
  assert.equal(written.text, after);

  const batch = requests.find((request) =>
    request.url.endsWith(":batchUpdate"),
  );
  assert.ok(batch);
  assert.equal(
    (batch.init?.headers as Record<string, string>).Authorization,
    "Bearer slides-test-token",
  );
  assert.deepEqual(JSON.parse(String(batch.init?.body)), {
    requests: [
      {
        deleteText: {
          objectId: "shape-1-1",
          textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: 3 },
        },
      },
      {
        insertText: {
          objectId: "shape-1-1",
          insertionIndex: 0,
          text: "New",
        },
      },
    ],
    writeControl: { requiredRevisionId: "revision-7" },
  });
});

test("Google Slides creates a deck and uses recoverable Drive trash and restore", async () => {
  let slides: string[][] = [[]];
  let revisionId = "revision-1";
  let trashed = false;
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleSlidesHttpApi(new FakeAuthorization(), (async (
    input,
    init,
  ) => {
    const url = String(input);
    requests.push({ url, init });
    if (
      url === "https://slides.googleapis.com/v1/presentations" &&
      init?.method === "POST"
    ) {
      return new Response(JSON.stringify({ presentationId: PRESENTATION_ID }));
    }
    if (url.endsWith(":batchUpdate")) {
      slides = [["封面"], ["结论"]];
      revisionId = "revision-2";
      return new Response("{}");
    }
    if (
      url.startsWith("https://www.googleapis.com/drive/v3/files/") &&
      init?.method === "PATCH"
    ) {
      trashed = Boolean(
        (JSON.parse(String(init.body)) as { trashed?: boolean }).trashed,
      );
      return new Response(JSON.stringify({ id: PRESENTATION_ID, trashed }));
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(JSON.stringify(driveMetadata(trashed)));
    }
    return new Response(JSON.stringify(presentation(slides, revisionId)));
  }) as typeof fetch);
  const canonical = canonicalizeGoogleSlidesText("封面\n---\n结论");

  const created = await api.createResource({
    accountId: "account-1",
    title: "模型验收幻灯片",
    text: canonical,
    operationId: "operation-1",
    connectionId: "google-slides-1",
    projectId: "project-1",
    resourceId: "google-slide-created-1",
  });
  assert.equal(created.text, canonical);
  assert.equal(created.trashable, true);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    title: "模型验收幻灯片",
  });
  const batch = requests.find((request) =>
    request.url.endsWith(":batchUpdate"),
  );
  const body = JSON.parse(String(batch?.init?.body)) as {
    requests: Record<string, unknown>[];
    writeControl: { requiredRevisionId: string };
  };
  assert.equal(body.writeControl.requiredRevisionId, "revision-1");
  assert.equal(
    body.requests.some((request) => "deleteObject" in request),
    true,
  );
  assert.equal(
    body.requests.filter((request) => "createSlide" in request).length,
    2,
  );
  assert.equal(
    body.requests.filter((request) => "insertText" in request).length,
    2,
  );

  const inTrash = await api.setResourceTrashed({
    accountId: "account-1",
    resourceId: PRESENTATION_ID,
    trashed: true,
  });
  assert.equal(inTrash.trashed, true);
  assert.equal(inTrash.restorable, true);

  const restored = await api.setResourceTrashed({
    accountId: "account-1",
    resourceId: PRESENTATION_ID,
    trashed: false,
  });
  assert.equal(restored.trashed, false);
  assert.equal(restored.trashable, true);
  assert.equal(
    requests.some((request) => request.init?.method === "DELETE"),
    false,
  );
});
