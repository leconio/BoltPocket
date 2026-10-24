import assert from "node:assert/strict";
import test from "node:test";

import { testModelConnection } from "./model-connection.ts";

test("connection test sends the selected Pi reasoning effort", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const result = await testModelConnection(
    {
      baseUrl: "https://fixture.invalid/v1",
      model: "reasoning-model",
      apiKey: "fixture-key",
      thinkingLevel: "high",
    },
    {
      fetch: async (_input, init) => {
        assert.equal(typeof init?.body, "string");
        requestBodies.push(
          JSON.parse(init!.body as string) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "OK" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.equal(result.model, "reasoning-model");
  const requestBody = requestBodies[0];
  assert.ok(requestBody);
  assert.equal(requestBody?.reasoning_effort, "high");
  assert.equal(requestBody?.max_tokens, 32);
});

test("connection test omits reasoning effort when thinking is off", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  await testModelConnection(
    {
      baseUrl: "https://fixture.invalid/v1",
      model: "plain-model",
      apiKey: "fixture-key",
      thinkingLevel: "off",
    },
    {
      fetch: async (_input, init) => {
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return new Response("{}", { status: 200 });
      },
    },
  );

  const requestBody = requestBodies[0];
  assert.ok(requestBody);
  assert.equal(Object.hasOwn(requestBody, "reasoning_effort"), false);
  assert.equal(requestBody?.max_tokens, 1);
});
