import assert from "node:assert/strict";
import test from "node:test";

import { ResourceReadBudget } from "@/application/resource-read-budget";
import type { WorkspaceResource } from "@/domain/models";
import { createGoogleDocsWorkspaceConnector } from "@/infrastructure/connectors/google-docs-workspace-connector";

import { WorkspacePiCodingTools } from "./workspace-pi-coding-tools.ts";
import { projectShellPathForResource } from "./workspace-project-shell.ts";

const DOCUMENT_ID = "document_12345678901234567890";

function googleResource(): WorkspaceResource {
  return {
    id: "google-doc-1",
    projectId: "project-1",
    connectionId: "google-docs-1",
    path: "计划.txt",
    content: "缓存内容",
    version: "revision-6",
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
}

function environment(writable: boolean) {
  const resource = googleResource();
  let replaceCalls = 0;
  const connector = createGoogleDocsWorkspaceConnector({
    connectionId: resource.connectionId,
    resources: [resource],
    readOnly: true,
    backend: {
      async readDocument() {
        return {
          documentId: DOCUMENT_ID,
          title: "计划",
          text: "实时内容",
          revisionId: "revision-7",
          writable,
        };
      },
      async replaceDocument() {
        replaceCalls += 1;
        throw new Error("Agent tool loop must not write the provider directly");
      },
      async createRecoveryPoint() {
        throw new Error("Agent tool loop must not create provider recovery");
      },
    },
  });
  const tools = new WorkspacePiCodingTools({
    projectId: resource.projectId,
    resources: [resource],
    readBudget: new ResourceReadBudget(),
    refreshResource: async (candidate) => {
      const refs = await connector.list({ projectId: candidate.projectId });
      const snapshot = await connector.read(refs[0]!);
      return {
        ...candidate,
        content: snapshot.text,
        version: snapshot.version,
        storage:
          candidate.storage.kind === "google-doc" &&
          typeof snapshot.metadata.writable === "boolean"
            ? {
                ...candidate.storage,
                writable: snapshot.metadata.writable,
              }
            : candidate.storage,
      };
    },
  });
  return {
    path: projectShellPathForResource(resource),
    replaceCallCount: () => replaceCalls,
    tools,
  };
}

test("Agent file tools refresh Google Docs and stage a Diff without provider writes", async () => {
  const { path, replaceCallCount, tools } = environment(true);

  assert.equal(await tools.readFile(path), "实时内容");
  await tools.writeFile(path, "Agent 修改");

  assert.equal(replaceCallCount(), 0);
  assert.deepEqual(tools.stagedChanges(), [
    {
      operation: "modify",
      path,
      resource: {
        ...googleResource(),
        content: "实时内容",
        version: "revision-7",
      },
      before: "实时内容",
      after: "Agent 修改",
    },
  ]);
});

test("Agent file tools honor a Google document that became read-only", async () => {
  const { path, replaceCallCount, tools } = environment(false);

  await assert.rejects(tools.writeFile(path, "不能修改"), /read-only/iu);
  assert.equal(replaceCallCount(), 0);
  assert.deepEqual(tools.stagedChanges(), []);
});
