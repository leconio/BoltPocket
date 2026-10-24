import assert from "node:assert/strict";
import test from "node:test";

import { probeModelCapabilities } from "./model-capability-probe.ts";

const config = {
  baseUrl: "https://models.example.test/v1",
  apiKey: "secret",
  model: "agent-model",
  thinkingLevel: "medium" as const,
};

test("capability probe verifies chat, exact tool calls and image input", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.tools) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "capability_probe", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ choices: [{ message: {} }] }), {
      status: 200,
    });
  };

  const result = await probeModelCapabilities(config, { fetch: fetchMock });

  assert.equal(requests.length, 3);
  assert.equal(result.capabilities.chat, true);
  assert.equal(result.capabilities.tools, true);
  assert.equal(result.capabilities.vision, true);
  assert.equal(result.capabilities.reasoning, true);
  assert.equal(result.capabilities.imageGeneration, false);
  assert.equal(result.outcomes.vision, "supported");
  assert.equal(requests[1]?.tool_choice, undefined);
  assert.match(JSON.stringify(requests[2]), /image_url/u);
});

test("capability probe reports optional features unsupported without hiding chat", async () => {
  let request = 0;
  const fetchMock: typeof fetch = async () => {
    request += 1;
    if (request === 1) {
      return new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ error: "unsupported" }), {
      status: 400,
    });
  };

  const result = await probeModelCapabilities(config, { fetch: fetchMock });
  assert.equal(result.capabilities.chat, true);
  assert.equal(result.capabilities.tools, false);
  assert.equal(result.capabilities.vision, false);
  assert.equal(result.outcomes.tools, "unsupported");
  assert.equal(result.outcomes.vision, "unsupported");
});
