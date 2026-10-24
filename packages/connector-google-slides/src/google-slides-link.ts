import { ConnectorError } from "@boltpocket/connector-core";

const PRESENTATION_ID = /^[A-Za-z0-9_-]{20,200}$/u;

export function parseGooglePresentationId(input: string) {
  const trimmed = input.trim();
  if (PRESENTATION_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConnectorError("unsupported", "请输入有效的 Google 幻灯片链接。");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new ConnectorError(
      "unsupported",
      "只支持 docs.google.com 的幻灯片链接。",
    );
  }
  const match =
    /^\/presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/u.exec(
      url.pathname,
    );
  if (!match?.[1]) {
    throw new ConnectorError(
      "unsupported",
      "链接中没有有效的 Google 幻灯片 ID。",
    );
  }
  return match[1];
}

export function googlePresentationUrl(presentationId: string) {
  if (!PRESENTATION_ID.test(presentationId)) {
    throw new ConnectorError(
      "unsupported",
      "Google presentation ID is invalid.",
    );
  }
  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}
