import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserPageFindResult,
  BrowserPageSnapshot,
  BrowserPageTextChunk,
} from "../../application/ports/browser-control.ts";
import {
  BrowserControlBridge,
  type BrowserControlDriver,
  type BrowserControlDriverStatus,
} from "./browser-control-bridge.ts";

const projectScope = { projectId: "launch", runId: "run-one" } as const;
const previewId = "0123456789abcdef0123456789abcdef";

function previewSnapshot(platform: "android" | "ios" = "android") {
  const rootUri = `file:///data/boltpocket/project-previews/${previewId}/`;
  return {
    id: previewId,
    projectId: projectScope.projectId,
    entryPath: "/project/game/index.html",
    displayPath: "index.html",
    url:
      platform === "ios"
        ? `http://127.0.0.1:54321/${previewId}/content/index.html`
        : `https://preview-${previewId}.boltpocket.invalid/content/index.html`,
    rootUri,
    fileCount: 3,
    byteLength: 512,
    contentSha256: "a".repeat(64),
    app: {
      schema: 1,
      title: "游戏",
      entry: "index.html",
      profile: "vanilla",
      addons: [],
      permissions: [],
    },
    runtime: { assetCount: 0, byteLength: 0 },
    createdAt: 1,
  } as const;
}

function closedStatus(): BrowserControlDriverStatus {
  return {
    taskId: null,
    mode: "closed",
    url: null,
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
}

function fixture() {
  const userTaskId = "browser-user";
  let activeTaskId = userTaskId;
  let taskSequence = 0;
  let closeFailure: Error | null = null;
  const statuses = new Map<string, BrowserControlDriverStatus>([
    [
      userTaskId,
      {
        taskId: userTaskId,
        mode: "minimized",
        url: "https://example.com/account?session=SECRET#private",
        title: "Private account",
        canGoBack: true,
        canGoForward: false,
        loading: false,
      },
    ],
  ]);
  let snapshot: BrowserPageSnapshot = {
    revision: "revision-one",
    url: statuses.get(userTaskId)!.url!,
    title: "Private account",
    text: "Visible page text",
    controls: [
      {
        id: "control-1",
        kind: "link",
        label: "Orders",
        actions: ["click"],
        href: "https://example.com/orders?token=SECRET",
      },
      {
        id: "control-2",
        kind: "link",
        label: "External",
        actions: ["click"],
        href: "https://other.example.net/",
      },
    ],
  };
  let textChunk: BrowserPageTextChunk = {
    revision: snapshot.revision,
    url: snapshot.url,
    title: snapshot.title,
    offset: 0,
    text: snapshot.text,
    totalLength: snapshot.text.length,
    nextOffset: null,
    truncated: false,
  };
  let findResult: BrowserPageFindResult = {
    revision: snapshot.revision,
    url: snapshot.url,
    title: snapshot.title,
    matches: [],
    totalMatches: 0,
    searchedLength: snapshot.text.length,
    truncated: false,
  };
  const queuedFindResults: BrowserPageFindResult[] = [];
  let onFindText: (() => void) | undefined;
  const calls: string[] = [];
  const driver: BrowserControlDriver = {
    status: (taskId = activeTaskId) => statuses.get(taskId) ?? closedStatus(),
    open: (url) => {
      const taskId = `browser-agent-${(taskSequence += 1).toString(10)}`;
      const status: BrowserControlDriverStatus = {
        taskId,
        mode: "minimized",
        url,
        title: "",
        canGoBack: false,
        canGoForward: false,
        loading: true,
      };
      statuses.set(taskId, status);
      calls.push(`open:${taskId}:${url}`);
      return status;
    },
    openPreview: (preview, present) => {
      const taskId = `browser-preview-${(taskSequence += 1).toString(10)}`;
      const status: BrowserControlDriverStatus = {
        taskId,
        mode: present ? "expanded" : "minimized",
        url: preview.url,
        title: `本地预览 · ${preview.displayPath}`,
        canGoBack: false,
        canGoForward: false,
        loading: true,
      };
      statuses.set(taskId, status);
      calls.push(`preview:${taskId}:${preview.url}`);
      return status;
    },
    close: (taskId) => {
      if (closeFailure) throw closeFailure;
      statuses.delete(taskId);
      calls.push(`close:${taskId}`);
    },
    snapshot: async () => snapshot,
    readText: async (taskId, offset) => {
      calls.push(`read-text:${taskId}:${offset.toString(10)}`);
      return textChunk;
    },
    findText: async (taskId, query) => {
      calls.push(`find-text:${taskId}:${query}`);
      onFindText?.();
      return queuedFindResults.shift() ?? findResult;
    },
    click: async (taskId, targetId, revision) => {
      calls.push(`click:${taskId}:${targetId}`);
      return {
        action: "click",
        revision,
        url: snapshot.url,
        targetId,
      };
    },
    type: async (taskId, targetId, revision, text) => {
      calls.push(`type:${taskId}:${targetId}:${text.length.toString(10)}`);
      return {
        action: "type",
        revision,
        url: snapshot.url,
        targetId,
        inputLength: text.length,
      };
    },
    navigate: (taskId, url) => {
      calls.push(`navigate:${taskId}:${url}`);
      const current = statuses.get(taskId);
      if (current) statuses.set(taskId, { ...current, url });
    },
    scroll: (taskId, direction) => {
      calls.push(`scroll:${taskId}:${direction}`);
    },
    highlight: (taskId, targetId) => {
      calls.push(`highlight:${taskId}:${targetId}`);
    },
    back: (taskId) => {
      calls.push(`back:${taskId}`);
    },
    forward: (taskId) => {
      calls.push(`forward:${taskId}`);
    },
    reload: (taskId) => {
      calls.push(`reload:${taskId}`);
    },
  };
  return {
    driver,
    calls,
    userTaskId,
    setActiveTaskId: (taskId: string) => {
      activeTaskId = taskId;
    },
    setCloseFailure: (error: Error | null) => {
      closeFailure = error;
    },
    setStatus: (taskId: string, next: BrowserControlDriverStatus) => {
      statuses.set(taskId, next);
    },
    setSnapshot: (next: BrowserPageSnapshot) => {
      snapshot = next;
    },
    setTextChunk: (next: BrowserPageTextChunk) => {
      textChunk = next;
    },
    setFindResult: (next: BrowserPageFindResult) => {
      findResult = next;
    },
    queueFindResults: (...results: BrowserPageFindResult[]) => {
      queuedFindResults.push(...results);
    },
    setFindTextHook: (hook?: () => void) => {
      onFindText = hook;
    },
  };
}

test("a user-owned page still requires an exact project and origin grant", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, userTaskId } = fixture();
  bridge.registerDriver(driver);

  assert.equal(bridge.runsWhileHidden(userTaskId), false);

  const status = await bridge.execute({ action: "status", ...projectScope });
  assert.equal(status.action, "status");
  if (status.action !== "status") throw new Error("unexpected result");
  assert.equal(status.authorized, false);
  assert.equal(status.managed, false);
  assert.equal(status.taskId, userTaskId);
  assert.equal(status.url, "https://example.com/account");
  assert.equal(status.title, "");
  await assert.rejects(
    bridge.execute({ action: "snapshot", ...projectScope }),
    /尚未获准/u,
  );

  bridge.grant("launch", "https://example.com/account");
  const granted = await bridge.execute({ action: "status", ...projectScope });
  const other = await bridge.execute({
    action: "status",
    projectId: "another",
    runId: "run-two",
  });
  assert.equal(granted.action, "status");
  assert.equal(other.action, "status");
  if (granted.action !== "status" || other.action !== "status") {
    throw new Error("unexpected result");
  }
  assert.equal(granted.authorized, true);
  assert.equal(other.authorized, false);
});

