import assert from "node:assert/strict";
import test from "node:test";

import { H5_RUNTIME_ASSETS } from "./h5-runtime-registry.ts";
import {
  orderedH5RuntimeSources,
  resolveH5RuntimeSource,
} from "./h5-runtime-source-policy.ts";

test("runtime routing prefers a prior healthy source when the asset supports it", () => {
  assert.deepEqual(
    orderedH5RuntimeSources(H5_RUNTIME_ASSETS.preact, "unpkg").map(
      (source) => source.id,
    ),
    ["unpkg", "npmmirror", "jsdelivr"],
  );
  assert.deepEqual(
    orderedH5RuntimeSources(H5_RUNTIME_ASSETS.phaser, "npmmirror").map(
      (source) => source.id,
    ),
    ["bootcdn", "staticfile", "jsdelivr", "unpkg"],
  );
});

test("runtime routing falls through failed and integrity-rejected sources", async () => {
  const attempted: string[] = [];
  const result = await resolveH5RuntimeSource(
    H5_RUNTIME_ASSETS.preact,
    undefined,
    async (source) => {
      attempted.push(source.id);
      if (source.id !== "unpkg") throw new Error("invalid bytes");
      return "verified";
    },
  );

  assert.deepEqual(attempted, ["npmmirror", "jsdelivr", "unpkg"]);
  assert.equal(result.source.id, "unpkg");
  assert.equal(result.value, "verified");
});

test("bundle source routing returns one stable error after every source fails", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    resolveH5RuntimeSource(
      H5_RUNTIME_ASSETS.phaser,
      undefined,
      async (source) => {
        attempted.push(source.id);
        throw new Error(`failed ${source.id}`);
      },
    ),
    /H5 离线包构建源均不可用/u,
  );
  assert.deepEqual(attempted, ["bootcdn", "staticfile", "jsdelivr", "unpkg"]);
});
