import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  AGENT_READ_ONLY_INTERACTION_GUARD_SCRIPT,
  createBrowserClickScript,
  createBrowserFindTextScript,
  createBrowserHighlightScript,
  createBrowserLocationWatchEventScript,
  createBrowserNativeResponseScript,
  createBrowserReadTextScript,
  createBrowserSnapshotScript,
  createBrowserTypeScript,
  parseBrowserWebViewMessage,
} from "./browser-webview-protocol.ts";

const nativeBridgeToken = "0123456789abcdef0123456789abcdef";

test("browser scripts interpolate only validated identifiers", () => {
  const snapshot = createBrowserSnapshotScript("browser-request-one");
  assert.match(snapshot, /data-boltpocket-agent-control/u);
  assert.doesNotMatch(snapshot, /\.value/u);
  assert.throws(() => createBrowserSnapshotScript("invalid request"));
  assert.throws(() =>
    createBrowserHighlightScript(
      "browser-request-one",
      "control-1'];alert(1)//",
    ),
  );
  assert.throws(() => createBrowserReadTextScript("browser-request-one", -1));
  assert.throws(() =>
    createBrowserFindTextScript("browser-request-one", " ".repeat(10)),
  );
  assert.throws(() =>
    createBrowserClickScript(
      "browser-request-one",
      "control-1'];alert(1)//",
      "revision-one",
    ),
  );
  assert.throws(() =>
    createBrowserTypeScript(
      "browser-request-one",
      "control-1",
      "revision-one",
      "x".repeat(4_001),
    ),
  );
});