test("user-granted snapshots and same-origin links do not expose URL secrets", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, userTaskId } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/account");

  const result = await bridge.execute({
    action: "snapshot",
    ...projectScope,
  });
  assert.equal(result.action, "snapshot");
  if (result.action !== "snapshot") throw new Error("unexpected result");
  assert.equal(result.taskId, userTaskId);
  assert.equal(result.snapshot.url, "https://example.com/account");
  assert.equal(result.snapshot.controls[0]?.href, "https://example.com/orders");
  assert.deepEqual(result.snapshot.controls[0]?.actions, []);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/u);

  await bridge.execute({
    action: "follow_link",
    ...projectScope,
    revision: "revision-one",
    targetId: "control-1",
  });
  assert.deepEqual(calls, [
    `navigate:${userTaskId}:https://example.com/orders?token=SECRET`,
  ]);
  await assert.rejects(
    bridge.execute({
      action: "follow_link",
      ...projectScope,
      revision: "revision-one",
      targetId: "control-2",
    }),
    /跨网站/u,
  );
});

test("Agent can create, use across origins, and close only its own temporary page", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, setSnapshot, userTaskId } = fixture();
  bridge.registerDriver(driver);

  const opened = await bridge.execute({
    action: "open",
    ...projectScope,
    url: "https://example.com/start?q=private",
  });
  assert.equal(opened.action, "open");
  if (opened.action !== "open") throw new Error("unexpected result");
  assert.equal(opened.url, "https://example.com/start");
  assert.equal(opened.managed, true);
  assert.equal(bridge.isManaged("launch", opened.taskId), true);
  assert.equal(bridge.isManaged("another", opened.taskId), false);
  assert.equal(bridge.runsWhileHidden(opened.taskId), true);

  setSnapshot({
    revision: "agent-page",
    url: "https://example.com/start?q=private",
    title: "Start",
    text: "Current information",
    controls: [
      {
        id: "control-1",
        kind: "link",
        label: "External source",
        actions: ["click"],
        href: "https://other.example.net/report?token=SECRET",
      },
    ],
  });
  const snapshot = await bridge.execute({
    action: "snapshot",
    ...projectScope,
    taskId: opened.taskId,
  });
  assert.equal(snapshot.action, "snapshot");
  await bridge.execute({
    action: "follow_link",
    ...projectScope,
    taskId: opened.taskId,
    revision: "agent-page",
    targetId: "control-1",
  });
  assert.equal(
    calls.at(-1),
    `navigate:${opened.taskId}:https://other.example.net/report?token=SECRET`,
  );

  await assert.rejects(
    bridge.execute({
      action: "status",
      projectId: "launch",
      runId: "another-run",
      taskId: opened.taskId,
    }),
    /不属于/u,
  );
  await assert.rejects(
    bridge.execute({
      action: "close",
      ...projectScope,
      taskId: userTaskId,
    }),
    /只能关闭/u,
  );

  const closed = await bridge.execute({
    action: "close",
    ...projectScope,
    taskId: opened.taskId,
  });
  assert.equal(closed.action, "close");
  assert.equal(calls.at(-1), `close:${opened.taskId}`);
  assert.equal(bridge.isManaged("launch", opened.taskId), false);
  assert.equal(bridge.runsWhileHidden(opened.taskId), false);
});

