import type { ConnectionMessageKey } from "../zh-CN/connections.ts";

export const enConnectionMessages = {
  "connections.catalog.add": "Add connection",
  "connections.catalog.connecting": "Connecting",
  "connections.catalog.device.detail": "Choose a text folder",
  "connections.catalog.device.failed":
    "Could not connect device files. Try again.",
  "connections.catalog.device.title": "Device files",
  "connections.catalog.failed": "Could not connect",
  "connections.catalog.google.detail":
    "Authorize Docs, Sheets, and Slides once",
  "connections.catalog.google.title": "Google Workspace",
  "connections.catalog.notion.detail": "Paste a page link",
  "connections.catalog.notion.title": "Notion",
  "connections.google.account.authorized": "Signed in as {account}",
  "connections.google.account.unauthorized": "No Google account authorized",
  "connections.google.authorize": "Authorize Google Drive",
  "connections.google.authorizeAndContinue": "Authorize and continue",
  "connections.google.cancelled":
    "Google authorization was cancelled. Your original message is still in the composer.",
  "connections.google.capability.create":
    "Create and edit documents in your Google Drive",
  "connections.google.capability.delete":
    "Move deleted items to the trash so they remain recoverable",
  "connections.google.capability.links":
    "Read Docs, Sheets, and Slides links you share with the Agent",
  "connections.google.capability.safeChanges":
    "Check versions and save the Diff and recovery point before writing",
  "connections.google.connectProject": "Connect to this project",
  "connections.google.continueAgent": "Continue Agent task",
  "connections.google.description":
    "Once authorized, the Agent can read, create, and safely edit Google Docs, Sheets, and Slides. Paste file links directly in chat; no repeated connector setup is needed.",
  "connections.google.failed": "Google Workspace authorization failed.",
  "connections.google.provider": "GOOGLE DRIVE",
  "connections.google.once": "Authorize once",
  "connections.google.privacy":
    "Google grants BoltPocket full Drive access so existing links and trash are supported. The Agent only sees files linked to or created in the current project. OAuth credentials stay on the server; the client accesses document content directly from Google without routing it through the OAuth service.",
  "connections.google.reauthorize": "Reauthorize Google Drive",
  "connections.google.why": "Why authorization is needed",
  "connections.notion.connect": "Connect",
  "connections.notion.connectAccessibility": "Connect Notion page",
  "connections.notion.failed": "Could not connect the Notion page.",
  "connections.notion.note":
    "The first connection opens the system browser for authorization. Once authorized, this project can read, create, and safely edit pages.",
  "connections.notion.pageLink": "Page link",
  "connections.notion.pageLinkAccessibility": "Notion page link",
  "connections.mcp.add": "Add MCP connection",
  "connections.mcp.addApiKeyHeader": "Add header",
  "connections.mcp.advanced": "Advanced settings",
  "connections.mcp.authNewToken": "Enter new token",
  "connections.mcp.authNone": "No authentication",
  "connections.mcp.apiKeyHeaderNumber": "API key header {number}",
  "connections.mcp.allowList": "Allowed tools (optional)",
  "connections.mcp.allowListDetail":
    "One exact tool name per line. Leave blank for the whole catalog; non-matching tools are blocked locally.",
  "connections.mcp.approvePatterns": "Extra approval rules (approveTools)",
  "connections.mcp.approvePatternsDetail":
    "One glob per line, such as search_* or server-id/tool. Writes never need to be listed because they always require approval.",
  "connections.mcp.cancel": "Cancel",
  "connections.mcp.connected": "MCP connected",
  "connections.mcp.connectedDetail":
    "Found {count} tools. The catalog will be loaded lazily when needed.",
  "connections.mcp.connectAndTest": "Connect and test",
  "connections.mcp.continueWithOAuth": "Continue and sign in",
  "connections.mcp.disableService": "Disable {name}",
  "connections.mcp.disabledValue": "Disabled",
  "connections.mcp.done": "Done",
  "connections.mcp.edit": "Edit MCP connection",
  "connections.mcp.enableService": "Enable {name}",
  "connections.mcp.enabled": "Enable this MCP service",
  "connections.mcp.enabledDetail":
    "When disabled, the Agent cannot see or connect to this MCP server.",
  "connections.mcp.enabledValue": "Enabled",
  "connections.mcp.headerName": "Header name",
  "connections.mcp.headerNameDetail":
    "Keep the default unless the provider specifically gives you another header name.",
  "connections.mcp.headerNameDuplicate": "Header names must be unique.",
  "connections.mcp.headerNameInvalid": "Enter a valid header name.",
  "connections.mcp.invalidResult": "The MCP server returned an invalid result.",
  "connections.mcp.loading": "Reading MCP connections",
  "connections.mcp.nameOptional":
    "Display name (optional; generated automatically)",
  "connections.mcp.nameOptionalDetail":
    "Leave blank to use a name generated from the MCP address.",
  "connections.mcp.newTokenDetail":
    "Stored only in your on-device password book.",
  "connections.mcp.noneChoiceDetail": "For public MCP services",
  "connections.mcp.oauthChoice": "OAuth browser sign-in (recommended)",
  "connections.mcp.oauthChoiceDetail":
    "Browser sign-in returns automatically and stays active",
  "connections.mcp.oauthReconnect": "Authorize again",
  "connections.mcp.policyAskAll": "Ask every time",
  "connections.mcp.policyAskAllDetail":
    "Every tool call shows an approval sheet first.",
  "connections.mcp.policyCustom": "Custom",
  "connections.mcp.policyCustomDetail":
    "Limit the catalog by tool name or add approval rules for selected tools.",
  "connections.mcp.policyStandard": "Standard protection",
  "connections.mcp.policyStandardDetail":
    "Use the server's read-only hints. Reads run directly; writes, deletions, and unknown effects still require approval.",
  "connections.mcp.remove": "Remove MCP connection",
  "connections.mcp.removeApiKeyHeader": "Remove this header",
  "connections.mcp.removeDetail":
    "This removes connection metadata and closes its session. The referenced password-vault token is retained and can still be managed in the vault.",
  "connections.mcp.removeFailed": "Could not remove MCP connection",
  "connections.mcp.removeFailedDetail": "Try again later.",
  "connections.mcp.saveFailed": "Could not save MCP connection",
  "connections.mcp.saveFailedDetail":
    "Make sure this is the MCP address supplied by the service. If it does not support OAuth, choose Token or No authentication.",
  "connections.mcp.savedNeedsAttention":
    "Connection saved, but it needs attention",
  "connections.mcp.savedNeedsAttentionDetail": "Test failed: {error}",
  "connections.mcp.savedDisabled": "Connection saved",
  "connections.mcp.savedDisabledDetail":
    "This MCP connection is disabled, so no network test was started.",
  "connections.mcp.savedToken": "Use saved token",
  "connections.mcp.savedTokenUnavailable":
    "A saved token is unavailable. Select the tokens again or enter new ones.",
  "connections.mcp.queryTokenDetail":
    "The provider requires this key as the {parameter} query parameter; the saved MCP URL never contains the key.",
  "connections.mcp.signIn": "Sign-in method",
  "connections.mcp.standardSafetyDetail":
    "Reads run directly; writes and deletions ask first.",
  "connections.mcp.testing": "Saving and discovering tools…",
  "connections.mcp.token": "Token",
  "connections.mcp.tokenChoice": "Token / API key",
  "connections.mcp.tokenChoiceDetail": "Use password book or enter once",
  "connections.mcp.tokenOriginMismatch":
    "The selected token's password-vault service URL must have the same origin as the MCP URL.",
  "connections.mcp.tokenRequired": "Enter a token.",
  "connections.mcp.tokenPlaceholder": "Paste token",
  "connections.mcp.toolPolicy": "Tool access",
  "connections.mcp.trustAnnotations": "Trust tool annotations",
  "connections.mcp.trustAnnotationsDetail":
    "Enable only for a server you trust. Explicit read-only tools may run directly; annotations can never bypass the allow-list or approveTools.",
  "connections.mcp.unavailable": "MCP connection unavailable",
  "connections.mcp.unavailableDetail":
    "This MCP connection no longer exists. Go back and try again.",
  "connections.mcp.regionUnavailableDetail":
    "Third-party MCP is not included in this distribution edition. Existing connections remain stored locally and can still be removed.",
  "connections.mcp.regionStoredDetail":
    "Stored locally but disabled in this edition · Tap to remove",
  "connections.mcp.url": "MCP URL",
  "connections.mcp.urlDetail":
    "Use the provider's Streamable HTTP endpoint, not its homepage. Public endpoints require HTTPS; local network endpoints may use HTTP. stdio, legacy SSE, and WebSocket are unsupported.",
  "connections.mcp.hub.add": "Add MCP service",
  "connections.mcp.hub.addCompact": "Add",
  "connections.mcp.hub.auth.none": "No sign-in",
  "connections.mcp.hub.auth.oauth": "OAuth sign-in",
  "connections.mcp.hub.auth.token": "Password-book token",
  "connections.mcp.hub.emptyDetail":
    "No global MCP services yet. Added services work in every project and quick conversation.",
  "connections.mcp.hub.globalServices": "Global services",
  "connections.mcp.hub.projectServices": "This project",
  "connections.mcp.hub.needsAssignment": "Needs project assignment",
  "connections.mcp.hub.unassignedBadge": "Unassigned",
  "connections.mcp.hub.unassignedDetail":
    "{host} · Open to assign this legacy connection to the current project",
} as const satisfies Record<ConnectionMessageKey, string>;