function executePageScript(script: string, pageText: string) {
  const messages: string[] = [];
  runInNewContext(script, {
    document: {
      body: { innerText: pageText },
      readyState: "complete",
      title: "Long report",
      querySelectorAll: () => [],
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: { href: "https://example.com/report?secret=hidden" },
    URL,
    window: {
      ReactNativeWebView: {
        postMessage: (message: string) => messages.push(message),
      },
    },
  });
  assert.equal(messages.length, 1);
  const message = JSON.parse(messages[0]!) as {
    ok: boolean;
    result: Record<string, unknown>;
  };
  assert.equal(message.ok, true);
  return message.result;
}

test("long-page browser scripts return bounded chunks and full-page matches", () => {
  const pageText = `${"a".repeat(16_100)} Report is ready ${"z".repeat(1_000)}`;
  const chunk = executePageScript(
    createBrowserReadTextScript("browser-request-read", 16_000),
    pageText,
  );
  assert.equal(chunk.offset, 16_000);
  assert.equal(chunk.searchedLength, pageText.length);
  assert.match(String(chunk.text), /Report is ready/u);
  assert.equal(chunk.nextOffset, null);
  assert.equal(chunk.truncated, false);

  const found = executePageScript(
    createBrowserFindTextScript("browser-request-find", "report IS ready"),
    pageText,
  );
  assert.equal(found.totalMatches, 1);
  assert.equal(Array.isArray(found.matches), true);
  const match = (found.matches as { offset: number; snippet: string }[])[0];
  assert.equal(match?.offset, 16_101);
  assert.match(match?.snippet ?? "", /a+ Report is ready z+$/u);
  assert.ok((match?.snippet.length ?? 321) <= 320);
  assert.equal(found.truncated, false);

  const escaped = executePageScript(
    createBrowserFindTextScript("browser-request-escaped", "a+b [ready]"),
    "prefix A+B [READY] suffix",
  );
  assert.deepEqual(escaped.matches, [
    { offset: 7, snippet: "prefix A+B [READY] suffix" },
  ]);

  const oversized = executePageScript(
    createBrowserReadTextScript("browser-request-bounded", 240_000),
    "x".repeat(300_000),
  );
  assert.equal(oversized.searchedLength, 256_000);
  assert.equal(String(oversized.text).length, 16_000);
  assert.equal(oversized.nextOffset, null);
  assert.equal(oversized.truncated, true);
});

test("page revisions cover searchable text beyond the first returned segment", () => {
  const prefix = "x".repeat(20_000);
  const first = executePageScript(
    createBrowserSnapshotScript("browser-request-revision-one"),
    `${prefix} first tail`,
  );
  const second = executePageScript(
    createBrowserSnapshotScript("browser-request-revision-two"),
    `${prefix} second tail`,
  );
  assert.notEqual(first.revision, second.revision);
});

type FakeControl = {
  tagName: string;
  innerText: string;
  disabled: boolean;
  readOnly: boolean;
  maxLength: number;
  value: string;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  closest: () => null;
  getBoundingClientRect: () => { width: number; height: number };
  scrollIntoView: () => void;
  focus: () => void;
  click: () => void;
  dispatchEvent: () => boolean;
};

function interactiveFixture(
  tagName: "INPUT" | "BUTTON",
  formBound = false,
  buttonLabel = "Filters",
) {
  const attributes = new Map<string, string>();
  attributes.set("aria-label", tagName === "INPUT" ? "Search" : buttonLabel);
  if (tagName === "INPUT") attributes.set("type", "search");
  else attributes.set("type", "button");
  let clicked = 0;
  let inputEvents = 0;
  const values = new WeakMap<object, string>();
  class FakeInput {
    get value() {
      return values.get(this) ?? "";
    }

    set value(next: string) {
      values.set(this, next);
    }
  }
  class FakeTextArea {
    get value() {
      return values.get(this) ?? "";
    }

    set value(next: string) {
      values.set(this, next);
    }
  }
  const element = new FakeInput() as FakeInput & FakeControl;
  Object.assign(element, {
    tagName,
    innerText: "",
    disabled: false,
    readOnly: false,
    maxLength: -1,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    closest: () => (formBound ? ({} as never) : null),
    getBoundingClientRect: () => ({ width: 120, height: 44 }),
    scrollIntoView: () => undefined,
    focus: () => undefined,
    click: () => {
      clicked += 1;
    },
    dispatchEvent: () => {
      inputEvents += 1;
      return true;
    },
  });
  const messages: string[] = [];
  const window = {
    __boltpocketActivateAgentReadOnlyInteraction: () => true,
    ReactNativeWebView: {
      postMessage: (message: string) => messages.push(message),
    },
  };
  const context = {
    document: {
      body: { innerText: "Search this site" },
      readyState: "complete",
      title: "Search",
      querySelectorAll: () => [element],
      querySelector: () => element,
    },
    Event: class FakeEvent {},
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    InputEvent: class FakeInputEvent {},
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: { href: "https://example.com/search" },
    URL,
    window,
  };
  const execute = (script: string) => {
    messages.length = 0;
    runInNewContext(script, context);
    assert.equal(messages.length, 1);
    return JSON.parse(messages[0]!) as {
      ok: boolean;
      result: Record<string, unknown>;
    };
  };
  return {
    element,
    execute,
    clicked: () => clicked,
    inputEvents: () => inputEvents,
  };
}

test("interaction scripts bind click and input to the current page revision", () => {
  const input = interactiveFixture("INPUT");
  const snapshot = input.execute(
    createBrowserSnapshotScript("browser-request-interactive-snapshot"),
  );
  const revision = String(snapshot.result.revision);
  assert.deepEqual(
    (snapshot.result.controls as { actions: string[] }[])[0]?.actions,
    ["type"],
  );
  const typed = input.execute(
    createBrowserTypeScript(
      "browser-request-interactive-type",
      "control-1",
      revision,
      "quarterly report",
    ),
  );
  assert.equal(typed.ok, true);
  assert.equal(input.element.value, "quarterly report");
  assert.equal(input.inputEvents(), 1);
  assert.equal(typed.result.inputLength, 16);
  assert.equal("value" in typed.result, false);
  const stale = input.execute(
    createBrowserTypeScript(
      "browser-request-interactive-stale",
      "control-1",
      "stale-revision",
      "ignored",
    ),
  );
  assert.equal(stale.ok, false);
  assert.equal(input.element.value, "quarterly report");

  const button = interactiveFixture("BUTTON");
  const buttonSnapshot = button.execute(
    createBrowserSnapshotScript("browser-request-button-snapshot"),
  );
  assert.deepEqual(
    (buttonSnapshot.result.controls as { actions: string[] }[])[0]?.actions,
    ["click"],
  );
  const clicked = button.execute(
    createBrowserClickScript(
      "browser-request-button-click",
      "control-1",
      String(buttonSnapshot.result.revision),
    ),
  );
  assert.equal(clicked.ok, true);
  assert.equal(button.clicked(), 1);

  const formButton = interactiveFixture("BUTTON", true);
  const formSnapshot = formButton.execute(
    createBrowserSnapshotScript("browser-request-form-button-snapshot"),
  );
  assert.deepEqual(
    (formSnapshot.result.controls as { actions: string[] }[])[0]?.actions,
    ["click"],
  );
  const formButtonClick = formButton.execute(
    createBrowserClickScript(
      "browser-request-form-button-click",
      "control-1",
      String(formSnapshot.result.revision),
    ),
  );
  assert.equal(formButtonClick.ok, true);
  assert.equal(formButton.clicked(), 1);

  const submitButton = interactiveFixture("BUTTON", true);
  submitButton.element.setAttribute("type", "submit");
  const submitSnapshot = submitButton.execute(
    createBrowserSnapshotScript("browser-request-submit-button-snapshot"),
  );
  assert.deepEqual(
    (submitSnapshot.result.controls as { actions: string[] }[])[0]?.actions,
    [],
  );

  const destructiveButton = interactiveFixture(
    "BUTTON",
    false,
    "Delete account",
  );
  const destructiveSnapshot = destructiveButton.execute(
    createBrowserSnapshotScript("browser-request-destructive-button-snapshot"),
  );
  assert.deepEqual(
    (destructiveSnapshot.result.controls as { actions: string[] }[])[0]
      ?.actions,
    [],
  );
});

test("Agent interaction guard blocks external writes without freezing page-local state", async () => {
  const fetchCalls: string[] = [];
  const xhrCalls: string[] = [];
  const formCalls: string[] = [];
  const storageCalls: string[] = [];
  const socketCalls: string[] = [];
  const messageCalls: string[] = [];
  const popupCalls: string[] = [];
  const releaseCallbacks: (() => void)[] = [];
  let cookieValue = "";
  class FakeXhr {
    open(method: string) {
      xhrCalls.push(`open:${method}`);
    }

    send() {
      xhrCalls.push("send");
    }
  }
  class FakeForm {
    method = "POST";

    getAttribute(name: string) {
      return name === "method" ? this.method : null;
    }

    submit() {
      formCalls.push("submit");
    }
  }
  class FakeStorage {
    setItem() {
      storageCalls.push("setItem");
    }

    removeItem() {
      storageCalls.push("removeItem");
    }

    clear() {
      storageCalls.push("clear");
    }
  }
  class FakeSocket {
    send() {
      socketCalls.push("send");
    }
  }
  class FakeMessagePort {
    postMessage() {
      messageCalls.push("message-port");
    }
  }
  class FakeBroadcastChannel {
    postMessage() {
      messageCalls.push("broadcast-channel");
    }
  }
  class FakeWorker {
    postMessage() {
      messageCalls.push("worker");
    }
  }
  class FakeDocument {
    get cookie() {
      return cookieValue;
    }

    set cookie(value: string) {
      cookieValue = value;
    }

    addEventListener() {}
  }
  const window = {
    fetch: async (_input: unknown, init?: { method?: string }) => {
      fetchCalls.push(init?.method ?? "GET");
      return { ok: true };
    },
    BroadcastChannel: FakeBroadcastChannel,
    HTMLFormElement: FakeForm,
    MessagePort: FakeMessagePort,
    WebSocket: FakeSocket,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      releaseCallbacks.push(callback);
      return releaseCallbacks.length;
    },
    open: () => {
      popupCalls.push("open");
      return null;
    },
  } as Record<string, unknown>;
  const navigator = { sendBeacon: (_url: string) => true };
  const document = new FakeDocument();
  runInNewContext(AGENT_READ_ONLY_INTERACTION_GUARD_SCRIPT, {
    Document: FakeDocument,
    BroadcastChannel: FakeBroadcastChannel,
    HTMLFormElement: FakeForm,
    MessagePort: FakeMessagePort,
    Storage: FakeStorage,
    WebSocket: FakeSocket,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    document,
    navigator,
    window,
  });
  const initialXhr = new FakeXhr();
  initialXhr.open("POST");
  initialXhr.send();
  new FakeForm().submit();
  new FakeStorage().setItem();
  new FakeSocket().send();
  document.cookie = "before=allowed";
  const activate = window.__boltpocketActivateAgentReadOnlyInteraction as () =>
    true | undefined;
  assert.equal(activate(), true);
  await assert.doesNotReject(
    (window.fetch as typeof globalThis.fetch)("https://example.com/data", {
      method: "GET",
    }),
  );
  assert.throws(() =>
    (window.fetch as typeof globalThis.fetch)("https://example.com/data", {
      method: "POST",
    }),
  );
  assert.throws(() => navigator.sendBeacon("https://example.com/write"));
  const blockedXhr = new FakeXhr();
  blockedXhr.open("POST");
  assert.throws(() => blockedXhr.send());
  const safeXhr = new FakeXhr();
  safeXhr.open("GET");
  assert.doesNotThrow(() => safeXhr.send());
  assert.throws(() => new FakeForm().submit());
  const getForm = new FakeForm();
  getForm.method = "GET";
  assert.doesNotThrow(() => getForm.submit());
  assert.doesNotThrow(() => new FakeStorage().setItem());
  assert.doesNotThrow(() => new FakeMessagePort().postMessage());
  assert.doesNotThrow(() => new FakeBroadcastChannel().postMessage());
  assert.doesNotThrow(() => new FakeWorker().postMessage());
  assert.doesNotThrow(() => (window.open as () => void)());
  assert.throws(() => new (window.WebSocket as typeof FakeSocket)());
  assert.throws(() => new FakeSocket().send());
  assert.doesNotThrow(() => {
    document.cookie = "after=allowed";
  });
  assert.deepEqual(fetchCalls, ["GET"]);
  assert.deepEqual(xhrCalls, [
    "open:POST",
    "send",
    "open:POST",
    "open:GET",
    "send",
  ]);
  assert.deepEqual(formCalls, ["submit", "submit"]);
  assert.deepEqual(storageCalls, ["setItem", "setItem"]);
  assert.deepEqual(socketCalls, ["send"]);
  assert.deepEqual(messageCalls, [
    "message-port",
    "broadcast-channel",
    "worker",
  ]);
  assert.deepEqual(popupCalls, ["open"]);
  assert.equal(cookieValue, "after=allowed");

  assert.equal(releaseCallbacks.length, 1);
  releaseCallbacks[0]!();
  assert.doesNotThrow(() =>
    (window.fetch as typeof globalThis.fetch)("https://example.com/write", {
      method: "POST",
    }),
  );
  assert.doesNotThrow(() => navigator.sendBeacon("https://example.com/write"));
  assert.doesNotThrow(() => new FakeForm().submit());
  assert.doesNotThrow(() => new FakeSocket().send());
  assert.deepEqual(fetchCalls, ["GET", "POST"]);
  assert.deepEqual(formCalls, ["submit", "submit", "submit"]);
  assert.deepEqual(socketCalls, ["send", "send"]);
});

