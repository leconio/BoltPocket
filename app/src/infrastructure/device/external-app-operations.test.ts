import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalAppOperations,
  externalAppDataDescription,
  parseExternalAppTarget,
} from "./external-app-operations.ts";

test("external app targets accept arbitrary registered schemes without a whitelist", () => {
  assert.deepEqual(parseExternalAppTarget("mapsapp://route?to=station"), {
    scheme: "mapsapp",
    url: "mapsapp://route?to=station",
  });
  assert.match(
    externalAppDataDescription("mailto:hello@example.com"),
    /mailto:/u,
  );
});

test("external app targets reject executable, local-file, recursive and credential URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///private/file",
    "boltpocket://conversation/1",
    "https://name:secret@example.com/audio.mp3",
  ]) {
    assert.throws(() => parseExternalAppTarget(url));
  }
});

test("external app open calls React Native Linking with the exact target", async () => {
  const opened: string[] = [];
  const operations = new ExternalAppOperations(async (url) => {
    opened.push(url);
  });
  const result = await operations.open("tel:+8610000");
  assert.deepEqual(opened, ["tel:+8610000"]);
  assert.equal(result.opened, true);
  assert.equal(result.scheme, "tel");
});
