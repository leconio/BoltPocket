import assert from "node:assert/strict";
import test from "node:test";

import { NotionHttpApi } from "./notion-http-api.ts";

const PAGE_ID = "11111111-2222-4333-8444-555555555555";

function page(lastEdited: string, title = "验收页面") {
  return {
    object: "page",
    id: PAGE_ID,
    last_edited_time: lastEdited,
    in_trash: false,
    parent: { type: "page_id", page_id: "parent-page" },
    url: `https://www.notion.so/Acceptance-${PAGE_ID.replaceAll("-", "")}`,
    properties: {
      title: {
        type: "title",
        title: [{ type: "text", plain_text: title }],
      },
    },
  };
}

function markdown(content: string) {
  return {
    object: "page_markdown",
    id: PAGE_ID,
    markdown: content,
    truncated: false,
    unknown_block_ids: [],
  };
}

function oauth() {
  return {
    async connectionForAccount(provider: string, accountId: string) {
      assert.equal(provider, "notion");
      assert.equal(accountId, "workspace-1");
      return { connectionId: "conn_12345678901234567890123456789012" };
    },
    async lease() {
      return {
        accessToken: "notion-access-token",
        tokenType: "bearer",
      };
    },
    clearLease() {},
  } as never;
}

test("Notion replacement uses exact markdown update without child-deletion override", async () => {
  let written = false;
  let patchBody: Record<string, unknown> | undefined;
  const authorizationHeaders: string[] = [];
  const api = new NotionHttpApi(
    oauth(),
    (async (input, init) => {
      const url = String(input);
      authorizationHeaders.push(
        new Headers(init?.headers).get("Authorization") ?? "",
      );
      if (init?.method === "PATCH") {
        written = true;
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify(markdown("新正文")));
      }
      if (url.endsWith("/markdown")) {
        return new Response(
          JSON.stringify(markdown(written ? "新正文" : "旧正文")),
        );
      }
      return new Response(
        JSON.stringify(
          page(
            written ? "2026-08-06T01:01:00.000Z" : "2026-08-06T01:00:00.000Z",
          ),
        ),
      );
    }) as typeof fetch,
    async (value) => `digest:${value}`,
  );

  const before = await api.readPage("workspace-1", PAGE_ID);
  const after = await api.replacePage({
    accountId: "workspace-1",
    pageId: PAGE_ID,
    expectedVersion: before.version,
    markdown: "新正文",
  });

  assert.equal(after.markdown, "新正文");
  assert.deepEqual(patchBody, {
    type: "update_content",
    update_content: {
      content_updates: [{ old_str: "旧", new_str: "新" }],
    },
  });
  assert.doesNotMatch(JSON.stringify(patchBody), /allow_deleting_content/u);
  assert.deepEqual(
    [...new Set(authorizationHeaders)],
    ["Bearer notion-access-token"],
  );
});

test("Notion creation makes a workspace page then writes markdown explicitly", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  let content = "";
  const api = new NotionHttpApi(
    oauth(),
    (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/pages") && init?.method === "POST") {
        return new Response(JSON.stringify(page("2026-08-06T02:00:00.000Z")));
      }
      if (url.endsWith("/markdown") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          replace_content: { new_str: string };
        };
        content = body.replace_content.new_str;
        return new Response(JSON.stringify(markdown(content)));
      }
      if (url.endsWith("/markdown")) {
        return new Response(JSON.stringify(markdown(content)));
      }
      return new Response(JSON.stringify(page("2026-08-06T02:01:00.000Z")));
    }) as typeof fetch,
    async (value) => `digest:${value}`,
  );

  const created = await api.createPage({
    accountId: "workspace-1",
    title: "验收页面",
    markdown: "# 模型创建\n\n正文",
    operationId: "operation-1",
    connectionId: "notion-connection",
    projectId: "project-1",
    resourceId: "notion-page-created",
  });

  assert.equal(created.markdown, "# 模型创建\n正文");
  const createBody = JSON.parse(String(requests[0]?.init?.body)) as Record<
    string,
    unknown
  >;
  assert.deepEqual(createBody.parent, { type: "workspace", workspace: true });
  assert.equal(Object.hasOwn(createBody, "markdown"), false);
  assert.equal(requests[1]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    type: "replace_content",
    replace_content: { new_str: "# 模型创建\n正文" },
  });
});

test("Notion child pages use the recoverable trash flag and never DELETE", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new NotionHttpApi(
    oauth(),
    (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            ...page("2026-08-06T03:01:00.000Z"),
            in_trash: true,
          }),
        );
      }
      if (url.endsWith("/markdown")) {
        return new Response(JSON.stringify(markdown("正文")));
      }
      return new Response(JSON.stringify(page("2026-08-06T03:00:00.000Z")));
    }) as typeof fetch,
    async (value) => `digest:${value}`,
  );

  const trashed = await api.setPageTrashed({
    accountId: "workspace-1",
    pageId: PAGE_ID,
    trashed: true,
  });

  assert.equal(trashed.trashed, true);
  assert.equal(trashed.restorable, true);
  const patch = requests.find((request) => request.init?.method === "PATCH");
  assert.deepEqual(JSON.parse(String(patch?.init?.body)), { in_trash: true });
  assert.equal(
    requests.some((request) => request.init?.method === "DELETE"),
    false,
  );
});

test("Notion workspace-root pages report the provider trash limitation locally", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new NotionHttpApi(
    oauth(),
    (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/markdown")) {
        return new Response(JSON.stringify(markdown("正文")));
      }
      return new Response(
        JSON.stringify({
          ...page("2026-08-06T04:00:00.000Z"),
          parent: { type: "workspace", workspace: true },
        }),
      );
    }) as typeof fetch,
    async (value) => `digest:${value}`,
  );

  await assert.rejects(
    api.setPageTrashed({
      accountId: "workspace-1",
      pageId: PAGE_ID,
      trashed: true,
    }),
    (error) =>
      error instanceof Error && "code" in error && error.code === "unsupported",
  );
  assert.equal(
    requests.some((request) => request.init?.method === "PATCH"),
    false,
  );
});
