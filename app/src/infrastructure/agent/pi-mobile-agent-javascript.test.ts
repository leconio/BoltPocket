import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentJavaScriptTool,
  type AgentJavaScriptToolInput,
} from "./pi-mobile-agent-javascript.ts";

const context = {
  sessionId: "conversation:test",
  toolCallId: "tool-js",
  update: () => undefined,
};

test("first-class JavaScript tool advertises deterministic calculation and preserves results", async () => {
  let received: AgentJavaScriptToolInput | undefined;
  const tool = createAgentJavaScriptTool(async (input) => {
    received = input;
    return {
      stdout: "trace\n",
      stderr: "",
      result: '{"answer":65}',
      exitCode: 0,
    };
  });

  assert.equal(tool.name, "js_exec");
  assert.equal(tool.label, "运行计算");
  assert.equal(tool.risk, "read");
  assert.match(tool.description, /Prefer this over mental arithmetic/u);
  assert.match(tool.description, /exceed Number\.MAX_SAFE_INTEGER/u);
  assert.match(tool.description, /BigInt literals/u);
  assert.match(tool.description, /\.toString\(\)/u);
  assert.match(tool.description, /final expression is returned automatically/u);

  const result = await tool.execute(
    {
      code: "(2n ** 127n - 1n) % 97n",
      stdin: "input",
      files: ["/project/data.json"],
      args: ["one"],
    },
    context,
  );

  assert.deepEqual(received, {
    code: "(2n ** 127n - 1n) % 97n",
    stdin: "input",
    files: ["/project/data.json"],
    args: ["one"],
  });
  assert.deepEqual(JSON.parse(result.content), {
    exitCode: 0,
    result: '{"answer":65}',
    stdout: "trace\n",
    stderr: "",
  });
  assert.deepEqual(result.details, {
    exitCode: 0,
    fileCount: 1,
    hasResult: true,
  });
});

test("first-class JavaScript tool rejects runtime mutations and malformed results", async () => {
  const mutating = createAgentJavaScriptTool(async () => ({
    stdout: "",
    stderr: "",
    result: null,
    exitCode: 0,
    changes: [
      {
        path: "/project/NOTES.md",
        kind: "modified",
        before: "before",
        after: "after",
      },
    ],
  }));
  await assert.rejects(mutating.execute({ code: "1" }, context), /read-only/u);

  const malformed = createAgentJavaScriptTool(
    async () =>
      ({
        stdout: "",
        stderr: "",
        result: 42,
        exitCode: 0,
      }) as never,
  );
  await assert.rejects(
    malformed.execute({ code: "1" }, context),
    /invalid isolated-runtime result/u,
  );
});
