import { ConnectorError } from "@boltpocket/connector-core";
import {
  canonicalizeNotionMarkdown,
  normalizeNotionPageId,
  notionPageUrl,
  type NotionApiPort,
  type NotionPageSnapshot,
} from "@boltpocket/connector-notion";

import type { ExpoDocumentOAuth } from "@/infrastructure/connectors/expo-document-oauth";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_CHARACTERS = 100_000;
const REQUEST_TIMEOUT_MS = 20_000;

export class NotionHttpApi implements NotionApiPort {
  readonly #oauth: ExpoDocumentOAuth;
  readonly #fetch: typeof fetch;
  readonly #digest: (value: string) => Promise<string>;

  constructor(
    oauth: ExpoDocumentOAuth,
    fetchImplementation: typeof fetch = fetch,
    digest: (value: string) => Promise<string> = defaultDigest,
  ) {
    this.#oauth = oauth;
    this.#fetch = fetchImplementation;
    this.#digest = digest;
  }

  async readPage(accountId: string, pageId: string) {
    const normalized = normalizeNotionPageId(pageId);
    const [page, markdown] = await Promise.all([
      this.#request(accountId, `${NOTION_API}/pages/${normalized}`, {
        method: "GET",
      }),
      this.#request(accountId, `${NOTION_API}/pages/${normalized}/markdown`, {
        method: "GET",
      }),
    ]);
    return decodeNotionPage(page, markdown, this.#digest);
  }

  async replacePage(input: {
    accountId: string;
    pageId: string;
    expectedVersion: string;
    markdown: string;
  }) {
    const markdown = canonicalizeNotionMarkdown(input.markdown);
    safeMarkdown(markdown);
    const current = await this.readPage(input.accountId, input.pageId);
    if (
      current.version !== input.expectedVersion ||
      !current.writable ||
      current.trashed
    ) {
      throw conflict();
    }
    const body = current.markdown.length
      ? {
          type: "update_content",
          update_content: {
            content_updates: [uniqueContentUpdate(current.markdown, markdown)],
          },
        }
      : {
          type: "replace_content",
          replace_content: { new_str: markdown },
        };
    await this.#request(
      input.accountId,
      `${NOTION_API}/pages/${current.pageId}/markdown`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const written = await this.readPage(input.accountId, current.pageId);
    if (written.markdown !== markdown) {
      throw new ConnectorError("io_failure", "Notion 页面写入后复读校验失败。");
    }
    return written;
  }

  async createPage(input: {
    accountId: string;
    title: string;
    markdown: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }) {
    safeTitle(input.title);
    const markdown = canonicalizeNotionMarkdown(input.markdown);
    safeMarkdown(markdown);
    const page = await this.#request(input.accountId, `${NOTION_API}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent: { type: "workspace", workspace: true },
        properties: {
          title: {
            title: [
              { type: "text", text: { content: input.title.slice(0, 1_000) } },
            ],
          },
        },
      }),
    });
    if (!isRecord(page) || typeof page.id !== "string") throw invalidResponse();
    if (markdown) {
      await this.#request(
        input.accountId,
        `${NOTION_API}/pages/${normalizeNotionPageId(page.id)}/markdown`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "replace_content",
            replace_content: { new_str: markdown },
          }),
        },
      );
    }
    const created = await this.readPage(input.accountId, page.id);
    if (created.markdown !== markdown) {
      throw new ConnectorError(
        "io_failure",
        "Notion 页面创建后复读校验失败；不会自动重试，以免重复创建。",
      );
    }
    return created;
  }

  async setPageTrashed(input: {
    accountId: string;
    pageId: string;
    trashed: boolean;
  }) {
    if (!input.trashed) {
      const pageId = normalizeNotionPageId(input.pageId);
      const page = await this.#request(
        input.accountId,
        `${NOTION_API}/pages/${pageId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ in_trash: false }),
        },
      );
      if (!isRecord(page) || page.id !== pageId || page.in_trash !== false) {
        throw invalidResponse();
      }
      const restored = await this.readPage(input.accountId, pageId);
      return {
        ...restored,
        trashed: false,
        writable: restored.writable,
        trashable: true,
        restorable: false,
      };
    }
    const current = await this.readPage(input.accountId, input.pageId);
    if (!current.trashable) {
      throw new ConnectorError(
        "unsupported",
        "Notion 不支持将工作区顶层页面移入回收站。",
      );
    }
    const page = await this.#request(
      input.accountId,
      `${NOTION_API}/pages/${current.pageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ in_trash: true }),
      },
    );
    if (
      !isRecord(page) ||
      page.id !== current.pageId ||
      page.in_trash !== true
    ) {
      throw invalidResponse();
    }
    return {
      ...current,
      trashed: true,
      writable: false,
      trashable: false,
      restorable: true,
      version: await versionFor(page, current.markdown, this.#digest),
    };
  }

  async #request(
    accountId: string,
    url: string,
    init: RequestInit,
    retry = true,
  ): Promise<unknown> {
    const connection = await this.#oauth.connectionForAccount(
      "notion",
      accountId,
    );
    if (!connection) {
      throw new ConnectorError(
        "not_connected",
        "Notion 授权已过期，请重新连接。",
      );
    }
    const lease = await this.#oauth.lease(connection.connectionId);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        credentials: "omit",
        headers: {
          ...init.headers,
          // Notion currently returns `bearer` from OAuth but rejects that
          // lowercase scheme on API requests. Send the documented spelling.
          Authorization: `Bearer ${lease.accessToken}`,
          "Notion-Version": NOTION_VERSION,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ConnectorError("io_failure", "Notion 网络请求失败。", {
        retryable: true,
      });
    }
    if (response.status === 401 && retry) {
      this.#oauth.clearLease(lease.accessToken);
      return this.#request(accountId, url, init, false);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new ConnectorError("unsupported", "Notion 响应超过安全大小限制。");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new ConnectorError("unsupported", "Notion 响应超过安全大小限制。");
    }
    if (!response.ok) throw notionHttpError(response.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse();
    }
  }
}

