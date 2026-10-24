import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import type {
  GoogleDocsAccessSession,
  GoogleDocsAuthorizationPort,
} from "@/application/ports/google-docs-connections";
import type { Project } from "@/domain/models";
import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { ExpoGoogleDocsConnectionService } from "./google-docs-connection-service.ts";

const DOCUMENT_ID = "document_12345678901234567890";
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

function session(accountId = "account-1"): GoogleDocsAccessSession {
  return {
    account: { id: accountId, label: `${accountId}@example.com` },
    accessToken: "never-persist-this-token",
  };
}

class FakeAuthorization implements GoogleDocsAuthorizationPort {
  connectSession: GoogleDocsAccessSession | null = session();
  restoreSession: GoogleDocsAccessSession | null = session();

  async connect() {
    return this.connectSession;
  }

  async restore() {
    return this.restoreSession;
  }

  async accessTokenFor(accountId: string) {
    const active = this.restoreSession ?? this.connectSession;
    if (!active || active.account.id !== accountId) {
      throw new ConnectorError("not_connected", "inactive account");
    }
    return active.accessToken;
  }

  async clearAccessToken() {}
}

function docsResponse(
  text = "内容\n",
  revisionId = "revision-7",
  title = "发布计划",
) {
  return {
    documentId: DOCUMENT_ID,
    title,
    revisionId,
    tabs: [
      {
        tabProperties: { tabId: "tab-1", title: "主文档" },
        documentTab: {
          body: {
            content: [
              { startIndex: 0, endIndex: 1, sectionBreak: {} },
              {
                startIndex: 1,
                endIndex: text.length + 1,
                paragraph: {
                  paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
                  elements: [
                    {
                      startIndex: 1,
                      endIndex: text.length + 1,
                      textRun: { content: text, textStyle: {} },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    ],
  };
}

function docsFetch() {
  return (async () =>
    new Response(JSON.stringify(docsResponse()))) as typeof fetch;
}

const testCrypto = {
  async sha256() {
    return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  },
  randomUUID() {
    return "00000000-0000-4000-8000-000000000001";
  },
};

test("connecting one explicit document persists metadata but never OAuth tokens", async () => {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  const service = new ExpoGoogleDocsConnectionService(
    store,
    authorization,
    testCrypto,
    docsFetch(),
  );

  const bundle = await service.connect(
    project,
    `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
  );

  assert.ok(bundle);
  assert.equal(bundle.focusedResourceId, bundle.resources[0]?.id);
  assert.equal(bundle.connection.name, "Google 文档");
  assert.equal(bundle.connection.projectId, project.id);
  assert.equal(bundle.connection.writeMode, "recoverable");
  assert.equal(bundle.resources[0]?.path, "发布计划.txt");
  assert.equal(bundle.resources[0]?.content, "内容");
  assert.deepEqual(bundle.resources[0]?.storage, {
    kind: "google-doc",
    locator: `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
    documentId: DOCUMENT_ID,
    accountId: "account-1",
    accountLabel: "account-1@example.com",
    writable: true,
    trashable: false,
    restorable: false,
    trashed: false,
    access: "persistent",
  });

  const saved = await store.list("google-docs:");
  const serialized = saved.map((entry) => entry.value).join("\n");
  assert.doesNotMatch(serialized, /never-persist-this-token/u);
  assert.match(serialized, new RegExp(DOCUMENT_ID, "u"));
});

test("one Google authorization creates a project connector before any link", async () => {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  const service = new ExpoGoogleDocsConnectionService(
    store,
    authorization,
    testCrypto,
    docsFetch(),
  );

  const bundle = await service.connectAccount(project, session().account);

  assert.equal(bundle.connection.status, "connected");
  assert.equal(bundle.connection.accountId, "account-1");
  assert.equal(bundle.connection.resourceCount, 0);
  assert.equal(bundle.connection.writeMode, "recoverable");
  assert.deepEqual(bundle.resources, []);
  const restored = await service.load();
  assert.equal(restored[0]?.connection.id, bundle.connection.id);
  assert.deepEqual(restored[0]?.resources, []);
  const serialized = (await store.list("google-docs:"))
    .map((entry) => entry.value)
    .join("\n");
  assert.doesNotMatch(serialized, /never-persist-this-token/u);
});

test("reconnecting the same project document replaces its account binding", async () => {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  const service = new ExpoGoogleDocsConnectionService(
    store,
    authorization,
    testCrypto,
    docsFetch(),
  );
  const first = await service.connect(project, DOCUMENT_ID);
  authorization.connectSession = session("account-2");
  authorization.restoreSession = session("account-2");
  const second = await service.connect(project, DOCUMENT_ID);

  assert.ok(first && second);
  assert.equal(second.connection.id, first.connection.id);
  assert.equal(second.resources[0]?.id, first.resources[0]?.id);
  assert.equal(second.connection.account, "account-2@example.com");
  const manifest = await store.list("google-docs:manifest:");
  assert.equal(JSON.parse(manifest[0]!.value).documents.length, 1);
});

test("load exposes saved documents only when their account is active", async () => {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  let currentTitle = "发布计划";
  const service = new ExpoGoogleDocsConnectionService(
    store,
    authorization,
    testCrypto,
    (async () =>
      new Response(
        JSON.stringify(docsResponse("内容\n", "revision-7", currentTitle)),
      )) as typeof fetch,
  );
  await service.connect(project, DOCUMENT_ID);

  authorization.restoreSession = null;
  const inactive = await service.load();
  assert.equal(inactive[0]?.connection.status, "attention");
  assert.deepEqual(inactive[0]?.resources, []);

  authorization.restoreSession = session();
  currentTitle = "新版发布计划";
  const active = await service.load();
  assert.equal(active[0]?.connection.status, "connected");
  assert.equal(active[0]?.connection.scope, "新版发布计划");
  assert.equal(active[0]?.resources[0]?.path, "新版发布计划.txt");
  assert.equal(active[0]?.resources[0]?.content, "内容");
});

test("Google Docs recovery snapshots are durable and invalid manifests fail closed", async () => {
  const store = new InMemoryDurableDocumentStore();
  const authorization = new FakeAuthorization();
  const service = new ExpoGoogleDocsConnectionService(
    store,
    authorization,
    testCrypto,
    docsFetch(),
  );

  const recovery = await service.createRecoveryPoint({
    accountId: "account-1",
    documentId: DOCUMENT_ID,
    title: "发布计划",
    text: "旧内容",
    revisionId: "revision-6",
    writable: true,
  });
  assert.match(recovery.storageRef, /^google-docs:recovery:/u);
  assert.match((await store.read(recovery.storageRef))!, /旧内容/u);

  await store.write(
    "google-docs:manifest:v1",
    JSON.stringify({ version: 1, documents: [{ connectionId: "bad" }] }),
  );
  await assert.rejects(
    service.load(),
    (error) => error instanceof ConnectorError && error.code === "io_failure",
  );
});
