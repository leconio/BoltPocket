import { ConnectorError } from "@boltpocket/connector-core";

const DOCUMENT_ID = /^[A-Za-z0-9_-]{20,200}$/u;

export function parseGoogleDocumentId(input: string) {
  const trimmed = input.trim();
  if (DOCUMENT_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConnectorError("unsupported", "请输入有效的 Google 文档链接。");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new ConnectorError(
      "unsupported",
      "只支持 docs.google.com 的文档链接。",
    );
  }
  const match =
    /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/u.exec(
      url.pathname,
    );
  if (!match?.[1]) {
    throw new ConnectorError(
      "unsupported",
      "链接中没有有效的 Google 文档 ID。",
    );
  }
  return match[1];
}

export function googleDocumentUrl(documentId: string) {
  if (!DOCUMENT_ID.test(documentId)) {
    throw new ConnectorError("unsupported", "Google document ID is invalid.");
  }
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
