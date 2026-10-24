import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "@/domain/models";
import type { ExpoDocumentOAuth } from "@/infrastructure/connectors/expo-document-oauth";
import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { ExpoNotionConnectionService } from "./notion-connection-service.ts";

const PAGE_ID = "11111111-2222-4333-8444-555555555555";
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

const session = {
  provider: "notion" as const,
  connectionId: "conn_12345678901234567890123456789012",
  accountId: "workspace-1",
  accountName: "验收空间",
  expiresAt: 4_102_444_800,
};

function oauthFixture() {
  return {
    async list() {
      return [session];
    },
    async connect() {
      return session;
    },
    async connectionForAccount() {
      return session;
    },
    async lease() {
      return {
        provider: "notion" as const,
        connectionId: session.connectionId,
        accessToken: "notion-test-token",
        tokenType: "bearer",
        leaseExpiresAt: 4_102_444_800,
      };
    },
    clearLease() {},
  } as unknown as ExpoDocumentOAuth;
}

function notionFetch() {
  return (async (input) => {
    const url = String(input);
    if (url.endsWith("/markdown")) {
      return new Response(
        JSON.stringify({
          object: "page_markdown",
          id: PAGE_ID,
          markdown: "# 验收\n\n正文",
          truncated: false,
          unknown_block_ids: [],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        object: "page",
        id: PAGE_ID,
        last_edited_time: "2026-08-07T01:00:00.000Z",
        in_trash: false,
        parent: { type: "page_id", page_id: "parent-page" },
        url: `https://www.notion.so/${PAGE_ID.replaceAll("-", "")}`,
        properties: {
          title: {
            type: "title",
            title: [{ type: "text", plain_text: "验收页面" }],
          },
        },
      }),
    );
  }) as typeof fetch;
}

test("an explicit Notion link returns the exact focused project resource", async () => {
  const service = new ExpoNotionConnectionService(
    new InMemoryDurableDocumentStore(),
    oauthFixture(),
    {
      async sha256() {
        return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      },
      randomUUID() {
        return "00000000-0000-4000-8000-000000000001";
      },
    },
    notionFetch(),
  );

  const bundle = await service.connect(
    project,
    `https://app.notion.com/p/Acceptance-${PAGE_ID.replaceAll("-", "")}`,
  );

  assert.ok(bundle);
  assert.equal(bundle.focusedResourceId, bundle.resources[0]?.id);
  assert.equal(bundle.resources[0]?.projectId, project.id);
  assert.equal(bundle.resources[0]?.storage.kind, "notion-page");
});
