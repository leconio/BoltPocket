import { normalizeBrowserUrl } from "./browser-url.ts";

const INTERNAL_OR_EXECUTABLE_SCHEMES = new Set([
  "about",
  "blob",
  "content",
  "data",
  "file",
  "http",
  "https",
  "javascript",
]);

// react-native-webview opens schemes outside this list with Linking before it
// invokes our navigation callback. Let every scheme reach the app-owned policy;
// that policy still allows only HTTP(S)/safe blobs inside WebView.
export const BROWSER_WEBVIEW_ORIGIN_WHITELIST: string[] = ["*"];

export type BrowserNavigationDecision =
  "allow-web" | "prompt-external-app" | "block";

type BrowserNavigationType =
  "click" | "formsubmit" | "backforward" | "reload" | "formresubmit" | "other";

function browserScheme(value: string) {
  return /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase() ?? null;
}

export function isExternalAppUrl(value: string) {
  const scheme = browserScheme(value);
  return Boolean(scheme && !INTERNAL_OR_EXECUTABLE_SCHEMES.has(scheme));
}

export function browserNavigationDecision(
  value: string,
): BrowserNavigationDecision {
  if (value === "about:blank" || /^blob:https?:\/\//iu.test(value)) {
    return "allow-web";
  }
  try {
    normalizeBrowserUrl(value);
    return "allow-web";
  } catch {
    return isExternalAppUrl(value) ? "prompt-external-app" : "block";
  }
}

export function browserExternalDestination(value: string) {
  const scheme = browserScheme(value);
  if (scheme === "http" || scheme === "https") {
    try {
      return new URL(value).hostname.slice(0, 240);
    } catch {
      return `${scheme}:`;
    }
  }
  return scheme ? `${scheme}:` : "App";
}

export function shouldPromptForExternalApp(input: {
  platform: "ios" | "android" | "other";
  agentManaged: boolean;
  navigationType: BrowserNavigationType;
}) {
  return !(input.agentManaged && input.navigationType === "other");
}
