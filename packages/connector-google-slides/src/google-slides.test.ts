import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeGoogleSlidesText,
  googlePresentationUrl,
  parseGooglePresentationId,
  parseGoogleSlidesText,
} from "./index.ts";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("parses Google Slides links and rejects lookalike hosts", () => {
  assert.equal(
    parseGooglePresentationId(
      `https://docs.google.com/presentation/d/${ID}/edit`,
    ),
    ID,
  );
  assert.equal(
    googlePresentationUrl(ID),
    `https://docs.google.com/presentation/d/${ID}/edit`,
  );
  assert.throws(() =>
    parseGooglePresentationId(
      `https://docs.google.com.example/presentation/d/${ID}/edit`,
    ),
  );
});

test("canonicalizes plain text into bounded slide JSON", () => {
  const canonical = canonicalizeGoogleSlidesText("Title\nBody\n---\nNext");
  assert.deepEqual(parseGoogleSlidesText(canonical), {
    slides: [{ texts: ["Title\nBody"] }, { texts: ["Next"] }],
  });
  assert.equal(canonicalizeGoogleSlidesText(canonical), canonical);
});
