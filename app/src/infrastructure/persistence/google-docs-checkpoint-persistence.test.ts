import assert from "node:assert/strict";
import test from "node:test";

import { appReducer, initialAppState } from "@/domain/app-state";
import type { ConnectionItem, WorkspaceResource } from "@/domain/models";
import { createProjectWithWorkspace } from "@/domain/project-workspace";

import { InMemoryDurableDocumentStore } from "./document-store.ts";
import {
  PersistedAppStateRepository,
  restorePersistedAppState,
} from "./persisted-app-state.ts";

const DOCUMENT_ID = "document_12345678901234567890";
type GoogleStorage = Extract<
  WorkspaceResource["storage"],
  { kind: "google-doc" }
>;
type GoogleResource = WorkspaceResource & { storage: GoogleStorage };

function googleBundle(projectId: string) {
  const connection: ConnectionItem = {
    id: "google-docs-1",
    projectId,
    name: "Google 文档",
    account: "reader@example.com",
    scope: "发布计划",
    status: "connected",
    resourceCount: 1,
    access: "persistent",
    writeMode: "recoverable",
  };
  const resource: GoogleResource = {
    id: "google-doc-1",
    projectId,
    connectionId: connection.id,
    path: "发布计划.txt",
    content: "当前内容",
    version: "revision-7",
    storage: {
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
    },
  };
  return { connection, resource };
}

test("Google document refresh cannot change its persisted account binding", () => {
  const projectBundle = createProjectWithWorkspace({
    id: "project-1",
    name: "研究",
  });
  let state = appReducer(initialAppState, {
    type: "project/created",
    ...projectBundle,
  });
  const google = googleBundle(projectBundle.project.id);
  state = appReducer(state, {
    type: "connection/upsert",
    connection: google.connection,
    resources: [google.resource],
  });
  assert.equal(state.resources[google.resource.id]?.content, "当前内容");

  const tampered: WorkspaceResource = {
    ...google.resource,
    content: "伪造内容",
    version: "revision-8",
    storage: { ...google.resource.storage, accountId: "account-2" },
  };
  const rejected = appReducer(state, {
    type: "resources/refreshed",
    resources: [tampered],
  });
  assert.equal(rejected.resources[google.resource.id]?.content, "当前内容");

  const readOnly: WorkspaceResource = {
    ...google.resource,
    content: "实时内容",
    version: "revision-8",
    storage: { ...google.resource.storage, writable: false },
  };
  const accepted = appReducer(state, {
    type: "resources/refreshed",
    resources: [readOnly],
  });
  const acceptedResource = accepted.resources[google.resource.id];
  assert.equal(acceptedResource?.content, "实时内容");
  assert.equal(acceptedResource?.storage.kind, "google-doc");
  assert.equal(
    acceptedResource?.storage.kind === "google-doc"
      ? acceptedResource.storage.writable
      : null,
    false,
  );
});

test("Google document checkpoint snapshots survive encrypted app-state projection", async () => {
  const projectBundle = createProjectWithWorkspace({
    id: "project-1",
    name: "研究",
  });
  let state = appReducer(initialAppState, {
    type: "project/created",
    ...projectBundle,
  });
  state = appReducer(state, {
    type: "chat/open-project",
    projectId: projectBundle.project.id,
  });
  const google = googleBundle(projectBundle.project.id);
  state = appReducer(state, {
    type: "connection/upsert",
    connection: google.connection,
    resources: [google.resource],
  });
  const changed: WorkspaceResource = {
    ...google.resource,
    content: "修改后",
    version: "revision-8",
  };
  const checkpoint = {
    id: "checkpoint-1",
    conversationId: state.activeConversationId,
    projectId: projectBundle.project.id,
    createdAt: "2026-08-05T00:00:00.000Z",
    baselineResources: { [google.resource.id]: google.resource },
    latestResources: { [google.resource.id]: changed },
  };
  state = {
    ...state,
    conversationCheckpoints: { [checkpoint.conversationId]: checkpoint },
  };

  const repository = new PersistedAppStateRepository(
    new InMemoryDurableDocumentStore(),
  );
  await repository.save(state, "2026-08-05T00:01:00.000Z");
  const persisted = await repository.load();
  assert.ok(persisted);
  const restored = restorePersistedAppState(initialAppState, persisted);
  const restoredResource =
    restored.conversationCheckpoints[checkpoint.conversationId]
      ?.baselineResources[google.resource.id];

  assert.equal(restoredResource?.storage.kind, "google-doc");
  assert.equal(restoredResource?.content, "当前内容");
  assert.equal(
    restoredResource?.storage.kind === "google-doc"
      ? restoredResource.storage.documentId
      : null,
    DOCUMENT_ID,
  );
});
