import { ConnectorError } from "@boltpocket/connector-core";
import type {
  GoogleDocsApiPort,
  GoogleDocsDocumentSnapshot,
} from "@boltpocket/connector-google-docs";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";

import {
  decodeGoogleDocument,
  type DecodedGoogleDocument,
} from "./google-docs-document";

const DOCS_API = "https://docs.googleapis.com/v1/documents";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_CHARACTERS = 100_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{20,200}$/u;

type Fetch = typeof fetch;

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function abortError() {
  return new ConnectorError("io_failure", "Google Docs request timed out.", {
    retryable: true,
  });
}

function connectorHttpError(status: number, operation: "read" | "write") {
  if (status === 401) {
    return new ConnectorError(
      "not_connected",
      "Google authorization expired.",
      { retryable: true },
    );
  }
  if (status === 403) {
    return new ConnectorError(
      "permission_denied",
      "Google account cannot access this document.",
    );
  }
  if (status === 404) {
    return new ConnectorError("not_found", "Google document was not found.");
  }
  if (operation === "write" && (status === 400 || status === 409)) {
    return new ConnectorError(
      "conflict",
      "Google document revision changed before write.",
      { retryable: true },
    );
  }
  return new ConnectorError(
    "io_failure",
    `Google Docs request failed with HTTP ${status}.`,
    { retryable: status >= 500 || status === 429 },
  );
}

function requestBody(current: DecodedGoogleDocument, text: string) {
  const requests: Record<string, unknown>[] = [];
  // A blank Docs body contains only the terminal newline and reports
  // endIndex=2. Deleting [1, 1) is invalid, so only delete real content.
  if (current.endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: current.endIndex - 1,
          ...(current.tabId ? { tabId: current.tabId } : {}),
        },
      },
    });
  }
  if (text.length > 0) {
    requests.push({
      insertText: {
        location: {
          index: 1,
          ...(current.tabId ? { tabId: current.tabId } : {}),
        },
        text,
      },
    });
  }
  return {
    requests,
    writeControl: { requiredRevisionId: current.revisionId },
  };
}

export class GoogleDocsHttpApi implements GoogleDocsApiPort {
  readonly #authorization: GoogleDocsAuthorizationPort;
  readonly #fetch: Fetch;

  constructor(
    authorization: GoogleDocsAuthorizationPort,
    fetchImplementation: Fetch = fetch,
  ) {
    this.#authorization = authorization;
    this.#fetch = fetchImplementation;
  }

  async readDocument(accountId: string, documentId: string) {
    return this.#readDecoded(accountId, documentId);
  }

