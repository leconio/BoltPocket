import { ConnectorError } from "@boltpocket/connector-core";
import {
  canonicalizeGoogleSlidesText,
  googlePresentationUrl,
  parseGooglePresentationId,
  parseGoogleSlidesText,
  stringifyGoogleSlidesText,
  type GoogleSlidesApiPort,
  type GoogleSlidesPresentationSnapshot,
  type GoogleSlidesTextDeck,
} from "@boltpocket/connector-google-slides";

import type { GoogleDocsAuthorizationPort } from "@/application/ports/google-docs-connections";

const SLIDES_API = "https://slides.googleapis.com/v1/presentations";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const PRESENTATION_MIME = "application/vnd.google-apps.presentation";
const PRESENTATION_ID = /^[A-Za-z0-9_-]{20,200}$/u;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CREATE_REQUESTS = 900;
const REQUEST_TIMEOUT_MS = 20_000;

type Fetch = typeof fetch;
type JsonRecord = Record<string, unknown>;

type DecodedGooglePresentation = GoogleSlidesPresentationSnapshot & {
  slideObjectIds: string[];
  textObjectIds: string[][];
  deck: GoogleSlidesTextDeck;
};

function record(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function invalidResponse(): ConnectorError {
  return new ConnectorError("io_failure", "Google Slides 响应无效。");
}

function safeTitle(value: unknown, fallback: string) {
  const title = string(value).trim() || fallback;
  if (title.length > 1_000 || /[\u0000-\u001f\u007f]/u.test(title)) {
    throw invalidResponse();
  }
  return title;
}

function shapeText(value: unknown) {
  if (!record(value)) return "";
  const text = records(value.textElements)
    .map((element) => {
      if (record(element.textRun)) return string(element.textRun.content);
      if (record(element.autoText)) return string(element.autoText.content);
      return "";
    })
    .join("");
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function tableText(table: JsonRecord) {
  const rows = Number.isSafeInteger(table.rows) ? (table.rows as number) : 0;
  const columns = Number.isSafeInteger(table.columns)
    ? (table.columns as number)
    : 0;
  const cells = records(table.tableRows).map((row) =>
    records(row.tableCells).map((cell) => shapeText(cell.text)),
  );
  if (
    rows <= 0 ||
    columns <= 0 ||
    rows > 1_000 ||
    columns > 1_000 ||
    cells.length !== rows ||
    cells.some((row) => row.length !== columns)
  ) {
    throw invalidResponse();
  }
  return cells;
}

function decodePresentation(
  value: unknown,
  drive: { canEdit: boolean; trashed: boolean },
): DecodedGooglePresentation {
  if (!record(value)) throw invalidResponse();
  const presentationId = string(value.presentationId);
  const revisionId = string(value.revisionId);
  if (!PRESENTATION_ID.test(presentationId)) throw invalidResponse();
  const slides = records(value.slides);
  if (slides.length === 0 || slides.length > 200) throw invalidResponse();
  const slideObjectIds: string[] = [];
  const textObjectIds: string[][] = [];
  const deckSlides: GoogleSlidesTextDeck["slides"] = [];
  for (const slide of slides) {
    const slideObjectId = string(slide.objectId);
    if (!slideObjectId || slideObjectId.length > 200) throw invalidResponse();
    const texts: string[] = [];
    const objectIds: string[] = [];
    const tables: string[][][] = [];
    for (const element of records(slide.pageElements)) {
      const objectId = string(element.objectId);
      if (!objectId || objectId.length > 200) throw invalidResponse();
      if (record(element.shape)) {
        texts.push(shapeText(element.shape.text));
        objectIds.push(objectId);
      } else if (record(element.table)) {
        tables.push(tableText(element.table));
      }
    }
    slideObjectIds.push(slideObjectId);
    textObjectIds.push(objectIds);
    deckSlides.push({ texts, ...(tables.length === 0 ? {} : { tables }) });
  }
  const deck = { slides: deckSlides };
  const text = stringifyGoogleSlidesText(deck);
  const title = safeTitle(value.title, "未命名幻灯片");
  return {
    resourceId: presentationId,
    presentationId,
    title,
    text,
    version:
      revisionId || `read-only-${presentationId.slice(0, 16)}-${text.length}`,
    writable: Boolean(revisionId) && drive.canEdit && !drive.trashed,
    trashable: !drive.trashed,
    restorable: drive.trashed,
    trashed: drive.trashed,
    metadata: { presentationId },
    slideObjectIds,
    textObjectIds,
    deck,
  };
}

function connectorHttpError(status: number, operation: "read" | "write") {
  if (status === 401) {
    return new ConnectorError("not_connected", "Google 授权已过期。", {
      retryable: true,
    });
  }
  if (status === 403) {
    return new ConnectorError(
      "permission_denied",
      "Google 账号无法访问这份幻灯片，或尚未重新授权幻灯片权限。",
    );
  }
  if (status === 404) {
    return new ConnectorError("not_found", "Google 幻灯片不存在。");
  }
  if (operation === "write" && (status === 400 || status === 409)) {
    return new ConnectorError("conflict", "Google 幻灯片在写入前发生变化。", {
      retryable: true,
    });
  }
  return new ConnectorError(
    "io_failure",
    `Google Slides 请求失败（HTTP ${status}）。`,
    { retryable: status >= 500 || status === 429 },
  );
}

function minimalTextRequests(objectId: string, before: string, after: string) {
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
  const deleteEnd = before.length - suffix;
  const insertion = after.slice(prefix, after.length - suffix);
  const requests: JsonRecord[] = [];
  if (deleteEnd > prefix) {
    requests.push({
      deleteText: {
        objectId,
        textRange: {
          type: "FIXED_RANGE",
          startIndex: prefix,
          endIndex: deleteEnd,
        },
      },
    });
  }
  if (insertion) {
    requests.push({
      insertText: { objectId, insertionIndex: prefix, text: insertion },
    });
  }
  return requests;
}

function updatePresentationRequests(
  current: DecodedGooglePresentation,
  next: GoogleSlidesTextDeck,
) {
  if (next.slides.length !== current.deck.slides.length) {
    throw new ConnectorError(
      "unsupported",
      "现有 Google 幻灯片暂不允许通过文本 Diff 增删幻灯片。",
    );
  }
  const requests: JsonRecord[] = [];
  for (let slideIndex = 0; slideIndex < next.slides.length; slideIndex += 1) {
    const beforeSlide = current.deck.slides[slideIndex]!;
    const afterSlide = next.slides[slideIndex]!;
    if (
      afterSlide.texts.length !== beforeSlide.texts.length ||
      JSON.stringify(afterSlide.tables ?? []) !==
        JSON.stringify(beforeSlide.tables ?? [])
    ) {
      throw new ConnectorError(
        "unsupported",
        "Google 幻灯片修改只能变更现有文本框文字，不能改动结构或表格。",
      );
    }
    for (
      let textIndex = 0;
      textIndex < afterSlide.texts.length;
      textIndex += 1
    ) {
      const before = beforeSlide.texts[textIndex]!;
      const after = afterSlide.texts[textIndex]!;
      const objectId = current.textObjectIds[slideIndex]?.[textIndex];
      if (!objectId) throw invalidResponse();
      if (before !== after) {
        requests.push(...minimalTextRequests(objectId, before, after));
      }
    }
  }
  return requests;
}

function stableObjectSuffix(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function createPresentationRequests(
  current: DecodedGooglePresentation,
  deck: GoogleSlidesTextDeck,
  operationId: string,
) {
  if (deck.slides.some((slide) => (slide.tables?.length ?? 0) > 0)) {
    throw new ConnectorError(
      "unsupported",
      "新建 Google 幻灯片暂不支持生成表格。",
    );
  }
  const requests: JsonRecord[] = current.slideObjectIds.map((objectId) => ({
    deleteObject: { objectId },
  }));
  deck.slides.forEach((slide, slideIndex) => {
    const slideId = `ihs_${stableObjectSuffix(`${operationId}:slide:${slideIndex}`)}`;
    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: slideIndex,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
    const boxCount = Math.max(1, slide.texts.length);
    const availableHeight = 4_800_000;
    const boxHeight = Math.max(300_000, Math.floor(availableHeight / boxCount));
    slide.texts.forEach((text, textIndex) => {
      const shapeId = `iht_${stableObjectSuffix(`${operationId}:${slideIndex}:${textIndex}`)}`;
      requests.push({
        createShape: {
          objectId: shapeId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: slideId,
            size: {
              width: { magnitude: 8_000_000, unit: "EMU" },
              height: { magnitude: boxHeight, unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 500_000,
              translateY: 400_000 + textIndex * boxHeight,
              unit: "EMU",
            },
          },
        },
      });
      if (text) requests.push({ insertText: { objectId: shapeId, text } });
    });
  });
  if (requests.length > MAX_CREATE_REQUESTS) {
    throw new ConnectorError("unsupported", "Google 幻灯片新建请求过于复杂。");
  }
  return requests;
}

export class GoogleSlidesHttpApi implements GoogleSlidesApiPort {
  readonly #authorization: GoogleDocsAuthorizationPort;
  readonly #fetch: Fetch;

  constructor(
    authorization: GoogleDocsAuthorizationPort,
    fetchImplementation: Fetch = fetch,
  ) {
    this.#authorization = authorization;
    this.#fetch = fetchImplementation;
  }

  async resolveResource(accountId: string, value: string) {
    return this.readResource(accountId, parseGooglePresentationId(value));
  }

  async readResource(accountId: string, resourceId: string) {
    const [presentationBody, drive] = await Promise.all([
      this.#request(
        accountId,
        `${SLIDES_API}/${encodeURIComponent(resourceId)}`,
        "read",
        { method: "GET" },
      ),
      this.#driveMetadata(accountId, resourceId),
    ]);
    return decodePresentation(this.#parseJson(presentationBody), drive);
  }

  async replaceResource(input: {
    accountId: string;
    resourceId: string;
    expectedVersion: string;
    text: string;
  }) {
    if (canonicalizeGoogleSlidesText(input.text) !== input.text) {
      throw new ConnectorError(
        "unsupported",
        "Google 幻灯片修改必须保持规范 JSON 格式。",
      );
    }
    const current = await this.readResource(input.accountId, input.resourceId);
    if (!current.writable || current.version !== input.expectedVersion) {
      throw new ConnectorError("conflict", "Google 幻灯片在写入前发生变化。", {
        retryable: true,
      });
    }
    const requests = updatePresentationRequests(
      current,
      parseGoogleSlidesText(input.text),
    );
    if (requests.length === 0) return current;
    await this.#batchUpdate(
      input.accountId,
      input.resourceId,
      current.version,
      requests,
    );
    const written = await this.readResource(input.accountId, input.resourceId);
    if (written.text !== input.text) {
      throw new ConnectorError("io_failure", "Google 幻灯片写入结果无法校验。");
    }
    return written;
  }

  async createResource(input: {
    accountId: string;
    title: string;
    text: string;
    operationId: string;
    connectionId: string;
    projectId: string;
    resourceId: string;
  }) {
    const title = safeTitle(input.title, "未命名幻灯片");
    if (canonicalizeGoogleSlidesText(input.text) !== input.text) {
      throw new ConnectorError(
        "unsupported",
        "Google 幻灯片新建内容必须是规范 JSON。",
      );
    }
    const body = await this.#request(input.accountId, SLIDES_API, "write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const created = this.#parseJson(body);
    const presentationId = record(created)
      ? string(created.presentationId)
      : "";
    if (!PRESENTATION_ID.test(presentationId)) {
      throw new ConnectorError(
        "io_failure",
        "Google 幻灯片已请求创建，但响应无效；不会自动重试。",
      );
    }
    const blank = await this.readResource(input.accountId, presentationId);
    const deck = parseGoogleSlidesText(input.text);
    await this.#batchUpdate(
      input.accountId,
      presentationId,
      blank.version,
      createPresentationRequests(blank, deck, input.operationId),
    );
    const written = await this.readResource(input.accountId, presentationId);
    if (written.text !== input.text) {
      throw new ConnectorError(
        "io_failure",
        "Google 幻灯片新建内容无法校验；不会自动重试。",
      );
    }
    return {
      ...written,
      trashable: true,
      restorable: false,
      trashed: false,
    };
  }

  async setResourceTrashed(input: {
    accountId: string;
    resourceId: string;
    trashed: boolean;
  }) {
    const before = input.trashed
      ? await this.readResource(input.accountId, input.resourceId)
      : null;
    const body = await this.#request(
      input.accountId,
      `${DRIVE_API}/${encodeURIComponent(input.resourceId)}?fields=id%2Ctrashed`,
      "write",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: input.trashed }),
      },
    );
    const response = this.#parseJson(body);
    if (
      !record(response) ||
      response.id !== input.resourceId ||
      response.trashed !== input.trashed
    ) {
      throw invalidResponse();
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
    return this.readResource(input.accountId, input.resourceId);
  }

  async #batchUpdate(
    accountId: string,
    presentationId: string,
    revisionId: string,
    requests: JsonRecord[],
  ) {
    await this.#request(
      accountId,
      `${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`,
      "write",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests,
          writeControl: { requiredRevisionId: revisionId },
        }),
      },
    );
  }

  async #driveMetadata(accountId: string, presentationId: string) {
    const fields = encodeURIComponent(
      "id,mimeType,trashed,capabilities(canEdit)",
    );
    const body = await this.#request(
      accountId,
      `${DRIVE_API}/${encodeURIComponent(presentationId)}?fields=${fields}`,
      "read",
      { method: "GET" },
    );
    const value = this.#parseJson(body);
    const capabilities =
      record(value) && record(value.capabilities) ? value.capabilities : {};
    if (
      !record(value) ||
      value.id !== presentationId ||
      value.mimeType !== PRESENTATION_MIME ||
      typeof value.trashed !== "boolean" ||
      typeof capabilities.canEdit !== "boolean"
    ) {
      throw invalidResponse();
    }
    return { trashed: value.trashed, canEdit: capabilities.canEdit };
  }

  #parseJson(body: string): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw invalidResponse();
    }
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
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ConnectorError("io_failure", "Google Slides 请求超时。", {
          retryable: true,
        });
      }
      throw new ConnectorError("io_failure", "Google Slides 网络请求失败。", {
        cause: error,
        retryable: true,
      });
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
        "Google Slides 响应超过安全大小限制。",
      );
    }
    const body = await response.text();
    if (byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new ConnectorError(
        "unsupported",
        "Google Slides 响应超过安全大小限制。",
      );
    }
    if (!response.ok) throw connectorHttpError(response.status, operation);
    return body;
  }
}

export { googlePresentationUrl };
