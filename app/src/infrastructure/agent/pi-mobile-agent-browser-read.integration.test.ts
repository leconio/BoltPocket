import assert from "node:assert/strict";
import test from "node:test";

import { PiAgentRuntime } from "@boltpocket/agent-runtime";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import type { AgentRunInput } from "../../application/ports/agent-runtime.ts";
import type { AgentBrowserControlPort } from "../../application/ports/browser-control.ts";
import type { Project } from "../../domain/models.ts";
import { builtInSkills } from "../../domain/library-catalog.ts";
import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

const operateBrowserSkill = (() => {
  const skill = builtInSkills.find(
    (candidate) => candidate.id === "operate-browser",
  );
  if (!skill) throw new Error("operate-browser fixture missing");
  return skill;
})();

const project: Project = {
  id: "browser-read-project",
  name: "Browser read",
  symbol: "B",
  description: "Read current web information.",
  instructions: "浏览器只允许读取，不执行外部修改。",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 0,
  resourceCount: 0,
};

function runInput(): AgentRunInput {
  return {
    runId: "run-browser-read",
    conversationId: "conversation-browser-read",
    prompt: "输入搜索词、打开筛选项，读取长网页并等待报告完成。",
    project,
    memories: [],
    skills: [operateBrowserSkill],
    resources: [],
    attachments: [],
  };
}

test("the Agent can continue, search, and wait for bounded rendered page text", async () => {
  const taskId = "browser-agent-read";
  const calls: Parameters<AgentBrowserControlPort["execute"]>[0][] = [];
  const cleanupCalls: string[] = [];
  const browserControl: AgentBrowserControlPort = {
    execute: async (input) => {
      calls.push(input);
      if (input.action === "open") {
        return {
          action: "open",
          completed: true,
          managed: true,
          taskId,
          mode: "minimized",
          url: "https://example.com/report",
          title: "",
          canGoBack: false,
          canGoForward: false,
          loading: true,
        };
      }
      if (input.action === "snapshot") {
        return {
          action: "snapshot",
          taskId,
          snapshot: {
            revision: "report-one",
            url: "https://example.com/report",
            title: "Long report",
            text: "First report section",
            controls: [
              {
                id: "control-1",
                kind: "input",
                label: "Search",
                actions: ["type"],
              },
              {
                id: "control-2",
                kind: "button",
                label: "Open filters",
                actions: ["click"],
              },
            ],
          },
          untrusted: true,
        };
      }
      if (input.action === "read_text") {
        return {
          action: "read_text",
          taskId,
          chunk: {
            revision: "report-one",
            url: "https://example.com/report",
            title: "Long report",
            offset: input.offset,
            text: "First report section",
            totalLength: 20,
            nextOffset: null,
            truncated: false,
          },
          untrusted: true,
        };
      }
      if (input.action === "find_text") {
        return {
          action: "find_text",
          taskId,
          result: {
            revision: "report-one",
            url: "https://example.com/report",
            title: "Long report",
            matches: [{ offset: 6, snippet: "report section" }],
            totalMatches: 1,
            searchedLength: 20,
            truncated: false,
          },
          untrusted: true,
        };
      }
      if (input.action === "wait_for_text") {
        return {
          action: "wait_for_text",
          taskId,
          condition: input.condition,
          matched: true,
          timedOut: false,
          waitedMs: 200,
          result: {
            revision: "report-two",
            url: "https://example.com/report",
            title: "Long report",
            matches: [{ offset: 0, snippet: "Ready" }],
            totalMatches: 1,
            searchedLength: 20,
            truncated: false,
          },
          untrusted: true,
        };
      }
      if (input.action === "type") {
        return {
          action: "type",
          completed: true,
          taskId,
          url: "https://example.com/report",
          targetId: input.targetId,
          inputLength: input.text.length,
        };
      }
      if (input.action === "click") {
        return {
          action: "click",
          completed: true,
          taskId,
          url: "https://example.com/report",
          targetId: input.targetId,
        };
      }
      if (input.action === "close") {
        return { action: "close", completed: true, taskId, url: null };
      }
      throw new Error(`unexpected browser action: ${input.action}`);
    },
    closeRun: (projectId, runId) => {
      cleanupCalls.push(`${projectId}:${runId}`);
    },
  };

  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        false,
      );
      assert.match(context.systemPrompt ?? "", /load operate-browser/u);
      assert.doesNotMatch(context.systemPrompt ?? "", /read_text\(offset=0\)/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "operate-browser" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "browser"),
        true,
      );
      const transcript = JSON.stringify(context.messages);
      assert.match(transcript, /read_text\(offset=0\)/u);
      assert.match(transcript, /find_text/u);
      assert.match(transcript, /wait_for_text/u);
      return fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "open",
          url: "https://example.com/report",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      fauxToolCall("browser", { action: "snapshot", taskId }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "type",
        taskId,
        revision: "report-one",
        targetId: "control-1",
        text: "quarterly report",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "click",
        taskId,
        revision: "report-one",
        targetId: "control-2",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "read_text",
        taskId,
        revision: "report-one",
        offset: 0,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "find_text",
        taskId,
        revision: "report-one",
        query: "report",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "wait_for_text",
        taskId,
        query: "Ready",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("browser", { action: "close", taskId }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("长网页已读取，报告状态已经就绪。"),
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    browserControl,
    registryFactory: () =>
      ({
        descriptors: () => [],
        listResources: async () => [],
      }) as never,
  });

  try {
    const output = await runtime.run(runInput(), new AbortController().signal);
    assert.equal(output.content, "长网页已读取，报告状态已经就绪。");
    assert.deepEqual(
      calls.map((call) => call.action),
      [
        "open",
        "snapshot",
        "type",
        "click",
        "read_text",
        "find_text",
        "wait_for_text",
        "close",
      ],
    );
    assert.deepEqual(calls[2], {
      action: "type",
      projectId: project.id,
      runId: "run-browser-read",
      taskId,
      revision: "report-one",
      targetId: "control-1",
      text: "quarterly report",
    });
    assert.deepEqual(calls[4], {
      action: "read_text",
      projectId: project.id,
      runId: "run-browser-read",
      taskId,
      revision: "report-one",
      offset: 0,
    });
    assert.deepEqual(calls[6], {
      action: "wait_for_text",
      projectId: project.id,
      runId: "run-browser-read",
      taskId,
      query: "Ready",
      condition: "present",
      timeoutMs: 5_000,
    });
    assert.deepEqual(cleanupCalls, [`${project.id}:run-browser-read`]);
  } finally {
    await runtime.dispose();
  }
});