test("Agent-owned pages can click and type only snapshot-listed controls", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, setSnapshot } = fixture();
  bridge.registerDriver(driver);
  const opened = await bridge.execute({
    action: "open",
    ...projectScope,
    url: "https://example.com/search",
  });
  if (opened.action !== "open") throw new Error("unexpected result");
  setSnapshot({
    revision: "interactive-one",
    url: "https://example.com/search",
    title: "Search",
    text: "Search this site",
    controls: [
      {
        id: "control-1",
        kind: "input",
        label: "Query",
        actions: ["type"],
      },
      {
        id: "control-2",
        kind: "button",
        label: "Open filters",
        actions: ["click"],
      },
      {
        id: "control-3",
        kind: "link",
        label: "Results",
        actions: ["click"],
        href: "https://example.com/results?q=private",
      },
      {
        id: "control-4",
        kind: "input",
        label: "Password",
        actions: [],
        sensitive: true,
      },
    ],
  });

  const typed = await bridge.execute({
    action: "type",
    ...projectScope,
    taskId: opened.taskId,
    revision: "interactive-one",
    targetId: "control-1",
    text: "quarterly report",
  });
  assert.equal(typed.action, "type");
  if (typed.action !== "type") throw new Error("unexpected result");
  assert.equal(typed.inputLength, 16);
  assert.equal(calls.at(-1), `type:${opened.taskId}:control-1:16`);

  const clicked = await bridge.execute({
    action: "click",
    ...projectScope,
    taskId: opened.taskId,
    revision: "interactive-one",
    targetId: "control-2",
  });
  assert.equal(clicked.action, "click");
  assert.equal(calls.at(-1), `click:${opened.taskId}:control-2`);

  await assert.rejects(
    bridge.execute({
      action: "type",
      ...projectScope,
      taskId: opened.taskId,
      revision: "interactive-one",
      targetId: "control-4",
      text: "must-not-be-typed",
    }),
    /不允许/u,
  );
  await bridge.execute({
    action: "click",
    ...projectScope,
    taskId: opened.taskId,
    revision: "interactive-one",
    targetId: "control-3",
  });
  assert.equal(
    calls.at(-1),
    `navigate:${opened.taskId}:https://example.com/results?q=private`,
  );
});

