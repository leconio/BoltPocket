import assert from "node:assert/strict";
import test from "node:test";

import type { ConnectorResourceRef, ProjectConnector } from "./contracts.ts";
import { ConnectorError } from "./errors.ts";
import { ConnectorRegistry } from "./registry.ts";

const requestedRef: ConnectorResourceRef = {
  connectorId: "workspace",
  accountId: "account",
  resourceId: "notes",
  projectId: "project-a",
  kind: "text",
  displayName: "Notes",
  locator: "notes.md",
};

function connectorReturning(
  listRef: ConnectorResourceRef,
  searchRef: ConnectorResourceRef = listRef,
): ProjectConnector {
  return {
    descriptor: () => ({
      id: "workspace",
      label: "Workspace",
      kind: "fixture",
      accountId: "account",
      accountLabel: "Fixture",
      status: "connected",
      projectIds: ["project-a"],
      capabilities: ["list", "search", "read-text"],
    }),
    list: async () => [listRef],
    search: async () => [searchRef],
    read: async () => {
      throw new Error("not used");
    },
    validateTextChange: async () => {
      throw new Error("not used");
    },
    applyTextChange: async () => {
      throw new Error("not used");
    },
  };
}

function isScopeError(error: unknown) {
  return error instanceof ConnectorError && error.code === "permission_denied";
}

test("registry rejects list results attributed to another connector", async () => {
  const registry = new ConnectorRegistry([
    connectorReturning({ ...requestedRef, connectorId: "foreign" }),
  ]);

  await assert.rejects(registry.listResources("project-a"), isScopeError);
});

test("registry rejects search results owned by another project", async () => {
  const registry = new ConnectorRegistry([
    connectorReturning(requestedRef, {
      ...requestedRef,
      projectId: "project-b",
    }),
  ]);

  await assert.rejects(
    registry.searchResources({ projectId: "project-a", query: "notes" }),
    isScopeError,
  );
});
