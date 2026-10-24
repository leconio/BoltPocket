import { ConnectorError } from "@boltpocket/connector-core";

const PAGE_ID =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/iu;

export function parseNotionPageId(input: string) {
  const trimmed = input.trim();
  if (PAGE_ID.test(trimmed)) return normalizeNotionPageId(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalidLink();
  }
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "notion.so" ||
      url.hostname.endsWith(".notion.so") ||
      url.hostname === "app.notion.com" ||
      url.hostname === "notion.site" ||
      url.hostname.endsWith(".notion.site")
    )
  ) {
    throw invalidLink();
  }
  const candidates = [
    url.searchParams.get("p") ?? "",
    ...url.pathname.split("/"),
  ];
  for (const candidate of candidates.reverse()) {
    const match = /([0-9a-f]{32})/iu.exec(candidate);
    if (match?.[1]) return normalizeNotionPageId(match[1]);
  }
  throw invalidLink();
}

export function normalizeNotionPageId(value: string) {
  const hex = value.replaceAll("-", "").toLocaleLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(hex)) throw invalidLink();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function notionPageUrl(pageId: string) {
  return `https://www.notion.so/${normalizeNotionPageId(pageId).replaceAll("-", "")}`;
}

function invalidLink() {
  return new ConnectorError("unsupported", "请输入有效的 Notion 页面链接。");
}