test("user-owned and permission-bearing preview pages remain non-interactive for Agent", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, userTaskId, setSnapshot } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/account");

  await assert.rejects(
    bridge.execute({
      action: "click",
      ...projectScope,
      taskId: userTaskId,
      revision: "revision-one",
      targetId: "control-1",
    }),
    /临时网页或安全项目预览/u,
  );

  const basePreview = previewSnapshot();
  const preview = {
    ...basePreview,
    app: { ...basePreview.app, permissions: ["camera"] as const },
  };
  const opened = await bridge.execute({
    action: "preview",
    ...projectScope,
    snapshot: preview,
    present: false,
  });
  if (opened.action !== "preview") throw new Error("unexpected result");
  setSnapshot({
    revision: "preview-interactive",
    url: preview.url,
    title: "Preview",
    text: "Demo",
    controls: [
      {
        id: "control-1",
        kind: "button",
        label: "Start",
        actions: ["click"],
      },
    ],
  });
  const permissionPage = await bridge.execute({
    action: "snapshot",
    ...projectScope,
    taskId: opened.taskId,
  });
  assert.equal(permissionPage.action, "snapshot");
  if (permissionPage.action !== "snapshot") {
    throw new Error("unexpected result");
  }
  assert.deepEqual(permissionPage.snapshot.controls[0]?.actions, []);
  await assert.rejects(
    bridge.execute({
      action: "click",
      ...projectScope,
      taskId: opened.taskId,
      revision: "preview-interactive",
      targetId: "control-1",
    }),
    /声明了原生权限/u,
  );
});

test("permission-free Agent previews can be smoke-tested and reload on run cleanup", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, setSnapshot } = fixture();
  bridge.registerDriver(driver);
  const preview = previewSnapshot();
  const opened = await bridge.execute({
    action: "preview",
    ...projectScope,
    snapshot: preview,
    present: false,
  });
  if (opened.action !== "preview") throw new Error("unexpected result");
  setSnapshot({
    revision: "preview-safe-interactive",
    url: preview.url,
    title: "Preview",
    text: "Player Start",
    controls: [
      {
        id: "control-1",
        kind: "input",
        label: "Player",
        actions: ["type"],
      },
      {
        id: "control-2",
        kind: "button",
        label: "Start",
        actions: ["click"],
      },
    ],
  });

  await bridge.execute({
    action: "type",
    ...projectScope,
    taskId: opened.taskId,
    revision: "preview-safe-interactive",
    targetId: "control-1",
    text: "Tester",
  });
  await bridge.execute({
    action: "click",
    ...projectScope,
    taskId: opened.taskId,
    revision: "preview-safe-interactive",
    targetId: "control-2",
  });
  assert.equal(calls.at(-1), `click:${opened.taskId}:control-2`);

  await bridge.closeRun(projectScope.projectId, projectScope.runId);
  assert.equal(calls.at(-1), `reload:${opened.taskId}`);
  assert.equal(calls.includes(`close:${opened.taskId}`), false);
  assert.equal(bridge.isManaged(projectScope.projectId, opened.taskId), true);
});

test("run cleanup closes every remaining Agent page and leaves user pages intact", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, userTaskId } = fixture();
  bridge.registerDriver(driver);
  const first = await bridge.execute({
    action: "open",
    ...projectScope,
    url: "https://example.com/one",
  });
  const second = await bridge.execute({
    action: "open",
    ...projectScope,
    url: "https://example.com/two",
  });
  if (first.action !== "open" || second.action !== "open") {
    throw new Error("unexpected result");
  }

  await bridge.closeRun("launch", "run-one");

  assert.equal(bridge.isManaged("launch", first.taskId), false);
  assert.equal(bridge.isManaged("launch", second.taskId), false);
  assert.equal(calls.includes(`close:${first.taskId}`), true);
  assert.equal(calls.includes(`close:${second.taskId}`), true);
  const userStatus = driver.status(userTaskId);
  assert.equal(userStatus.taskId, userTaskId);
});