test("browser message protocol accepts only its bounded channel", () => {
  assert.deepEqual(
    parseBrowserWebViewMessage(
      JSON.stringify({
        channel: "boltpocket-browser-v1",
        type: "response",
        requestId: "browser-request-one",
        ok: true,
        result: { ready: true },
      }),
    ),
    {
      type: "response",
      requestId: "browser-request-one",
      ok: true,
      result: { ready: true },
    },
  );
  assert.throws(() =>
    parseBrowserWebViewMessage(
      JSON.stringify({
        channel: "untrusted-page",
        type: "download-request",
        url: "https://example.com/file",
      }),
    ),
  );
});

test("native browser requests require the task-scoped bridge token and bounds", () => {
  const request = JSON.stringify({
    channel: "boltpocket-browser-v1",
    type: "native-api-request",
    bridgeToken: nativeBridgeToken,
    requestId: "native-request-one",
    operation: "location-current",
    options: {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: -1,
    },
  });

  assert.deepEqual(parseBrowserWebViewMessage(request, nativeBridgeToken), {
    type: "native-api-request",
    requestId: "native-request-one",
    operation: "location-current",
    options: {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: -1,
    },
  });
  assert.throws(() => parseBrowserWebViewMessage(request));
  assert.throws(() =>
    parseBrowserWebViewMessage(request, "abcdefabcdefabcdefabcdefabcdefab"),
  );
  assert.throws(() =>
    parseBrowserWebViewMessage(
      request.replace('"timeout":15000', '"timeout":60001'),
      nativeBridgeToken,
    ),
  );
});