  async replaceDocument(input: {
    accountId: string;
    documentId: string;
    expectedRevisionId: string;
    text: string;
  }): Promise<GoogleDocsDocumentSnapshot> {
    if (
      input.text.length > MAX_DOCUMENT_CHARACTERS ||
      input.text.includes("\0")
    ) {
      throw new ConnectorError(
        "unsupported",
        "Google document replacement exceeds the safe text limit.",
      );
    }
    const current = await this.#readDecoded(input.accountId, input.documentId);
    if (!current.writable) {
      throw new ConnectorError(
        "unsupported",
        "This Google document cannot be replaced without losing structure.",
      );
    }
    if (current.revisionId !== input.expectedRevisionId) {
      throw new ConnectorError(
        "conflict",
        "Google document revision changed before write.",
        { retryable: true },
      );
    }
    await this.#request(
      input.accountId,
      `${DOCS_API}/${encodeURIComponent(input.documentId)}:batchUpdate`,
      "write",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(current, input.text)),
      },
    );
    const written = await this.#readDecoded(input.accountId, input.documentId);
    if (written.text !== input.text) {
      throw new ConnectorError(
        "io_failure",
        "Google Docs replacement could not be verified.",
      );
    }
    return written;
  }

  async createDocument(input: {
    accountId: string;
    title: string;
    text: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }) {
    const title = input.title.trim();
    if (
      !title ||
      title.length > 1_000 ||
      /[\u0000-\u001f\u007f]/u.test(title) ||
      input.text.length > MAX_DOCUMENT_CHARACTERS ||
      input.text.includes("\0")
    ) {
      throw new ConnectorError("unsupported", "Google 文档标题或内容无效。");
    }
    const body = await this.#request(input.accountId, DOCS_API, "write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    let created: unknown;
    try {
      created = JSON.parse(body) as unknown;
    } catch {
      throw new ConnectorError(
        "io_failure",
        "Google 文档已请求创建，但响应无效；不会自动重试，以免重复创建。",
      );
    }
    const documentId =
      created &&
      typeof created === "object" &&
      !Array.isArray(created) &&
      typeof (created as Record<string, unknown>).documentId === "string"
        ? ((created as Record<string, unknown>).documentId as string)
        : "";
    if (!DOCUMENT_ID.test(documentId)) {
      throw new ConnectorError(
        "io_failure",
        "Google 文档已请求创建，但没有返回有效文档 ID；不会自动重试。",
      );
    }
    const blank = await this.#readDecoded(input.accountId, documentId);
    const written = input.text
      ? await this.replaceDocument({
          accountId: input.accountId,
          documentId,
          expectedRevisionId: blank.revisionId,
          text: input.text,
        })
      : blank;
    return {
      ...written,
      trashable: true,
      restorable: false,
      trashed: false,
    };
  }

  async setDocumentTrashed(input: {
    accountId: string;
    documentId: string;
    trashed: boolean;
  }) {
    const before = input.trashed
      ? await this.#readDecoded(input.accountId, input.documentId)
      : null;
    const body = await this.#request(
      input.accountId,
      `${DRIVE_API}/${encodeURIComponent(input.documentId)}?fields=id%2Ctrashed`,
      "write",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: input.trashed }),
      },
    );
    let response: unknown;
    try {
      response = JSON.parse(body) as unknown;
    } catch {
      throw new ConnectorError("io_failure", "Google Drive 回收站响应无效。");
    }
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      (response as Record<string, unknown>).id !== input.documentId ||
      (response as Record<string, unknown>).trashed !== input.trashed
    ) {
      throw new ConnectorError(
        "io_failure",
        "Google Drive 回收站结果无法校验。",
      );
    }
    if (input.trashed) {
      return {
        ...before!,
        writable: false,
        trashable: false,
        restorable: true,
        trashed: true,
      };
    }
    const restored = await this.#readDecoded(input.accountId, input.documentId);
    return {
      ...restored,
      trashable: true,
      restorable: false,
      trashed: false,
    };
  }

  async #readDecoded(accountId: string, documentId: string) {
    const body = await this.#request(
      accountId,
      `${DOCS_API}/${encodeURIComponent(documentId)}?includeTabsContent=true&suggestionsViewMode=SUGGESTIONS_INLINE`,
      "read",
      { method: "GET" },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new ConnectorError(
        "io_failure",
        "Google Docs response is not valid JSON.",
      );
    }
    const decoded = decodeGoogleDocument(parsed);
    if (decoded.documentId !== documentId) {
      throw new ConnectorError(
        "permission_denied",
        "Google Docs API returned another document.",
      );
    }
    return decoded;
  }

  async #request(
    accountId: string,
    url: string,
    operation: "read" | "write",
    init: RequestInit,
    retry = true,
  ): Promise<string> {
    const accessToken = await this.#authorization.accessTokenFor(accountId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        credentials: "omit",
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw abortError();
      throw new ConnectorError(
        "io_failure",
        "Google Docs network request failed.",
        { cause: error, retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && retry) {
      await this.#authorization.clearAccessToken(accessToken);
      return this.#request(accountId, url, operation, init, false);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      throw new ConnectorError(
        "unsupported",
        "Google Docs response exceeds the safe size limit.",
      );
    }
    const body = await response.text();
    if (byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new ConnectorError(
        "unsupported",
        "Google Docs response exceeds the safe size limit.",
      );
    }
    if (!response.ok) throw connectorHttpError(response.status, operation);
    return body;
  }
}
