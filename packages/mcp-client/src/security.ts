import type { FetchLike } from "@modelcontextprotocol/client";
import { isHttpsOrLocalNetworkHttpUrl } from "@boltpocket/connector-core";

import type { McpServerRuntimeDefinition } from "./contracts.ts";

const BLOCKED_DYNAMIC_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "mcp-method",
  "mcp-protocol-version",
  "mcp-session-id",
  "set-cookie",
  "transfer-encoding",
]);

export class McpSecurityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpSecurityError";
  }
}

export function validatedMcpServerUrl(server: McpServerRuntimeDefinition) {
  let url: URL;
  try {
    url = new URL(server.url);
  } catch (error) {
    throw new McpSecurityError("MCP server URL is invalid.", { cause: error });
  }
  if (
    server.url.length > 2_048 ||
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new McpSecurityError("MCP server URL is not permitted.");
  }
  if (!isHttpsOrLocalNetworkHttpUrl(url)) {
    throw new McpSecurityError(
      "MCP Streamable HTTP requires HTTPS outside the local network.",
    );
  }
  return url;
}

function checkedHeaderEntries(value: Readonly<Record<string, string>>) {
  const entries: [string, string][] = [];
  for (const [name, headerValue] of Object.entries(value)) {
    const normalizedName = name.trim().toLowerCase();
    if (
      !normalizedName ||
      BLOCKED_DYNAMIC_HEADERS.has(normalizedName) ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) ||
      headerValue.length > 16_384 ||
      /[\r\n\0]/u.test(headerValue)
    ) {
      throw new McpSecurityError(
        `MCP credential header is not permitted: ${name}`,
      );
    }
    entries.push([name, headerValue]);
  }
  if (entries.length > 8) {
    throw new McpSecurityError("Too many MCP credential headers.");
  }
  return entries;
}

function checkedQueryEntries(value: Readonly<Record<string, string>>) {
  const entries: [string, string][] = [];
  for (const [name, queryValue] of Object.entries(value)) {
    if (
      !/^[A-Za-z][A-Za-z0-9._~-]{0,63}$/u.test(name) ||
      !queryValue ||
      queryValue.length > 16_384 ||
      /[\r\n\0]/u.test(queryValue)
    ) {
      throw new McpSecurityError(
        `MCP credential query parameter is not permitted: ${name}`,
      );
    }
    entries.push([name, queryValue]);
  }
  if (entries.length > 8) {
    throw new McpSecurityError("Too many MCP credential query parameters.");
  }
  return entries;
}

export function createMcpFetch(server: McpServerRuntimeDefinition): FetchLike {
  const endpoint = validatedMcpServerUrl(server);
  const baseFetch = server.fetch ?? globalThis.fetch;
  if (typeof baseFetch !== "function") {
    throw new McpSecurityError("This runtime does not provide fetch.");
  }
  return async (url, init) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.origin !== endpoint.origin) {
      throw new McpSecurityError(
        "MCP transport refused a cross-origin credential request.",
      );
    }
    const headers = new Headers(init?.headers);
    if (server.requestHeaders) {
      for (const [name, value] of checkedHeaderEntries(
        await server.requestHeaders(),
      )) {
        headers.set(name, value);
      }
    }
    if (server.requestQuery) {
      for (const [name, value] of checkedQueryEntries(
        await server.requestQuery(),
      )) {
        requestUrl.searchParams.set(name, value);
      }
    }
    return baseFetch(requestUrl, {
      ...init,
      credentials: "omit",
      headers,
      redirect: "manual",
    });
  };
}
