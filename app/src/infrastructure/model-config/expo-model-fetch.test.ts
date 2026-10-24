import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(resolve(import.meta.dirname, relativePath), "utf8");
}

test("native Agent model traffic uses Expo fetch and streamed SSE", () => {
  const nativeTransport = source("expo-model-fetch.native.ts");
  const fallbackTransport = source("expo-model-fetch.ts");
  const mainAgent = source("../agent/pi-mobile-agent-runtime.ts");
  const textAgent = source("../agent/pi-text-specialist.ts");
  const visionAgent = source("../agent/pi-vision-specialist.ts");
  const codexOAuth = source("expo-codex-device-oauth.ts");
  const streamCoalescer = source(
    "../../../../packages/agent-runtime/src/model-stream-coalescing.ts",
  );

  assert.match(nativeTransport, /from "expo\/fetch"/u);
  assert.match(
    nativeTransport,
    /expoFetch as unknown as typeof globalThis\.fetch/u,
  );
  assert.match(fallbackTransport, /globalThis\.fetch\(input, init\)/u);

  for (const agent of [mainAgent, textAgent, visionAgent]) {
    assert.match(agent, /fetch: config\.fetch \?\? expoModelFetch/u);
    assert.doesNotMatch(agent, /responseTransport/u);
  }
  assert.match(codexOAuth, /fetch: expoModelFetch/u);
  assert.match(streamCoalescer, /new EventStream</u);
  assert.doesNotMatch(streamCoalescer, /createAssistantMessageEventStream/u);
});
