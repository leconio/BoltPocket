import assert from "node:assert/strict";
import test from "node:test";

import { createPublicReadFetch } from "./public-read-fetch.ts";

test("public read fetch permits credential-free HTTPS GET requests", async () => {
  let received: { init?: RequestInit; url?: string } = {};
  const read = createPublicReadFetch(async (url, init) => {
    received = { url: String(url), init };
    return new Response("ok");
  });
  const response = await read("https://api.github.com/repos/a/b", {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  assert.equal(await response.text(), "ok");
  assert.equal(received.url, "https://api.github.com/repos/a/b");
  assert.equal(received.init?.credentials, "omit");
  assert.equal(received.init?.redirect, "error");
});

test("public read fetch rejects local targets, credentials, headers, and writes", async () => {
  const read = createPublicReadFetch(async () => new Response("unexpected"));
  for (const url of [
    "http://example.com/data",
    "https://localhost/data",
    "https://127.0.0.1/data",
    "https://192.168.1.2/data",
    "https://user:secret@example.com/data",
  ]) {
    await assert.rejects(
      () => read(url, { method: "GET", headers: {} }),
      /公共 HTTPS/u,
    );
  }
  await assert.rejects(
    () =>
      read("https://example.com/data", {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      }),
    /请求头/u,
  );
  await assert.rejects(
    () =>
      read("https://example.com/data", {
        method: "POST",
        headers: {},
        body: "write",
      }),
    /GET 或 HEAD/u,
  );
});
