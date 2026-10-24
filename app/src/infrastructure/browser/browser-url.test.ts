import assert from "node:assert/strict";
import test from "node:test";

import {
  browserUrlForModel,
  isAgentSafeBrowserUrl,
  normalizeBrowserInput,
  normalizeBrowserUrl,
  sameBrowserOrigin,
} from "./browser-url.ts";

test("browser input accepts web URLs and turns ordinary text into a search", () => {
  assert.equal(
    normalizeBrowserInput("example.com/docs"),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeBrowserInput("BoltPocket mobile agent"),
    "https://www.bing.com/search?q=BoltPocket%20mobile%20agent",
  );
  assert.equal(
    normalizeBrowserInput("localhost:3000/dashboard"),
    "https://localhost:3000/dashboard",
  );
  assert.equal(
    normalizeBrowserInput("devbox:8080/dashboard"),
    "https://devbox:8080/dashboard",
  );
  assert.equal(
    normalizeBrowserInput("example.com:8080/docs"),
    "https://example.com:8080/docs",
  );
  assert.equal(
    normalizeBrowserUrl("http://example.com/path"),
    "http://example.com/path",
  );
});

test("browser URLs reject executable schemes, embedded credentials and controls", () => {
  for (const input of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "https://example.com/\0secret",
  ]) {
    assert.throws(() => normalizeBrowserUrl(input));
  }
});

test("Agent browsing accepts ordinary HTTP(S) destinations", () => {
  for (const input of [
    "https://example.com/account",
    "http://example.com/",
    "http://localhost:3000/",
    "https://192.168.1.1/",
    "https://[::1]/",
  ]) {
    assert.equal(isAgentSafeBrowserUrl(input), true, input);
  }
  assert.equal(isAgentSafeBrowserUrl("javascript:alert(1)"), false);
  assert.equal(
    isAgentSafeBrowserUrl("https://user:password@example.com/"),
    false,
  );
});

test("model-visible URLs drop query values and fragments", () => {
  assert.equal(
    browserUrlForModel("https://example.com/callback?code=SECRET#token"),
    "https://example.com/callback",
  );
  assert.equal(
    sameBrowserOrigin("https://example.com/a", "https://example.com/b?q=1"),
    true,
  );
  assert.equal(
    sameBrowserOrigin("https://example.com", "https://accounts.example.com"),
    false,
  );
});
