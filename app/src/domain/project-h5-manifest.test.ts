import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultProjectH5Manifest,
  parseProjectH5Manifest,
} from "./project-h5-manifest.ts";

test("validates a pinned H5 scene manifest", () => {
  const manifest = parseProjectH5Manifest(
    JSON.stringify({
      schema: 3,
      title: "  库存   看板  ",
      description: "本机库存和趋势",
      entry: "index.html",
      profile: "preact-htm",
      addons: ["echarts"],
      resources: ["bootstrap-icons", "kenney-ui"],
      permissions: [
        {
          id: "camera",
          purpose: "扫描商品条码",
          mode: "once",
          recipients: ["inventory-api"],
        },
        {
          id: "barcodeDetection",
          purpose: "识别镜头中的商品条码",
          mode: "once",
          recipients: [],
        },
      ],
      network: [
        {
          id: "inventory-api",
          origin: "https://inventory.example.com",
          purpose: "查询条码对应的商品库存",
        },
      ],
    }),
    "index.html",
  );

  assert.deepEqual(manifest, {
    schema: 3,
    title: "库存 看板",
    description: "本机库存和趋势",
    entry: "index.html",
    profile: "preact-htm",
    addons: ["echarts"],
    resources: ["bootstrap-icons", "kenney-ui"],
    permissions: ["camera", "barcodeDetection"],
    permissionDeclarations: [
      {
        id: "camera",
        purpose: "扫描商品条码",
        mode: "once",
        recipients: ["inventory-api"],
      },
      {
        id: "barcodeDetection",
        purpose: "识别镜头中的商品条码",
        mode: "once",
        recipients: [],
      },
    ],
    network: [
      {
        id: "inventory-api",
        origin: "https://inventory.example.com",
        purpose: "查询条码对应的商品库存",
      },
    ],
  });
});

test("defaults manifestless project pages to Preact without permissions", () => {
  assert.deepEqual(createDefaultProjectH5Manifest("index.html", "旧页面"), {
    schema: 3,
    title: "旧页面",
    entry: "index.html",
    profile: "preact-htm",
    addons: [],
    resources: [],
    permissions: [],
    permissionDeclarations: [],
    network: [],
  });
});

test("normalizes schema 2 permission purposes and fixed consent modes", () => {
  const manifest = parseProjectH5Manifest(
    JSON.stringify({
      schema: 2,
      title: "附近门店",
      entry: "index.html",
      profile: "preact-htm",
      addons: [],
      resources: [],
      permissions: [
        {
          id: "location",
          purpose: "  显示   用户附近的门店  ",
          mode: "once",
        },
        {
          id: "motionSensors",
          purpose: "控制当前小游戏角色",
          mode: "session",
        },
      ],
    }),
    "index.html",
  );

  assert.deepEqual(manifest.permissions, ["location", "motionSensors"]);
  assert.deepEqual(manifest.permissionDeclarations, [
    { id: "location", purpose: "显示 用户附近的门店", mode: "once" },
    {
      id: "motionSensors",
      purpose: "控制当前小游戏角色",
      mode: "session",
    },
  ]);
});

test("rejects schema 2 permissions without a purpose or with a weaker mode", () => {
  const base = {
    schema: 2,
    title: "应用",
    entry: "index.html",
    profile: "vanilla",
    addons: [],
    resources: [],
  };
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({
          ...base,
          permissions: [{ id: "location", mode: "session", purpose: "定位" }],
        }),
        "index.html",
      ),
    /授权方式/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({
          ...base,
          permissions: [{ id: "camera", mode: "once" }],
        }),
        "index.html",
      ),
    /权限/u,
  );
});

test("keeps legacy offline apps but rejects legacy permission declarations", () => {
  const base = {
    schema: 1,
    title: "旧应用",
    entry: "index.html",
    profile: "vanilla",
    addons: [],
    resources: [],
  };
  assert.equal(
    parseProjectH5Manifest(
      JSON.stringify({ ...base, permissions: [] }),
      "index.html",
    ).permissions.length,
    0,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, permissions: ["camera"] }),
        "index.html",
      ),
    /升级到 schema 3/u,
  );
});

test("requires exact canonical network origins and declared recipients", () => {
  const base = {
    schema: 3,
    title: "联网应用",
    entry: "index.html",
    profile: "vanilla",
    addons: [],
    resources: [],
  };
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({
          ...base,
          permissions: [],
          network: [
            {
              id: "api",
              origin: "https://example.com/path",
              purpose: "读取公开数据",
            },
          ],
        }),
        "index.html",
      ),
    /精确/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({
          ...base,
          permissions: [
            {
              id: "location",
              purpose: "查询附近门店",
              mode: "once",
              recipients: ["missing-api"],
            },
          ],
          network: [],
        }),
        "index.html",
      ),
    /接收方/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({
          ...base,
          permissions: [
            {
              id: "clipboardWrite",
              purpose: "复制结果",
              mode: "once",
            },
          ],
          network: [
            {
              id: "api",
              origin: "https://example.com",
              purpose: "同步结果",
            },
          ],
        }),
        "index.html",
      ),
    /必须.*recipients/u,
  );
  assert.deepEqual(
    parseProjectH5Manifest(
      JSON.stringify({
        ...base,
        permissions: [
          {
            id: "clipboardWrite",
            purpose: "只在页面内复制结果",
            mode: "once",
            recipients: [],
          },
        ],
        network: [
          {
            id: "api",
            origin: "https://example.com",
            purpose: "读取公开数据",
          },
        ],
      }),
      "index.html",
    ).permissionDeclarations?.[0]?.recipients,
    [],
  );
});

test("rejects unknown code profiles, hidden fields and undeclared entries", () => {
  const base = {
    schema: 1,
    title: "应用",
    entry: "index.html",
    profile: "vanilla",
    addons: [],
    resources: [],
    permissions: [],
  };
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, profile: "alpine-csp" }),
        "index.html",
      ),
    /场景框架/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, profile: "https://cdn.example/app.js" }),
        "index.html",
      ),
    /场景框架/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, remoteScript: "https://example.com/a.js" }),
        "index.html",
      ),
    /结构/u,
  );
  assert.throws(
    () => parseProjectH5Manifest(JSON.stringify(base), "pages/home.html"),
    /入口/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, permissions: ["camera", "camera"] }),
        "index.html",
      ),
    /权限/u,
  );
  assert.throws(
    () =>
      parseProjectH5Manifest(
        JSON.stringify({ ...base, resources: ["unknown-pack"] }),
        "index.html",
      ),
    /内置资源/u,
  );
});