test("native browser response scripts cannot break out of their payload", () => {
  const response = createBrowserNativeResponseScript("native-request-one", {
    ok: false,
    error: { name: "UnknownError", message: "</script><script>bad()</script>" },
  });
  const event = createBrowserLocationWatchEventScript(1, {
    ok: true,
    position: { label: "<unsafe>" },
  });

  assert.doesNotMatch(response, /<script>bad/u);
  assert.match(response, /\\u003c\/script>/u);
  assert.doesNotMatch(event, /<unsafe>/u);
});

test("standard native Web API requests are parsed with strict payload bounds", () => {
  const request = (body: Record<string, unknown>) =>
    parseBrowserWebViewMessage(
      JSON.stringify({
        channel: "boltpocket-browser-v1",
        type: "native-api-request",
        bridgeToken: nativeBridgeToken,
        requestId: "native-request-standard",
        ...body,
      }),
      nativeBridgeToken,
    );

  assert.deepEqual(
    request({ operation: "capability-authorize", capability: "camera" }),
    {
      type: "native-api-request",
      requestId: "native-request-standard",
      operation: "capability-authorize",
      capability: "camera",
    },
  );
  assert.deepEqual(
    request({ operation: "permission-query", permission: "camera" }),
    {
      type: "native-api-request",
      requestId: "native-request-standard",
      operation: "permission-query",
      permission: "camera",
    },
  );
  assert.deepEqual(request({ operation: "share", data: { text: "hello" } }), {
    type: "native-api-request",
    requestId: "native-request-standard",
    operation: "share",
    data: { text: "hello" },
  });
  assert.deepEqual(
    request({ operation: "orientation-lock", lock: "landscape" }),
    {
      type: "native-api-request",
      requestId: "native-request-standard",
      operation: "orientation-lock",
      lock: "landscape",
    },
  );
  assert.deepEqual(
    request({ operation: "print-html", html: "<!doctype html><p>ok</p>" }),
    {
      type: "native-api-request",
      requestId: "native-request-standard",
      operation: "print-html",
      html: "<!doctype html><p>ok</p>",
    },
  );
  assert.deepEqual(
    request({
      operation: "barcode-detect",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      formats: ["qr_code"],
    }),
    {
      type: "native-api-request",
      requestId: "native-request-standard",
      operation: "barcode-detect",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      formats: ["qr_code"],
    },
  );

  assert.throws(() =>
    request({ operation: "capability-authorize", capability: "contacts" }),
  );
  assert.throws(() =>
    request({ operation: "permission-query", permission: "notifications" }),
  );
  assert.throws(() =>
    request({ operation: "orientation-lock", lock: "upside-down" }),
  );
  assert.throws(() =>
    request({
      operation: "barcode-detect",
      dataUrl: "data:text/plain;base64,aGVsbG8=",
      formats: ["qr_code"],
    }),
  );
});
