import assert from "node:assert/strict";
import test from "node:test";

import { builtInProjectResourceFile } from "../../domain/builtin-project-resources.ts";
import { parseProjectH5Manifest } from "../../domain/project-h5-manifest.ts";
import { activateDistributionRegion } from "../../config/distribution.ts";

import {
  PROJECT_PREVIEW_CSP,
  createProjectPreviewCsp,
  injectProjectPreviewPolicy,
  isProjectPreviewCandidatePath,
  prepareProjectPreview,
} from "./project-preview-policy.ts";

function copiedResourceFile(
  root: string,
  packId: "bootstrap-icons" | "kenney-ui" | "kenney-1bit",
  sourcePath: string,
) {
  const descriptor = builtInProjectResourceFile(packId, sourcePath);
  assert.ok(descriptor);
  return {
    path: `${root}/assets/vendor/${packId}/${descriptor.path}`,
    content: Buffer.alloc(descriptor.byteLength).toString("base64"),
    encoding: "base64" as const,
    mimeType: descriptor.mimeType,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
    source: {
      kind: "builtin-h5-resource" as const,
      packId,
      path: descriptor.path,
    },
  };
}

test("a Snake H5 preview keeps eligible sibling assets and injects the network policy", () => {
  const prepared = prepareProjectPreview({
    projectId: "snake-project",
    entryPath: "/project/game/index.html",
    files: [
      {
        path: "/project/game/index.html",
        content:
          '<!doctype html><html><head><title>贪吃蛇</title></head><body><canvas id="game"></canvas><script src="game.js"></script></body></html>',
      },
      {
        path: "/project/game/game.js",
        content: "const snake = [{ x: 4, y: 4 }];",
      },
      {
        path: "/project/game/theme.css",
        content: "canvas { touch-action: none; }",
      },
      {
        path: "/project/game/data/levels.json",
        content: '{"speed":120}',
      },
      { path: "/project/game/.env", content: "TOKEN=secret" },
      { path: "/project/game/MEMORY.md", content: "private notes" },
      { path: "/project/other.txt", content: "outside preview root" },
    ],
  });

  assert.equal(prepared.displayPath, "index.html");
  assert.deepEqual(
    prepared.files.map((file) => file.relativePath),
    ["data/levels.json", "game.js", "index.html", "theme.css"],
  );
  const entry = prepared.files.find((file) => file.path === prepared.entryPath);
  assert.ok(entry);
  assert.match(entry.content, /Content-Security-Policy/u);
  assert.match(entry.content, /name="viewport"/u);
  assert.match(entry.content, /connect-src 'self';/u);
  assert.doesNotMatch(entry.content, /(?:^|\s)https:(?:\s|;)/u);
  assert.match(entry.content, /object-src 'none'/u);
  assert.match(entry.content, /worker-src 'none'/u);
  assert.doesNotMatch(entry.content, /script-src[^;]+https:/u);
  assert.doesNotMatch(entry.content, /script-src[^;]+unsafe-inline/u);
  assert.doesNotMatch(entry.content, /nonce-/u);
  assert.doesNotMatch(JSON.stringify(prepared), /TOKEN=secret|private notes/u);
  assert.ok(prepared.byteLength > 0);
});

test("every preview HTML document receives the same executable-code policy", () => {
  const prepared = prepareProjectPreview({
    projectId: "multi-page",
    entryPath: "/project/apps/docs/index.html",
    files: [
      {
        path: "/project/apps/docs/index.html",
        content:
          '<!doctype html><html><head></head><body><a href="help.html">帮助</a></body></html>',
      },
      {
        path: "/project/apps/docs/help.html",
        content:
          '<!doctype html><html><head></head><body><script src="https://example.com/remote.js"></script></body></html>',
      },
    ],
  });

  const htmlFiles = prepared.files.filter((file) =>
    /\.html?$/u.test(file.path),
  );
  assert.equal(htmlFiles.length, 2);
  for (const file of htmlFiles) {
    assert.match(file.content, /Content-Security-Policy/u);
    assert.match(file.content, /script-src 'self'/u);
    assert.match(file.content, /worker-src 'none'/u);
  }
});

