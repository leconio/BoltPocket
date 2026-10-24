const MAX_BROWSER_URL_LENGTH = 2_048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const HOST_LIKE_INPUT =
  /^(?:localhost|\[[0-9a-f:]+\]|(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/iu;
const SINGLE_LABEL_HOST_WITH_PORT = /^[a-z0-9-]+:\d+(?:[/?#]|$)/iu;

export class BrowserUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUrlError";
  }
}

function assertText(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_BROWSER_URL_LENGTH ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    throw new BrowserUrlError("网址或搜索内容无效。");
  }
  return trimmed;
}

export function normalizeBrowserUrl(value: string): string {
  const input = assertText(value);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new BrowserUrlError("无法识别这个网址。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BrowserUrlError("浏览器只支持 HTTP 和 HTTPS 网页。");
  }
  if (parsed.username || parsed.password) {
    throw new BrowserUrlError("网址中不能包含账号或密码。");
  }
  if (!parsed.hostname || parsed.href.length > MAX_BROWSER_URL_LENGTH) {
    throw new BrowserUrlError("网址无效或过长。");
  }
  return parsed.href;
}

export function normalizeBrowserInput(value: string): string {
  const input = assertText(value);
  if (HOST_LIKE_INPUT.test(input) || SINGLE_LABEL_HOST_WITH_PORT.test(input)) {
    return normalizeBrowserUrl(`https://${input}`);
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(input)) {
    return normalizeBrowserUrl(input);
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
}

export function browserOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(normalizeBrowserUrl(value)).origin;
  } catch {
    return null;
  }
}

export function isAgentSafeBrowserUrl(value: string): boolean {
  try {
    normalizeBrowserUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function sameBrowserOrigin(left: string, right: string): boolean {
  return (
    browserOrigin(left) !== null && browserOrigin(left) === browserOrigin(right)
  );
}

export function browserUrlForModel(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(normalizeBrowserUrl(value));
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

export function browserDisplayHost(value: string | null): string {
  if (!value) return "浏览器";
  try {
    return new URL(normalizeBrowserUrl(value)).hostname;
  } catch {
    return "浏览器";
  }
}
