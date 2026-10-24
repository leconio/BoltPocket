const UNIVERSAL_LINK_HOSTS = new Set([
  "api.example.invalid",
  "boltpocket-api.example.invalid",
]);
const ENTRY_ID =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export function redirectMiniAppSystemPath(path: string): string {
  let pathname = path;
  try {
    const url = new URL(path);
    if (url.protocol !== "https:" || !UNIVERSAL_LINK_HOSTS.has(url.hostname)) {
      return path;
    }
    pathname = url.pathname;
  } catch {
    // Expo may provide the already-decoded app path instead of a full URL.
  }
  const match = /^\/mini-apps\/([^/?#]+)\/?$/u.exec(pathname);
  if (!match) return path;
  let entryId: string;
  try {
    entryId = decodeURIComponent(match[1]!);
  } catch {
    return path;
  }
  return ENTRY_ID.test(entryId)
    ? `/skill-market/${encodeURIComponent(entryId)}`
    : path;
}