test("preview policy wraps fragments and rejects path traversal or oversized files", () => {
  assert.match(
    injectProjectPreviewPolicy("<main>hello</main>"),
    /^<!doctype html><html><head><meta[^>]+><meta[^>]+><\/head><body><main>/u,
  );
  assert.doesNotMatch(PROJECT_PREVIEW_CSP, /(?:^|; )[^;]*http:(?:;|$)/u);
  assert.doesNotMatch(PROJECT_PREVIEW_CSP, /https:|wss:/u);
  assert.equal(createProjectPreviewCsp(), PROJECT_PREVIEW_CSP);
  assert.equal(
    injectProjectPreviewPolicy(
      '<html><head><meta name="viewport" content="width=640"></head></html>',
    ).match(/name="viewport"/gu)?.length,
    1,
  );

  assert.throws(
    () =>
      prepareProjectPreview({
        projectId: "snake-project",
        entryPath: "/project/game/../private/index.html",
        files: [],
      }),
    /路径越界/u,
  );
  assert.throws(
    () =>
      prepareProjectPreview({
        projectId: "snake-project",
        entryPath: "/project/game/index.html",
        files: [
          {
            path: "/project/game/index.html",
            content: "x".repeat(1024 * 1024 + 1),
          },
        ],
      }),
    /超过 1 MiB/u,
  );
});

test("preview CSP allows only exact manifest network origins", () => {
  const manifest = parseProjectH5Manifest(
    JSON.stringify({
      schema: 3,
      title: "天气",
      entry: "index.html",
      profile: "vanilla",
      addons: [],
      resources: [],
      permissions: [],
      network: [
        {
          id: "weather-api",
          origin: "https://weather.example.com",
          purpose: "获取天气数据",
        },
        {
          id: "live-weather",
          origin: "wss://stream.example.com",
          purpose: "接收天气更新",
        },
      ],
    }),
    "index.html",
  );
  const csp = createProjectPreviewCsp(manifest);
  assert.match(
    csp,
    /connect-src 'self' https:\/\/weather\.example\.com wss:\/\/stream\.example\.com/u,
  );
  assert.match(csp, /img-src[^;]+https:\/\/weather\.example\.com/u);
  assert.doesNotMatch(csp, /img-src[^;]+wss:\/\/stream\.example\.com/u);
  assert.doesNotMatch(csp, /(?:^|\s)https:(?:\s|;)/u);
});

test("mainland preview stays offline until recipients are registered in the signed profile", () => {
  activateDistributionRegion("china-mainland");
  try {
    assert.throws(
      () =>
        prepareProjectPreview({
          projectId: "weather-project",
          entryPath: "/project/apps/weather/index.html",
          files: [
            {
              path: "/project/apps/weather/index.html",
              content: "<!doctype html><main>天气</main>",
            },
            {
              path: "/project/apps/weather/boltpocket.h5.json",
              content: JSON.stringify({
                schema: 3,
                title: "天气",
                entry: "index.html",
                profile: "vanilla",
                addons: [],
                resources: [],
                permissions: [],
                network: [
                  {
                    id: "weather-api",
                    origin: "https://weather.example.com",
                    purpose: "获取天气",
                  },
                ],
              }),
            },
          ],
        }),
      /未登记/u,
    );
  } finally {
    activateDistributionRegion("global");
  }
});

