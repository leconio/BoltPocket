import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";
import {
  googleSpreadsheetResourceKey,
  googleSpreadsheetResourceUrl,
} from "@boltpocket/connector-google-sheets";
import type { GoogleWorkspaceTextSnapshot } from "@boltpocket/connector-google-workspace";

import type {
  GoogleDocsAccessSession,
  GoogleDocsAuthorizationPort,
} from "@/application/ports/google-docs-connections";
import type { GoogleWorkspaceConnectionApi } from "@/application/ports/google-workspace-connections";
import type { Project } from "@/domain/models";
import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { ExpoGoogleWorkspaceResourceConnectionService } from "./google-workspace-resource-connection-service.ts";

const SPREADSHEET_ID = "spreadsheet_12345678901234567890";
const PROVIDER_RESOURCE_ID = googleSpreadsheetResourceKey(SPREADSHEET_ID, 42);
const project: Project = {
  id: "project-1",
  name: "研究",
  symbol: "研",
  description: "",
  instructions: "",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 0,
  resourceCount: 0,
};

function session(): GoogleDocsAccessSession {
  return {
    account: { id: "account-1", label: "reader@example.com" },
    accessToken: "never-persist-this-token",
  };
}

class FakeAuthorization implements GoogleDocsAuthorizationPort {
  connectSession: GoogleDocsAccessSession | null = session();
  forcedConnectSession: GoogleDocsAccessSession | null = session();
  restoreSession: GoogleDocsAccessSession | null = session();
  readonly forceValues: boolean[] = [];

  async connect(force = false) {
    this.forceValues.push(force);
    return force ? this.forcedConnectSession : this.connectSession;
  }

  async restore() {
    return this.restoreSession;
  }

  async accessTokenFor() {
    return "never-persist-this-token";
  }

  async clearAccessToken() {}
}

function snapshot(
  resourceId = PROVIDER_RESOURCE_ID,
  text = "Name,Value\nalpha,1",
): GoogleWorkspaceTextSnapshot {
  return {
    resourceId,
    title: "验收表格 · 数据",
    text,
    version: "7:2026-08-07T00:00:00.000Z:hash",
    writable: true,
    trashable: true,
    restorable: false,
    trashed: false,
    metadata: {
      spreadsheetId: resourceId.split(":")[0]!,
      sheetId: Number(resourceId.split(":")[1]),
      sheetTitle: "数据",
    },
  };
}

class FakeApi implements GoogleWorkspaceConnectionApi {
  createCalls = 0;
  resolveCalls = 0;
  rejectFirstResolveAsPermissionDenied = false;
  throwCreate = false;
  readonly snapshots = new Map([[PROVIDER_RESOURCE_ID, snapshot()]]);

  async resolveResource() {
    this.resolveCalls += 1;
    if (this.rejectFirstResolveAsPermissionDenied && this.resolveCalls === 1) {
      throw new ConnectorError(
        "permission_denied",
        "Google Workspace scope upgrade required.",
      );
    }
    return snapshot();
  }

  async readResource(_accountId: string, resourceId: string) {
    const value = this.snapshots.get(resourceId);
    if (!value) throw new ConnectorError("not_found", "missing fixture");
    return value;
  }

  async replaceResource(input: { resourceId: string; text: string }) {
    const next = {
      ...snapshot(input.resourceId, input.text),
      version: "version-8",
    };
    this.snapshots.set(input.resourceId, next);
    return next;
  }

  async createResource(input: { text: string }) {
    this.createCalls += 1;
    if (this.throwCreate) throw new Error("unknown remote outcome");
    const createdId = googleSpreadsheetResourceKey(
      "created_sheet_12345678901234567890",
      0,
    );
    const created = snapshot(createdId, input.text);
    this.snapshots.set(createdId, created);
    return created;
  }
}

const testCrypto = {
  async sha256() {
    return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  },
  randomUUID() {
    return "00000000-0000-4000-8000-000000000001";
  },
};

