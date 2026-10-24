const OAUTH_SCHEME = "boltpocket:";
const DOCUMENT_OAUTH_HOST = "oauth";
const DOCUMENT_OAUTH_PATH = "/complete";
const ACCOUNT_OAUTH_HOST = "auth";
const ACCOUNT_OAUTH_PATH = "/callback";

/**
 * Expo Router also observes native Linking events. The document OAuth callback
 * is consumed by AppProvider, while the account callback is consumed by
 * expo-web-browser. Routing either callback would expose its one-time values in
 * an unmatched-route screen and replace the user's current navigation surface.
 * Returning null tells Expo Router to leave that surface untouched.
 */
export function redirectOAuthSystemPath(path: string): string | null {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path;
  }

  if (
    url.protocol === OAUTH_SCHEME &&
    ((url.hostname === DOCUMENT_OAUTH_HOST &&
      (url.pathname === DOCUMENT_OAUTH_PATH ||
        url.pathname === "/mcp/complete")) ||
      (url.hostname === ACCOUNT_OAUTH_HOST &&
        url.pathname === ACCOUNT_OAUTH_PATH))
  ) {
    return null;
  }
  return path;
}