test("a declared Preact scene receives only app-cached same-origin runtimes", () => {
  const prepared = prepareProjectPreview(
    {
      projectId: "inventory-project",
      entryPath: "/project/apps/inventory/index.html",
      files: [
        {
          path: "/project/apps/inventory/index.html",
          content:
            '<!doctype html><html><head><title>库存</title><script type="module" src="./scripts/app.js"></script></head><body></body></html>',
        },
        {
          path: "/project/apps/inventory/boltpocket.h5.json",
          content: JSON.stringify({
            schema: 1,
            title: "库存看板",
            entry: "index.html",
            profile: "preact-htm",
            addons: ["echarts"],
            resources: ["bootstrap-icons"],
            permissions: [],
          }),
        },
        {
          path: "/project/apps/inventory/scripts/app.js",
          content:
            "const { h, render } = globalThis.preact; const html = globalThis.htm.bind(h);",
        },
        copiedResourceFile(
          "/project/apps/inventory",
          "bootstrap-icons",
          "bootstrap-icons.min.css",
        ),
        copiedResourceFile(
          "/project/apps/inventory",
          "bootstrap-icons",
          "fonts/bootstrap-icons.woff2",
        ),
      ],
    },
    {
      runtimeBasePath: "/0123456789abcdef0123456789abcdef/runtime/",
    },
  );

  assert.equal(prepared.manifest.profile, "preact-htm");
  assert.deepEqual(prepared.manifest.resources, ["bootstrap-icons"]);
  const html = prepared.files.find(
    (file) => file.path === prepared.entryPath,
  )?.content;
  assert.ok(html);
  assert.match(html, /data-boltpocket-runtime="preact"/u);
  assert.match(html, /data-boltpocket-runtime="preact-hooks"/u);
  assert.match(html, /data-boltpocket-runtime="htm"/u);
  assert.match(html, /data-boltpocket-runtime="echarts"/u);
  assert.match(html, /\/0123456789abcdef0123456789abcdef\/runtime\//u);
  assert.doesNotMatch(html, /cdn\.jsdelivr/u);
  assert.doesNotMatch(html, /nonce|importmap/u);
});

test("rejects undeclared runtime profiles before creating a preview", () => {
  assert.throws(
    () =>
      prepareProjectPreview({
        projectId: "unsafe-project",
        entryPath: "/project/apps/unsafe/index.html",
        files: [
          {
            path: "/project/apps/unsafe/index.html",
            content: "<!doctype html><title>Unsafe</title>",
          },
          {
            path: "/project/apps/unsafe/boltpocket.h5.json",
            content: JSON.stringify({
              schema: 1,
              title: "Unsafe",
              entry: "index.html",
              profile: "remote-code",
              addons: [],
              permissions: [],
            }),
          },
        ],
      }),
    /场景框架/u,
  );
});

test("candidate filtering happens before connector reads", () => {
  const entry = "/project/workspace/game/index.html";
  assert.equal(
    isProjectPreviewCandidatePath(entry, "/project/workspace/game/index.html"),
    true,
  );
  assert.equal(
    isProjectPreviewCandidatePath(entry, "/project/workspace/game/game.js"),
    true,
  );
  assert.equal(
    isProjectPreviewCandidatePath(entry, "/project/workspace/game/.env"),
    false,
  );
  assert.equal(
    isProjectPreviewCandidatePath(entry, "/project/workspace/game/MEMORY.md"),
    false,
  );
  assert.equal(
    isProjectPreviewCandidatePath(entry, "/project/workspace/other.txt"),
    false,
  );
});

test("a manifest cannot claim a resource pack before files are copied into the project", () => {
  assert.throws(
    () =>
      prepareProjectPreview({
        projectId: "missing-resource-project",
        entryPath: "/project/apps/demo/index.html",
        files: [
          {
            path: "/project/apps/demo/index.html",
            content: "<!doctype html><title>Demo</title>",
          },
          {
            path: "/project/apps/demo/boltpocket.h5.json",
            content: JSON.stringify({
              schema: 1,
              title: "Demo",
              entry: "index.html",
              profile: "vanilla",
              addons: [],
              resources: ["kenney-ui"],
              permissions: [],
            }),
          },
        ],
      }),
    /尚未复制到项目/u,
  );
});

test("copied binary resources remain ordinary files in the portable preview tree", () => {
  const root = "/project/apps/demo";
  const copied = copiedResourceFile(
    root,
    "kenney-ui",
    "png/blue/arrow_basic_e_small.png",
  );
  const prepared = prepareProjectPreview({
    projectId: "copied-resource-project",
    entryPath: `${root}/index.html`,
    files: [
      {
        path: `${root}/index.html`,
        content:
          '<!doctype html><img src="./assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png">',
      },
      {
        path: `${root}/boltpocket.h5.json`,
        content: JSON.stringify({
          schema: 1,
          title: "Demo",
          entry: "index.html",
          profile: "vanilla",
          addons: [],
          resources: ["kenney-ui"],
          permissions: [],
        }),
      },
      copied,
    ],
  });

  const file = prepared.files.find(
    (candidate) => candidate.path === copied.path,
  );
  assert.equal(file?.relativePath, copied.path.slice(root.length + 1));
  assert.equal(file?.encoding, "base64");
  assert.equal(file?.byteLength, copied.byteLength);
});
