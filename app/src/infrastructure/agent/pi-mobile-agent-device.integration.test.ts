import assert from "node:assert/strict";
import test from "node:test";

import { PiAgentRuntime } from "@boltpocket/agent-runtime";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import type { AgentRunInput } from "../../application/ports/agent-runtime.ts";
import type { AgentDeviceCapabilityPort } from "../../application/ports/device-capabilities.ts";
import { builtInSkills } from "../../domain/library-catalog.ts";
import { PiMobileAgentRuntime } from "./pi-mobile-agent-runtime.ts";

const operateDeviceSkill = (() => {
  const skill = builtInSkills.find(
    (candidate) => candidate.id === "operate-device",
  );
  if (!skill) throw new Error("operate-device fixture missing");
  return skill;
})();

function runInput(options?: {
  runId?: string;
  prompt?: string;
}): AgentRunInput {
  return {
    runId: options?.runId ?? "run-device-status",
    conversationId: "conversation-device-status",
    prompt: options?.prompt ?? "读取这台设备的状态。",
    project: null,
    memories: [],
    skills: [operateDeviceSkill],
    resources: [],
    attachments: [],
  };
}

test("device access has no hidden tool gate and remains available across conversation turns", async () => {
  const calls: {
    input: Parameters<AgentDeviceCapabilityPort["execute"]>[0];
    context: Parameters<AgentDeviceCapabilityPort["execute"]>[1];
  }[] = [];
  const deviceCapabilities: AgentDeviceCapabilityPort = {
    execute: async (input, context) => {
      calls.push({ input, context });
      if (input.action === "bluetooth_scan") {
        return {
          devices: [
            {
              deviceId: "ble-0123456789abcdef01234567",
              name: "Fixture BLE",
            },
          ],
          capturedAt: "2026-08-16T01:02:04.000Z",
        };
      }
      if (input.action === "bluetooth_services") {
        return {
          services: [
            {
              uuid: "0000fee7-0000-1000-8000-00805f9b34fb",
              characteristics: [
                {
                  uuid: "0000fec7-0000-1000-8000-00805f9b34fb",
                  properties: ["read", "write"],
                },
              ],
            },
          ],
        };
      }
      if (input.action === "bluetooth_write") {
        return {
          patchHash: "a".repeat(64),
          recoveryId: "ble-recovery-fixture",
          verified: true,
        };
      }
      return {
        networks: [{ ssid: "Fixture Wi-Fi" }],
        capturedAt: "2026-08-16T01:02:03.000Z",
      };
    },
  };
  const faux = createFauxCore({ tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "device"),
        true,
      );
      assert.match(context.systemPrompt ?? "", /operate-device/u);
      return fauxAssistantMessage(
        fauxToolCall("skill_read", { name: "operate-device" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "device"),
        true,
      );
      return fauxAssistantMessage(
        fauxToolCall("device", {
          action: "wifi_scan",
          purpose: "回答用户关于附近 Wi-Fi 的问题",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.match(JSON.stringify(context.messages), /Fixture Wi-Fi/u);
      return fauxAssistantMessage("附近发现 Fixture Wi-Fi。");
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "device"),
        true,
      );
      return fauxAssistantMessage(
        fauxToolCall("device", {
          action: "bluetooth_scan",
          purpose: "回答用户关于附近可连接蓝牙设备的问题",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.match(JSON.stringify(context.messages), /Fixture BLE/u);
      return fauxAssistantMessage(
        "发现 Fixture BLE，临时句柄 ble-0123456789abcdef01234567。",
      );
    },
    (context) => {
      assert.equal(
        context.tools?.some((tool) => tool.name === "device"),
        true,
      );
      assert.match(
        JSON.stringify(context.messages),
        /ble-0123456789abcdef01234567/u,
      );
      return fauxAssistantMessage(
        fauxToolCall("device", {
          action: "bluetooth_services",
          deviceId: "ble-0123456789abcdef01234567",
          purpose: "检查用户选择的 BLE 设备有哪些可用服务",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.match(JSON.stringify(context.messages), /0000fec7/u);
      return fauxAssistantMessage(
        fauxToolCall("device", {
          action: "bluetooth_write",
          deviceId: "ble-0123456789abcdef01234567",
          serviceUuid: "fee7",
          characteristicUuid: "fec7",
          valueText: "PRINT\r\n",
          purpose: "按用户要求向所选 BLE 设备发送测试内容",
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      assert.match(JSON.stringify(context.messages), /ble-recovery-fixture/u);
      return fauxAssistantMessage("已动态连接 Fixture BLE 并完成可恢复写入。");
    },
  ]);
  const runtime = new PiMobileAgentRuntime({
    coreRuntime: new PiAgentRuntime({
      model: faux.getModel(),
      streamFn: faux.streamSimple,
    }),
    deviceCapabilities,
    registryFactory: () =>
      ({
        descriptors: () => [],
        listResources: async () => [],
      }) as never,
  });

  try {
    const wifiOutput = await runtime.run(
      runInput({
        runId: "run-device-wifi",
        prompt: "我附近有什么 Wi-Fi？",
      }),
      new AbortController().signal,
    );
    assert.equal(wifiOutput.content, "附近发现 Fixture Wi-Fi。");
    const bluetoothOutput = await runtime.run(
      runInput({
        runId: "run-device-bluetooth",
        prompt: "哪些蓝牙可以连接？",
      }),
      new AbortController().signal,
    );
    assert.equal(
      bluetoothOutput.content,
      "发现 Fixture BLE，临时句柄 ble-0123456789abcdef01234567。",
    );
    const communicationOutput = await runtime.run(
      runInput({
        runId: "run-device-communication",
        prompt: "连接刚才那台设备，检查服务并发送测试内容。",
      }),
      new AbortController().signal,
    );
    assert.equal(
      communicationOutput.content,
      "已动态连接 Fixture BLE 并完成可恢复写入。",
    );
    assert.deepEqual(calls, [
      {
        input: {
          action: "wifi_scan",
          purpose: "回答用户关于附近 Wi-Fi 的问题",
        },
        context: {
          conversationId: "conversation-device-status",
          projectId: "global-conversation",
          projectName: "当前对话",
          runId: "run-device-wifi",
        },
      },
      {
        input: {
          action: "bluetooth_scan",
          purpose: "回答用户关于附近可连接蓝牙设备的问题",
        },
        context: {
          conversationId: "conversation-device-status",
          projectId: "global-conversation",
          projectName: "当前对话",
          runId: "run-device-bluetooth",
        },
      },
      {
        input: {
          action: "bluetooth_services",
          deviceId: "ble-0123456789abcdef01234567",
          purpose: "检查用户选择的 BLE 设备有哪些可用服务",
        },
        context: {
          conversationId: "conversation-device-status",
          projectId: "global-conversation",
          projectName: "当前对话",
          runId: "run-device-communication",
        },
      },
      {
        input: {
          action: "bluetooth_write",
          deviceId: "ble-0123456789abcdef01234567",
          serviceUuid: "fee7",
          characteristicUuid: "fec7",
          valueText: "PRINT\r\n",
          purpose: "按用户要求向所选 BLE 设备发送测试内容",
        },
        context: {
          conversationId: "conversation-device-status",
          projectId: "global-conversation",
          projectName: "当前对话",
          runId: "run-device-communication",
        },
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});
