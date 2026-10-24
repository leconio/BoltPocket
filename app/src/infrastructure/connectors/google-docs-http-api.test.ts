import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";

import { GoogleDocsHttpApi } from "./google-docs-http-api.ts";

const DOCUMENT_ID = "document_12345678901234567890";

function docsResponse(
  text: string,
  revisionId: string,
  documentId = DOCUMENT_ID,
) {
  return {
    documentId,
    title: "计划",
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

class FakeAuthorization implements GoogleDocsAuthorizationPort {
  readonly tokens: string[];
  readonly cleared: string[] = [];
  readonly accountCalls: string[] = [];

  constructor(tokens = ["token-1"]) {
    this.tokens = [...tokens];
  }

  async connect() {
    return null;
  }

  async restore() {
    return null;
  }

  async accessTokenFor(accountId: string) {
    this.accountCalls.push(accountId);
    return this.tokens.shift() ?? "token-final";
  }

  async clearAccessToken(accessToken: string) {
    this.cleared.push(accessToken);
  }
}

test("Google Docs API reads only the requested document with bearer auth", async () => {
  const authorization = new FakeAuthorization();
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleDocsHttpApi(authorization, (async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(docsResponse("草稿\n", "revision-7")));
  }) as typeof fetch);

  const snapshot = await api.readDocument("account-1", DOCUMENT_ID);

  assert.equal(snapshot.text, "草稿");
  assert.equal(snapshot.revisionId, "revision-7");
  assert.equal(snapshot.writable, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    `https://docs.googleapis.com/v1/documents/${DOCUMENT_ID}?includeTabsContent=true&suggestionsViewMode=SUGGESTIONS_INLINE`,
  );
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string>).Authorization,
    "Bearer token-1",
  );
});

test("one unauthorized response clears the token and retries once", async () => {
  const authorization = new FakeAuthorization(["expired", "fresh"]);
  const headers: string[] = [];
  let call = 0;
  const api = new GoogleDocsHttpApi(authorization, (async (_input, init) => {
    headers.push(
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
        "",
    );
    call += 1;
    return call === 1
      ? new Response("", { status: 401 })
      : new Response(JSON.stringify(docsResponse("草稿\n", "revision-7")));
  }) as typeof fetch);

  await api.readDocument("account-1", DOCUMENT_ID);

  assert.deepEqual(authorization.cleared, ["expired"]);
  assert.deepEqual(headers, ["Bearer expired", "Bearer fresh"]);
});

test("replacement binds the required revision and verifies the final text", async () => {
  const authorization = new FakeAuthorization([
    "token-read",
    "token-write",
    "token-verify",
  ]);
  const requests: { url: string; init?: RequestInit }[] = [];
  const responses = [
    new Response(JSON.stringify(docsResponse("旧\n", "revision-7"))),
    new Response("{}"),
    new Response(JSON.stringify(docsResponse("新\n", "revision-8"))),
  ];
  const api = new GoogleDocsHttpApi(authorization, (async (input, init) => {
    requests.push({ url: String(input), init });
    return responses.shift()!;
  }) as typeof fetch);

  const written = await api.replaceDocument({
    accountId: "account-1",
    documentId: DOCUMENT_ID,
    expectedRevisionId: "revision-7",
    text: "新",
  });

  assert.equal(written.revisionId, "revision-8");
  assert.equal(written.text, "新");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(
    requests[1]?.url,
    `https://docs.googleapis.com/v1/documents/${DOCUMENT_ID}:batchUpdate`,
  );
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    requests: [
      {
        deleteContentRange: {
          range: { startIndex: 1, endIndex: 2, tabId: "tab-1" },
        },
      },
      {
        insertText: {
          location: { index: 1, tabId: "tab-1" },
          text: "新",
        },
      },
    ],
    writeControl: { requiredRevisionId: "revision-7" },
  });
});

test("mismatched document identities and denied access fail closed", async () => {
  const wrongIdentity = new GoogleDocsHttpApi(
    new FakeAuthorization(),
    (async () =>
      new Response(
        JSON.stringify(
          docsResponse(
            "草稿\n",
            "revision-7",
            "another_document_123456789012345",
          ),
        ),
      )) as typeof fetch,
  );
  await assert.rejects(
    wrongIdentity.readDocument("account-1", DOCUMENT_ID),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );

  const denied = new GoogleDocsHttpApi(
    new FakeAuthorization(),
    (async () => new Response("{}", { status: 403 })) as typeof fetch,
  );
  await assert.rejects(
    denied.readDocument("account-1", DOCUMENT_ID),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );
});

test("Google Docs creation creates a blank file, revision-binds content, and marks it trashable", async () => {
  const authorization = new FakeAuthorization();
  const requests: { url: string; init?: RequestInit }[] = [];
  let written = false;
  const api = new GoogleDocsHttpApi(authorization, (async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (
      url === "https://docs.googleapis.com/v1/documents" &&
      init?.method === "POST"
    ) {
      return new Response(
        JSON.stringify({ documentId: DOCUMENT_ID, title: "验收文档" }),
      );
    }
    if (url.endsWith(":batchUpdate")) {
      written = true;
      return new Response("{}");
    }
    return new Response(
      JSON.stringify(
        docsResponse(
          written ? "模型创建\n" : "\n",
          written ? "revision-2" : "revision-1",
        ),
      ),
    );
  }) as typeof fetch);

  const created = await api.createDocument({
    accountId: "account-1",
    title: "验收文档",
    text: "模型创建",
    operationId: "operation-1",
    connectionId: "google-docs-1",
    projectId: "project-1",
    resourceId: "google-doc-created",
  });

  assert.equal(created.text, "模型创建");
  assert.equal(created.trashable, true);
  assert.equal(created.trashed, false);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    title: "验收文档",
  });
  const batch = requests.find((request) =>
    request.url.endsWith(":batchUpdate"),
  );
  const batchBody = JSON.parse(String(batch?.init?.body)) as {
    requests: Record<string, unknown>[];
    writeControl: { requiredRevisionId: string };
  };
  assert.equal(batchBody.writeControl.requiredRevisionId, "revision-1");
  assert.deepEqual(batchBody.requests, [
    {
      insertText: {
        location: { index: 1, tabId: "tab-1" },
        text: "模型创建",
      },
    },
  ]);
});

test("Google Docs trash uses recoverable Drive trash instead of permanent deletion", async () => {
  const authorization = new FakeAuthorization();
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new GoogleDocsHttpApi(authorization, (async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
      return new Response(JSON.stringify({ id: DOCUMENT_ID, trashed: true }));
    }
    return new Response(JSON.stringify(docsResponse("正文\n", "revision-7")));
  }) as typeof fetch);

  const trashed = await api.setDocumentTrashed({
    accountId: "account-1",
    documentId: DOCUMENT_ID,
    trashed: true,
  });

  assert.equal(trashed.trashed, true);
  assert.equal(trashed.restorable, true);
  const patch = requests.find((request) => request.init?.method === "PATCH");
  assert.ok(patch?.url.includes("/drive/v3/files/"));
  assert.deepEqual(JSON.parse(String(patch?.init?.body)), { trashed: true });
  assert.equal(
    requests.some((request) => request.init?.method === "DELETE"),
    false,
  );
});
