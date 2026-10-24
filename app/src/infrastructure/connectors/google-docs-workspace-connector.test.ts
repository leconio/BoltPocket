import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import type { WorkspaceResource } from "@/domain/models";

import { createGoogleDocsWorkspaceConnector } from "./google-docs-workspace-connector.ts";

const DOCUMENT_ID = "document_12345678901234567890";
type GoogleStorage = Extract<
  WorkspaceResource["storage"],
  { kind: "google-doc" }
>;

function googleStorage(overrides?: Partial<GoogleStorage>): GoogleStorage {
  return {
    kind: "google-doc",
    locator: `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
    documentId: DOCUMENT_ID,
    accountId: "account-1",
    accountLabel: "reader@example.com",
    writable: true,
    trashable: false,
    restorable: false,
    trashed: false,
    access: "persistent",
    ...overrides,
  };
}

function resource(overrides?: Partial<WorkspaceResource>): WorkspaceResource {
  return {
    id: "resource-1",
    projectId: "project-1",
    connectionId: "connection-1",
    path: "计划.txt",
    content: "缓存",
    version: "revision-6",
    storage: googleStorage(),
    ...overrides,
  };
}

function backend() {
  const reads: string[] = [];
  return {
    reads,
    async readDocument(accountId: string, documentId: string) {
      reads.push(`${accountId}:${documentId}`);
      return {
        documentId,
        title: "计划",
        text: "实时内容",
        revisionId: "revision-7",
        writable: true,
      };
    },
    async replaceDocument() {
      throw new Error("not used");
    },
    async createRecoveryPoint() {
      throw new Error("not used");
    },
  };
}

test("workspace Google connector reads the live project-scoped document", async () => {
  const port = backend();
  const connector = createGoogleDocsWorkspaceConnector({
    connectionId: "connection-1",
    resources: [resource()],
    readOnly: true,
    backend: port,
  });

  const refs = await connector.list({ projectId: "project-1" });
  assert.equal(refs.length, 1);
  assert.equal((await connector.read(refs[0]!)).text, "实时内容");
  assert.deepEqual(port.reads, [`account-1:${DOCUMENT_ID}`]);
  assert.deepEqual(connector.descriptor().capabilities, [
    "list",
    "search",
    "read-text",
  ]);
});

test("workspace Google connector rejects tampered and mixed bindings", () => {
  const port = backend();
  assert.throws(
    () =>
      createGoogleDocsWorkspaceConnector({
        connectionId: "connection-1",
        resources: [
          resource({
            storage: googleStorage({
              locator: "https://example.com/not-the-document",
            }),
          }),
        ],
        readOnly: true,
        backend: port,
      }),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );

  const second = resource({
    id: "resource-2",
    storage: googleStorage({
      accountId: "account-2",
    }),
  });
  assert.throws(
    () =>
      createGoogleDocsWorkspaceConnector({
        connectionId: "connection-1",
        resources: [resource(), second],
        readOnly: true,
        backend: port,
      }),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );
});

test("workspace Google connector supports an account-only project scope", async () => {
  const port = {
    ...backend(),
    async createDocument() {
      throw new Error("not used");
    },
    async createCreationRecoveryPoint() {
      return { storageRef: "create-intent", version: "absent" };
    },
  };
  const connector = createGoogleDocsWorkspaceConnector({
    connectionId: "google-docs-account-1",
    projectId: "project-1",
    accountId: "account-1",
    accountLabel: "reader@example.com",
    resources: [],
    readOnly: false,
    backend: port,
  });

  assert.deepEqual(connector.descriptor().projectIds, ["project-1"]);
  assert.ok(connector.descriptor().capabilities.includes("create-text"));
  assert.deepEqual(await connector.list({ projectId: "project-1" }), []);
});
