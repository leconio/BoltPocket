import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserTask } from "./browser-provider.tsx";
import {
  browserTaskDetail,
  browserTaskTitle,
} from "./browser-task-presentation.ts";
import { translateMessage } from "@/i18n/messages.ts";

const t = (key: Parameters<typeof translateMessage>[0]) =>
  translateMessage(key, "zh-CN");

const navigation = {
  url: "https://example.com/docs/one",
  title: "  Project   documentation  ",
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

test("browser tabs prefer page titles and retain the host as a stable detail", () => {
  const task: BrowserTask = {
    id: "browser-web",
    createdAt: 1,
    source: { kind: "web" },
    navigation,
    navigationRequest: { id: 1, url: navigation.url },
  };
  assert.equal(browserTaskTitle(task, t), "Project documentation");
  assert.equal(browserTaskDetail(task, t), "example.com");
});

test("project previews use their application directory instead of an internal URL", () => {
  const task: BrowserTask = {
    id: "browser-preview",
    createdAt: 1,
    source: {
      kind: "project-preview",
      agentOwned: false,
      snapshot: {
        id: "0123456789abcdef0123456789abcdef",
        projectId: "project-one",
        entryPath: "/project/apps/snake/index.html",
        displayPath: "apps/snake/index.html",
        rootUri: "file:///private/preview/0123456789abcdef0123456789abcdef/",
        url: "http://127.0.0.1:54321/0123456789abcdef0123456789abcdef/content/index.html",
        fileCount: 3,
        byteLength: 128,
        contentSha256: "a".repeat(64),
        app: {
          schema: 1,
          title: "贪吃蛇",
          entry: "index.html",
          profile: "vanilla",
          addons: [],
          permissions: [],
        },
        runtime: { assetCount: 0, byteLength: 0 },
        createdAt: 1,
      },
    },
    navigation: {
      ...navigation,
      title: "",
      url: "http://127.0.0.1:54321/0123456789abcdef0123456789abcdef/content/index.html",
    },
    navigationRequest: {
      id: 1,
      url: "http://127.0.0.1:54321/0123456789abcdef0123456789abcdef/content/index.html",
    },
  };
  assert.equal(browserTaskTitle(task, t), "贪吃蛇");
  assert.equal(browserTaskDetail(task, t), "本地预览");
});
