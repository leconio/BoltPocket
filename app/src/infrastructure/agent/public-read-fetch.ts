import type { ProjectShellFetch } from "@boltpocket/project-shell";

const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "range",
  "user-agent",
  "x-github-api-version",
]);

export function assertPublicReadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("curl 只支持有效的公共 HTTPS 地址。");
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    /^\d+(?:\.\d+)*$/u.test(hostname)
  ) {
    throw new Error("curl 只支持无凭据的公共 HTTPS 地址。");
  }
  return url;
}

/**
 * Gives the in-app shell a credential-free, read-only public web fallback.
 * Redirects are rejected so a public URL cannot pivot into a local endpoint.
 */
export function createPublicReadFetch(
  externalFetch: typeof fetch,
): ProjectShellFetch {
  return async (value, init) => {
    const url = assertPublicReadUrl(value);
    const method = init.method.toUpperCase();
    if ((method !== "GET" && method !== "HEAD") || init.body !== undefined) {
      throw new Error("curl 公共网络能力只允许 GET 或 HEAD。");
    }
    const headers: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(init.headers)) {
      const normalizedName = name.toLocaleLowerCase("en-US");
      if (!SAFE_REQUEST_HEADERS.has(normalizedName)) {
        throw new Error(`curl 不允许发送请求头：${name}`);
      }
      headers[normalizedName] = headerValue;
    }
    return externalFetch(url.toString(), {
      credentials: "omit",
      headers,
      method,
      redirect: "error",
      signal: init.signal,
    });
  };
}
