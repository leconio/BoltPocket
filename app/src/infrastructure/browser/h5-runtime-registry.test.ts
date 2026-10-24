import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectH5Manifest } from "../../domain/project-h5-manifest.ts";
import {
  H5_RUNTIME_ASSETS,
  h5RuntimeAssetsForManifest,
  h5RuntimeCacheFileName,
  h5RuntimeHtmlInjection,
  isTrustedH5RuntimeSource,
  normalizeH5RuntimeMimeType,
} from "./h5-runtime-registry.ts";

function manifest(
  profile: ProjectH5Manifest["profile"],
  addons: ProjectH5Manifest["addons"] = [],
): ProjectH5Manifest {
  return {
    schema: 1,
    title: "测试应用",
    entry: "index.html",
    profile,
    addons,
    permissions: [],
  };
}

test("runtime catalog is exact, content-addressed and limited to fixed HTTPS sources", () => {
  const hashes = new Set<string>();
  let totalBytes = 0;
  for (const asset of Object.values(H5_RUNTIME_ASSETS)) {
    assert.ok(asset.sources.length >= 3);
    assert.equal(asset.sources[0]?.region, "mainland");
    assert.equal(
      new Set(asset.sources.map((source) => source.id)).size,
      asset.sources.length,
    );
    assert.ok(
      asset.sources.every((source) => isTrustedH5RuntimeSource(asset, source)),
    );
    assert.ok(asset.sources.some((source) => source.id === "jsdelivr"));
    assert.ok(asset.sources.some((source) => source.id === "unpkg"));
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(asset.byteLength > 0 && asset.byteLength <= 8 * 1024 * 1024);
    totalBytes += asset.byteLength;
    assert.equal(hashes.has(asset.sha256), false);
    hashes.add(asset.sha256);
    assert.equal(h5RuntimeCacheFileName(asset), `${asset.sha256}.js`);
  }
  assert.ok(totalBytes <= 64 * 1024 * 1024);
});

test("mainland routing uses npm mirror except for its unsupported Phaser file", () => {
  assert.equal(H5_RUNTIME_ASSETS.preact.sources[0]?.id, "npmmirror");
  assert.deepEqual(
    H5_RUNTIME_ASSETS.phaser.sources.map((source) => source.id),
    ["bootcdn", "staticfile", "jsdelivr", "unpkg"],
  );
});

test("runtime MIME normalization tolerates absent Android file metadata", () => {
  assert.equal(
    normalizeH5RuntimeMimeType("Application/JavaScript; charset=utf-8"),
    "application/javascript",
  );
  assert.equal(normalizeH5RuntimeMimeType(null), "");
  assert.equal(normalizeH5RuntimeMimeType(undefined), "");
});

test("scene selection resolves only the required immutable runtime assets", () => {
  assert.deepEqual(h5RuntimeAssetsForManifest(manifest("vanilla")), []);
  assert.deepEqual(
    h5RuntimeAssetsForManifest(manifest("preact-htm", ["echarts"])).map(
      (asset) => asset.id,
    ),
    ["preact", "preact-hooks", "htm", "echarts"],
  );
});

test("HTML receives only same-origin pinned UMD runtimes", () => {
  const injection = h5RuntimeHtmlInjection(
    manifest("preact-htm", ["echarts"]),
    "/0123456789abcdef0123456789abcdef/runtime/",
  );

  assert.match(injection.headStart, /data-boltpocket-runtime="preact"/u);
  assert.match(injection.headStart, /data-boltpocket-runtime="preact-hooks"/u);
  assert.match(injection.headStart, /data-boltpocket-runtime="htm"/u);
  assert.match(injection.headStart, /data-boltpocket-runtime="echarts"/u);
  assert.match(
    injection.headStart,
    /\/0123456789abcdef0123456789abcdef\/runtime\/[a-f0-9]{64}\.js/u,
  );
  assert.doesNotMatch(injection.headStart, /cdn\.jsdelivr|https?:/u);
  assert.doesNotMatch(injection.headStart, /nonce|importmap/u);
});
