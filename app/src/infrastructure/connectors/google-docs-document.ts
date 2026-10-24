import { ConnectorError } from "@boltpocket/connector-core";
import type { GoogleDocsDocumentSnapshot } from "@boltpocket/connector-google-docs";

const DOCUMENT_ID = /^[A-Za-z0-9_-]{20,200}$/u;
const MAX_DOCUMENT_CHARACTERS = 100_000;

export type DecodedGoogleDocument = GoogleDocsDocumentSnapshot & {
  tabId?: string;
  endIndex: number;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown) {
  return Number.isSafeInteger(value) ? (value as number) : 0;
}

function withoutTerminalSentinel(value: string) {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function textVersion(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function paragraphText(paragraph: JsonRecord) {
  return records(paragraph.elements)
    .map((element) => {
      if (record(element.textRun)) return string(element.textRun.content);
      if (record(element.autoText)) return string(element.autoText.content);
      if (record(element.footnoteReference)) return "[脚注]";
      if (record(element.inlineObjectElement)) return "[对象]";
      if (record(element.person)) {
        const properties = record(element.person.personProperties)
          ? element.person.personProperties
          : {};
        return (
          string(properties.name) || string(properties.email) || "[联系人]"
        );
      }
      if (record(element.richLink)) {
        const properties = record(element.richLink.richLinkProperties)
          ? element.richLink.richLinkProperties
          : {};
        return string(properties.title) || "[链接]";
      }
      return "";
    })
    .join("");
}

function structuralText(content: unknown): string {
  return records(content)
    .map((element) => {
      if (record(element.paragraph)) return paragraphText(element.paragraph);
      if (record(element.tableOfContents)) {
        return structuralText(element.tableOfContents.content);
      }
      if (record(element.table)) {
        return records(element.table.tableRows)
          .map((row) =>
            records(row.tableCells)
              .map((cell) =>
                withoutTerminalSentinel(structuralText(cell.content)),
              )
              .join("\t"),
          )
          .join("\n");
      }
      return "";
    })
    .join("");
}

function emptyMap(value: unknown) {
  return (
    value === undefined || (record(value) && Object.keys(value).length === 0)
  );
}

function plainParagraph(paragraph: JsonRecord) {
  if (paragraph.bullet !== undefined) return false;
  if (record(paragraph.paragraphStyle)) {
    const style = paragraph.paragraphStyle;
    const allowed = new Set(["namedStyleType", "direction"]);
    if (
      string(style.namedStyleType) !== "NORMAL_TEXT" ||
      Object.keys(style).some((key) => !allowed.has(key))
    ) {
      return false;
    }
  }
  return records(paragraph.elements).every((element) => {
    if (!record(element.textRun)) return false;
    const style = element.textRun.textStyle;
    return (
      style === undefined || (record(style) && Object.keys(style).length === 0)
    );
  });
}

function plainBody(documentTab: JsonRecord, content: JsonRecord[]) {
  if (
    !emptyMap(documentTab.headers) ||
    !emptyMap(documentTab.footers) ||
    !emptyMap(documentTab.footnotes) ||
    !emptyMap(documentTab.inlineObjects) ||
    !emptyMap(documentTab.positionedObjects)
  ) {
    return false;
  }
  return content.every((element, index) => {
    if (element.sectionBreak !== undefined) return index === 0;
    return record(element.paragraph) && plainParagraph(element.paragraph);
  });
}

type ParsedTab = {
  id?: string;
  title: string;
  documentTab: JsonRecord;
};

function collectTabs(tabs: unknown, output: ParsedTab[]) {
  for (const tab of records(tabs)) {
    if (record(tab.documentTab)) {
      const properties = record(tab.tabProperties) ? tab.tabProperties : {};
      const id = string(properties.tabId);
      output.push({
        ...(id ? { id } : {}),
        title: string(properties.title) || "文档",
        documentTab: tab.documentTab,
      });
    }
    collectTabs(tab.childTabs, output);
  }
}

export function parseGoogleDocumentId(input: string) {
  const trimmed = input.trim();
  if (DOCUMENT_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("请输入有效的 Google 文档链接。");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new Error("只支持 docs.google.com 的文档链接。");
  }
  const match = url.pathname.match(
    /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/u,
  );
  if (!match?.[1]) throw new Error("链接中没有有效的 Google 文档 ID。");
  return match[1];
}

export function googleDocumentUrl(documentId: string) {
  if (!DOCUMENT_ID.test(documentId)) {
    throw new ConnectorError("unsupported", "Google document ID is invalid.");
  }
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

export function decodeGoogleDocument(value: unknown): DecodedGoogleDocument {
  if (!record(value)) {
    throw new ConnectorError("io_failure", "Google Docs response is invalid.");
  }
  const documentId = string(value.documentId);
  const title = string(value.title).trim() || "未命名文档";
  if (
    !DOCUMENT_ID.test(documentId) ||
    title.length > 1_000 ||
    /[\u0000-\u001f\u007f]/u.test(title)
  ) {
    throw new ConnectorError("io_failure", "Google Docs response is invalid.");
  }

  const tabs: ParsedTab[] = [];
  collectTabs(value.tabs, tabs);
  if (tabs.length === 0 && record(value.body)) {
    tabs.push({
      title,
      documentTab: {
        body: value.body,
        headers: value.headers,
        footers: value.footers,
        footnotes: value.footnotes,
        inlineObjects: value.inlineObjects,
        positionedObjects: value.positionedObjects,
      },
    });
  }
  if (tabs.length === 0) {
    throw new ConnectorError(
      "unsupported",
      "Google document has no readable tab.",
    );
  }

  const tabTexts = tabs.map((tab) => {
    const body = record(tab.documentTab.body) ? tab.documentTab.body : {};
    return withoutTerminalSentinel(structuralText(body.content));
  });
  const text =
    tabs.length === 1
      ? tabTexts[0]!
      : tabs
          .map((tab, index) => `=== ${tab.title} ===\n${tabTexts[index]}`)
          .join("\n\n");
  if (text.length > MAX_DOCUMENT_CHARACTERS || text.includes("\0")) {
    throw new ConnectorError(
      "unsupported",
      "Google document exceeds the safe text limit.",
    );
  }

  const first = tabs[0]!;
  const firstBody = record(first.documentTab.body)
    ? first.documentTab.body
    : {};
  const firstContent = records(firstBody.content);
  const endIndex = firstContent.reduce(
    (maximum, element) => Math.max(maximum, integer(element.endIndex)),
    1,
  );
  const revisionId = string(value.revisionId);
  const writable =
    Boolean(revisionId) &&
    tabs.length === 1 &&
    endIndex >= 1 &&
    plainBody(first.documentTab, firstContent);
  return {
    documentId,
    title,
    text,
    revisionId: revisionId || `read-only-${textVersion(`${title}\0${text}`)}`,
    writable,
    ...(first.id ? { tabId: first.id } : {}),
    endIndex,
  };
}