function serviceFixture() {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  const api = new FakeApi();
  const service = new ExpoGoogleWorkspaceResourceConnectionService({
    kind: "sheets",
    store,
    authorization,
    crypto: testCrypto,
    api,
  });
  return { api, authorization, service, store };
}

test("Google Workspace resource connections persist project scope without OAuth tokens", async () => {
  const { authorization, service, store } = serviceFixture();
  const bundle = await service.connect(
    project,
    googleSpreadsheetResourceUrl(PROVIDER_RESOURCE_ID),
  );

  assert.ok(bundle);
  assert.equal(bundle.focusedResourceId, bundle.resources[0]?.id);
  assert.equal(bundle.connection.name, "Google 表格");
  assert.equal(bundle.connection.writeMode, "recoverable");
  assert.equal(bundle.resources[0]?.path, "验收表格 · 数据.csv");
  assert.deepEqual(bundle.resources[0]?.storage, {
    kind: "google-sheet",
    locator: googleSpreadsheetResourceUrl(PROVIDER_RESOURCE_ID),
    spreadsheetId: SPREADSHEET_ID,
    sheetId: 42,
    accountId: "account-1",
    accountLabel: "reader@example.com",
    writable: true,
    trashable: true,
    restorable: false,
    trashed: false,
    access: "persistent",
  });
  const serialized = (await store.list("google-sheets:"))
    .map((entry) => entry.value)
    .join("\n");
  assert.doesNotMatch(serialized, /never-persist-this-token/u);
  assert.match(serialized, new RegExp(SPREADSHEET_ID, "u"));

  authorization.restoreSession = null;
  const inactive = await service.load();
  assert.equal(inactive[0]?.connection.status, "attention");
  assert.deepEqual(inactive[0]?.resources, []);
});

test("one account authorization creates an empty Sheets connector", async () => {
  const { service, store } = serviceFixture();

  const bundle = await service.connectAccount(project, session().account);

  assert.equal(bundle.connection.status, "connected");
  assert.equal(bundle.connection.accountId, "account-1");
  assert.equal(bundle.connection.resourceCount, 0);
  assert.equal(bundle.connection.writeMode, "recoverable");
  assert.deepEqual(bundle.resources, []);
  const restored = await service.load();
  assert.equal(restored[0]?.connection.id, bundle.connection.id);
  assert.deepEqual(restored[0]?.resources, []);
  const serialized = (await store.list("google-sheets:"))
    .map((entry) => entry.value)
    .join("\n");
  assert.doesNotMatch(serialized, /never-persist-this-token/u);
});

test("an existing Google session upgrades OAuth scopes once after a permission denial", async () => {
  const { api, authorization, service } = serviceFixture();
  api.rejectFirstResolveAsPermissionDenied = true;

  const bundle = await service.connect(
    project,
    googleSpreadsheetResourceUrl(PROVIDER_RESOURCE_ID),
  );

  assert.ok(bundle);
  assert.equal(api.resolveCalls, 2);
  assert.deepEqual(authorization.forceValues, [true]);
});

test("creation intent prevents retry after an unknown Google file creation outcome", async () => {
  const { api, service, store } = serviceFixture();
  const input = {
    accountId: "account-1",
    operationId: "proposal-1:hunk-1",
    projectId: "project-1",
    connectionId: "google-sheets-connection-1",
    resourceId: "google-sheet-created-1",
    title: "模型验收表格",
    text: "Task,Done\nQA,true",
  };
  const recovery = await service.createRecoveryPoint({
    accountId: "account-1",
    ...snapshot(),
  });
  assert.match(recovery.storageRef, /^google-sheets:recovery:/u);
  assert.match((await store.read(recovery.storageRef))!, /Name,Value/u);

  await service.createCreationRecoveryPoint(input);
  api.throwCreate = true;
  await assert.rejects(
    service.createResource(input),
    /unknown remote outcome/u,
  );
  assert.equal(api.createCalls, 1);

  api.throwCreate = false;
  await assert.rejects(
    service.createResource(input),
    (error) => error instanceof ConnectorError && error.code === "io_failure",
  );
  assert.equal(api.createCalls, 1);
});