test("a handed-off project preview stays open after the run and hides private URLs", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, setSnapshot } = fixture();
  bridge.registerDriver(driver);
  const preview = previewSnapshot();

  const opened = await bridge.execute({
    action: "preview",
    ...projectScope,
    snapshot: preview,
    present: true,
  });
  assert.equal(opened.action, "preview");
  if (opened.action !== "preview") throw new Error("unexpected result");
  assert.equal(opened.handedOff, true);
  assert.equal(bridge.runsWhileHidden(opened.taskId), false);
  assert.equal(opened.url, "project-preview://launch/index.html");
  assert.doesNotMatch(JSON.stringify(opened), /file:\/\/|boltpocket\.invalid/u);

  setSnapshot({
    revision: "snake-preview-one",
    url: preview.url,
    title: "贪吃蛇",
    text: "分数 0",
    controls: [],
  });
  const page = await bridge.execute({
    action: "snapshot",
    ...projectScope,
    taskId: opened.taskId,
  });
  assert.equal(page.action, "snapshot");
  if (page.action !== "snapshot") throw new Error("unexpected result");
  assert.equal(page.snapshot.url, "project-preview://launch/index.html");
  await assert.rejects(
    bridge.execute({
      action: "navigate",
      ...projectScope,
      taskId: opened.taskId,
      url: "https://example.com/",
    }),
    /不能导航/u,
  );

  await bridge.closeRun(projectScope.projectId, projectScope.runId);
  assert.equal(bridge.isManaged(projectScope.projectId, opened.taskId), true);
  assert.equal(calls.includes(`close:${opened.taskId}`), false);

  await assert.rejects(
    bridge.execute({
      action: "close",
      ...projectScope,
      taskId: opened.taskId,
    }),
    /只能关闭/u,
  );
  assert.equal(calls.includes(`close:${opened.taskId}`), false);
});

test("iOS loopback previews are limited to their private snapshot origin and route", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, setSnapshot } = fixture();
  bridge.registerDriver(driver);
  const preview = previewSnapshot("ios");
  const opened = await bridge.execute({
    action: "preview",
    ...projectScope,
    snapshot: preview,
    present: false,
  });
  if (opened.action !== "preview") throw new Error("unexpected result");

  setSnapshot({
    revision: "ios-preview-one",
    url: `http://127.0.0.1:54321/${previewId}/content/assets/game.js`,
    title: "asset",
    text: "local asset",
    controls: [],
  });
  await assert.doesNotReject(
    bridge.execute({
      action: "snapshot",
      ...projectScope,
      taskId: opened.taskId,
    }),
  );

  setSnapshot({
    revision: "ios-preview-escape",
    url: `http://127.0.0.1:54321/${previewId}/private.txt`,
    title: "outside",
    text: "private",
    controls: [],
  });
  await assert.rejects(
    bridge.execute({
      action: "snapshot",
      ...projectScope,
      taskId: opened.taskId,
    }),
    /不支持的地址/u,
  );

  setSnapshot({
    revision: "ios-preview-origin-escape",
    url: `http://127.0.0.1:54322/${previewId}/content/index.html`,
    title: "other origin",
    text: "private",
    controls: [],
  });
  await assert.rejects(
    bridge.execute({
      action: "snapshot",
      ...projectScope,
      taskId: opened.taskId,
    }),
    /不支持的地址/u,
  );
});

test("project preview metadata cannot widen its private boundary", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls } = fixture();
  bridge.registerDriver(driver);
  const valid = previewSnapshot();
  const invalidSnapshots = [
    { ...valid, displayPath: "../index.html" },
    { ...valid, url: `${valid.url}?session=private` },
    {
      ...valid,
      rootUri: `file://remote/data/boltpocket/project-previews/${previewId}/`,
    },
  ];

  for (const snapshot of invalidSnapshots) {
    await assert.rejects(
      bridge.execute({
        action: "preview",
        ...projectScope,
        snapshot,
        present: true,
      }),
      /项目预览/u,
    );
  }
  assert.equal(
    calls.some((call) => call.startsWith("preview:")),
    false,
  );
});

test("a failed close keeps ownership so cleanup can retry the temporary page", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, setCloseFailure } = fixture();
  bridge.registerDriver(driver);
  const opened = await bridge.execute({
    action: "open",
    ...projectScope,
    url: "https://example.com/retry-close",
  });
  if (opened.action !== "open") throw new Error("unexpected result");
  setCloseFailure(new Error("temporary close failure"));

  await assert.rejects(
    bridge.execute({
      action: "close",
      ...projectScope,
      taskId: opened.taskId,
    }),
    /temporary close failure/u,
  );
  assert.equal(bridge.isManaged("launch", opened.taskId), true);

  setCloseFailure(null);
  await bridge.closeRun("launch", "run-one");
  assert.equal(bridge.isManaged("launch", opened.taskId), false);
});

