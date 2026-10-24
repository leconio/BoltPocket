import assert from "node:assert/strict";
import test from "node:test";

import { discoverModelNames } from "./model-discovery.ts";

test("model discovery uses the OpenAI-compatible list endpoint and returns unique names", async () => {
  let requestedUrl = "";
  let authorization = "";
  const models = await discoverModelNames(
    { baseUrl: "https://fixture.invalid/v1/", apiKey: "fixture-key" },
    {
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "model-z" },
              { id: "model-a" },
              { id: "model-z" },
              { missing: true },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.equal(requestedUrl, "https://fixture.invalid/v1/models");
  assert.equal(authorization, "Bearer fixture-key");
  assert.deepEqual(models, ["model-a", "model-z"]);
});

test("model discovery reports authorization without exposing the API key", async () => {
  const apiKey = "do-not-echo-this-key";
  await assert.rejects(
    discoverModelNames(
      { baseUrl: "https://fixture.invalid/v1", apiKey },
      { fetch: async () => new Response("{}", { status: 401 }) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /API Key 无效/u);
      assert.doesNotMatch(error.message, new RegExp(apiKey, "u"));
      return true;
    },
  );
});

test("model discovery rejects malformed and oversized provider data", async () => {
  await assert.rejects(
    discoverModelNames(
      { baseUrl: "https://fixture.invalid/v1", apiKey: "fixture-key" },
      { fetch: async () => new Response('{"data":"wrong"}') },
    ),
    /格式无效/u,
  );
  await assert.rejects(
    discoverModelNames(
      { baseUrl: "https://fixture.invalid/v1", apiKey: "fixture-key" },
      {
        fetch: async () =>
          new Response("{}", {
            headers: { "Content-Length": String(1024 * 1024 + 1) },
          }),
      },
    ),
    /响应过大/u,
  );
});