async function decodeNotionPage(
  page: unknown,
  markdown: unknown,
  digest: (value: string) => Promise<string>,
): Promise<NotionPageSnapshot> {
  if (!isRecord(page) || !isRecord(markdown)) throw invalidResponse();
  const pageId =
    typeof page.id === "string" ? normalizeNotionPageId(page.id) : "";
  const markdownId =
    typeof markdown.id === "string" ? normalizeNotionPageId(markdown.id) : "";
  const content =
    typeof markdown.markdown === "string" ? markdown.markdown : "";
  if (
    !pageId ||
    markdownId !== pageId ||
    typeof markdown.truncated !== "boolean" ||
    !Array.isArray(markdown.unknown_block_ids)
  ) {
    throw invalidResponse();
  }
  safeMarkdown(content);
  const trashed = Boolean(page.in_trash ?? page.archived);
  const parent = isRecord(page.parent) ? page.parent : null;
  const workspaceLevel = parent?.type === "workspace";
  const complete =
    !markdown.truncated && markdown.unknown_block_ids.length === 0;
  return {
    pageId,
    title: notionTitle(page.properties) || "Notion 页面",
    markdown: content,
    version: await versionFor(page, content, digest),
    locator: typeof page.url === "string" ? page.url : notionPageUrl(pageId),
    writable: complete && !trashed,
    trashable: !trashed && !workspaceLevel,
    restorable: trashed,
    trashed,
  };
}

async function versionFor(
  page: Record<string, unknown>,
  markdown: string,
  digest: (value: string) => Promise<string>,
) {
  const lastEdited =
    typeof page.last_edited_time === "string" ? page.last_edited_time : "";
  if (!lastEdited) throw invalidResponse();
  return digest(`${lastEdited}\u0000${markdown}`);
}

async function defaultDigest(value: string) {
  const Crypto = await import("expo-crypto");
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

function notionTitle(properties: unknown) {
  if (!isRecord(properties)) return "";
  for (const property of Object.values(properties)) {
    if (
      !isRecord(property) ||
      property.type !== "title" ||
      !Array.isArray(property.title)
    ) {
      continue;
    }
    const title = property.title
      .map((part) =>
        isRecord(part) && typeof part.plain_text === "string"
          ? part.plain_text
          : "",
      )
      .join("")
      .trim();
    if (title) return title.slice(0, 1_000);
  }
  return "";
}

function uniqueContentUpdate(before: string, after: string) {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  let start = prefix;
  let beforeEnd = before.length - suffix;
  let afterEnd = after.length - suffix;
  if (start === beforeEnd) {
    if (start > 0) start -= 1;
    else if (beforeEnd < before.length) {
      beforeEnd += 1;
      afterEnd += 1;
    }
  }
  while (occurrences(before, before.slice(start, beforeEnd)) !== 1) {
    let expanded = false;
    if (start > 0) {
      start -= 1;
      expanded = true;
    }
    if (beforeEnd < before.length) {
      beforeEnd += 1;
      afterEnd += 1;
      expanded = true;
    }
    if (!expanded) break;
  }
  return {
    old_str: before.slice(start, beforeEnd),
    new_str: after.slice(start, afterEnd),
  };
}

function occurrences(value: string, needle: string) {
  if (!needle) return Number.POSITIVE_INFINITY;
  let count = 0;
  let offset = 0;
  while (offset <= value.length - needle.length) {
    const index = value.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(needle.length, 1);
  }
  return count;
}

function safeMarkdown(value: string) {
  if (value.length > MAX_DOCUMENT_CHARACTERS || value.includes("\0")) {
    throw new ConnectorError("unsupported", "Notion 页面超过安全文本限制。");
  }
}

function safeTitle(value: string) {
  if (
    !value.trim() ||
    value.length > 1_000 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ConnectorError("unsupported", "Notion 页面标题无效。");
  }
}

function notionHttpError(status: number) {
  if (status === 401) {
    return new ConnectorError("not_connected", "Notion 授权已过期。", {
      retryable: true,
    });
  }
  if (status === 403) {
    return new ConnectorError(
      "permission_denied",
      "Notion 未授权访问这个页面。",
    );
  }
  if (status === 404) {
    return new ConnectorError(
      "not_found",
      "Notion 页面不存在或未分享给连接器。",
    );
  }
  if (status === 409) return conflict();
  if (status === 400) {
    return new ConnectorError(
      "unsupported",
      "Notion 拒绝了可能移除子页面、数据库或不支持内容的修改。",
    );
  }
  return new ConnectorError(
    "io_failure",
    `Notion 请求失败（HTTP ${status}）。`,
    { retryable: status === 429 || status >= 500 },
  );
}

function conflict() {
  return new ConnectorError("conflict", "Notion 页面版本已变化。", {
    retryable: true,
  });
}

function invalidResponse() {
  return new ConnectorError("io_failure", "Notion 返回了无效数据。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
