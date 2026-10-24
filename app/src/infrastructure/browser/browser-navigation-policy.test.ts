import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_WEBVIEW_ORIGIN_WHITELIST,
  browserExternalDestination,
  browserNavigationDecision,
  isExternalAppUrl,
  shouldPromptForExternalApp,
} from "./browser-navigation-policy.ts";

test("all WebView schemes reach the app-owned navigation policy", () => {
  assert.deepEqual(BROWSER_WEBVIEW_ORIGIN_WHITELIST, ["*"]);
});

test("web pages stay in WebView while app schemes require confirmation", () => {
  for (const url of [
    "https://x.com/boltpocket",
    "http://example.com/",
    "about:blank",
    "blob:https://example.com/id",
  ]) {
    assert.equal(browserNavigationDecision(url), "allow-web", url);
  }
  for (const url of [
    "x://post/123",
    "twitter://status?id=123",
    "mailto:hello@example.com",
    "tel:+10000000000",
  ]) {
    assert.equal(isExternalAppUrl(url), true, url);
    assert.equal(browserNavigationDecision(url), "prompt-external-app", url);
  }
});

test("executable and local schemes are blocked without an app prompt", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///private/file",
    "content://private/file",
    "blob:file:///private/id",
  ]) {
    assert.equal(browserNavigationDecision(url), "block", url);
  }
});

test("external destination labels omit paths, queries and recipients", () => {
  assert.equal(
    browserExternalDestination("https://example.com/private?token=SECRET"),
    "example.com",
  );
  assert.equal(browserExternalDestination("x://post/123?token=SECRET"), "x:");
  assert.equal(
    browserExternalDestination("mailto:private@example.com"),
    "mailto:",
  );
});

test("automatic app escapes stay silent while explicit clicks still prompt", () => {
  for (const platform of ["ios", "android", "other"] as const) {
    assert.equal(
      shouldPromptForExternalApp({
        platform,
        agentManaged: true,
        navigationType: "other",
      }),
      false,
    );
  }
  assert.equal(
    shouldPromptForExternalApp({
      platform: "ios",
      agentManaged: true,
      navigationType: "click",
    }),
    true,
  );
  assert.equal(
    shouldPromptForExternalApp({
      platform: "ios",
      agentManaged: false,
      navigationType: "other",
    }),
    true,
  );
  assert.equal(
    shouldPromptForExternalApp({
      platform: "android",
      agentManaged: true,
      navigationType: "click",
    }),
    true,
  );
});
