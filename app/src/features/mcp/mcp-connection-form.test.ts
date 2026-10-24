import assert from "node:assert/strict";
import test from "node:test";

import type { McpConnection } from "@/application/ports/mcp-connections";

import {
  mcpAuthenticationChoice,
  mcpToolPolicyPreset,
  suggestedMcpConnectionName,
} from "./mcp-connection-form.ts";

test("new MCP connections default to browser OAuth and standard safety", () => {
  assert.equal(mcpAuthenticationChoice(null), "oauth");
  assert.equal(mcpToolPolicyPreset(null), "standard");
});

test("saved MCP policy maps to a small set of user-facing presets", () => {
  assert.equal(
    mcpToolPolicyPreset(connection({ trustToolAnnotations: true })),
    "standard",
  );
  assert.equal(
    mcpToolPolicyPreset(
      connection({ approveTools: ["*"], trustToolAnnotations: false }),
    ),
    "ask-all",
  );
  assert.equal(
    mcpToolPolicyPreset(
      connection({
        allowedToolNames: ["search"],
        trustToolAnnotations: true,
      }),
    ),
    "custom",
  );
});

test("MCP names are inferred from common service hosts", () => {
  assert.equal(
    suggestedMcpConnectionName("https://mcp.figma.com/mcp"),
    "Figma",
  );
  assert.equal(
    suggestedMcpConnectionName("https://api.github-copilot.com/mcp"),
    "Github Copilot",
  );
  assert.equal(suggestedMcpConnectionName("not a url"), "MCP");
});

function connection(overrides: Partial<McpConnection> = {}): McpConnection {
  return {
    authentication: { kind: "none" },
    createdAt: "2026-08-11T00:00:00.000Z",
    enabled: true,
    id: `mcp-${"a".repeat(16)}`,
    projectId: null,
    name: "Example",
    serverUrl: "https://mcp.example.com/mcp",
    trustToolAnnotations: false,
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}