test("stale page revisions fail closed while local HTTP(S) origins may be granted", async () => {
  const bridge = new BrowserControlBridge();
  const { driver } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/");

  await assert.rejects(
    bridge.execute({
      action: "highlight",
      ...projectScope,
      revision: "stale",
      targetId: "control-1",
    }),
    /已变化/u,
  );
  assert.doesNotThrow(() => bridge.grant("launch", "http://192.168.1.1/"));
  assert.equal(bridge.isGranted("launch", "http://192.168.1.1/login"), true);
});

test("long-page reads and searches stay revision-bound and redact URL secrets", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, calls, setFindResult, setTextChunk, userTaskId } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/account");

  setTextChunk({
    revision: "revision-one",
    url: "https://example.com/account?session=SECRET#private",
    title: "Private account",
    offset: 0,
    text: "first",
    totalLength: 11,
    nextOffset: 5,
    truncated: false,
  });
  const read = await bridge.execute({
    action: "read_text",
    ...projectScope,
    revision: "revision-one",
    offset: 0,
  });
  assert.equal(read.action, "read_text");
  if (read.action !== "read_text") throw new Error("unexpected result");
  assert.equal(read.taskId, userTaskId);
  assert.equal(read.chunk.url, "https://example.com/account");
  assert.equal(read.chunk.nextOffset, 5);

  setFindResult({
    revision: "revision-one",
    url: "https://example.com/account?session=SECRET#private",
    title: "Private account",
    matches: [{ offset: 12, snippet: "matching report text" }],
    totalMatches: 1,
    searchedLength: 120,
    truncated: false,
  });
  const found = await bridge.execute({
    action: "find_text",
    ...projectScope,
    revision: "revision-one",
    query: " report ",
  });
  assert.equal(found.action, "find_text");
  if (found.action !== "find_text") throw new Error("unexpected result");
  assert.equal(found.result.url, "https://example.com/account");
  assert.equal(found.result.totalMatches, 1);
  assert.doesNotMatch(JSON.stringify(found), /SECRET/u);
  assert.equal(calls.includes(`read-text:${userTaskId}:0`), true);
  assert.equal(calls.includes(`find-text:${userTaskId}:report`), true);

  await assert.rejects(
    bridge.execute({
      action: "read_text",
      ...projectScope,
      revision: "stale",
      offset: 0,
    }),
    /已变化/u,
  );
  await assert.rejects(
    bridge.execute({
      action: "find_text",
      ...projectScope,
      revision: "stale",
      query: "report",
    }),
    /已变化/u,
  );
});

test("dynamic text waits poll within a bound and never activate page controls", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, queueFindResults, userTaskId } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/account");
  const base = {
    revision: "dynamic-one",
    url: "https://example.com/account?session=SECRET",
    title: "Private account",
    searchedLength: 120,
    truncated: false,
  } as const;
  queueFindResults(
    { ...base, matches: [], totalMatches: 0 },
    {
      ...base,
      revision: "dynamic-two",
      matches: [{ offset: 40, snippet: "Report is ready" }],
      totalMatches: 1,
    },
  );

  const result = await bridge.execute({
    action: "wait_for_text",
    ...projectScope,
    query: "Report is ready",
    condition: "present",
    timeoutMs: 1_000,
  });
  assert.equal(result.action, "wait_for_text");
  if (result.action !== "wait_for_text") throw new Error("unexpected result");
  assert.equal(result.taskId, userTaskId);
  assert.equal(result.matched, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.result.totalMatches, 1);
  assert.equal(result.result.url, "https://example.com/account");
  assert.ok(result.waitedMs >= 0 && result.waitedMs <= 1_000);

  const timedOut = await bridge.execute({
    action: "wait_for_text",
    ...projectScope,
    query: "Never appears",
    condition: "present",
    timeoutMs: 0,
  });
  assert.equal(timedOut.action, "wait_for_text");
  if (timedOut.action !== "wait_for_text") {
    throw new Error("unexpected result");
  }
  assert.equal(timedOut.matched, false);
  assert.equal(timedOut.timedOut, true);
});

test("dynamic text waits stop when a user-page grant is revoked", async () => {
  const bridge = new BrowserControlBridge();
  const { driver, setFindTextHook } = fixture();
  bridge.registerDriver(driver);
  bridge.grant("launch", "https://example.com/account");
  setFindTextHook(() => {
    setFindTextHook();
    bridge.revoke("launch", "https://example.com/account");
  });

  await assert.rejects(
    bridge.execute({
      action: "wait_for_text",
      ...projectScope,
      query: "Report is ready",
      condition: "present",
      timeoutMs: 1_000,
    }),
    /授权已经失效/u,
  );
});
