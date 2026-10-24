# @boltpocket/mcp-client

Repository-owned MCP client boundary for BoltPocket.

It intentionally exposes one stable host proxy instead of registering every
remote MCP tool with the model. Server connections and tool catalogs are loaded
only when a catalog or protocol operation is requested. The transport is the
official MIT-licensed MCP TypeScript SDK's Streamable HTTP client.

The one proxy supports tools, prompts, resources, resource templates,
completion, ping, modern protocol negotiation, sessionful Streamable HTTP,
server-sent list-change invalidation, cancellation, bounded reconnect, and
broker-driven OAuth scope step-up.

Security constraints:

- HTTPS is required, except unauthenticated loopback development endpoints.
- Credentials are resolved for each request and are never included in tool
  catalog or proxy results.
- Redirects are not followed while credentials may be attached.
- A local allow-list is authoritative. Writes, unknown/destructive effects,
  and `approveTools` glob matches require an exact host approval. Remote
  annotations lower risk only for connections that explicitly trust them.
- Session grants are available only for explicitly read-only tools. Writes,
  destructive tools, and unknown effects always require one-shot approval.
- Approval binds deterministic arguments and is followed by a fresh tool
  definition check. MCP has no generic rollback contract, so a provider
  without prepare/version/recover semantics is identified as non-recoverable.
- Tool schemas and results are bounded before entering model context.
- Mobile supports Streamable HTTP only; the deferred user-operated stdio relay
  is documented in ADR 0019 and is not part of the current release.

See `THIRD_PARTY_NOTICES.md` for the upstream dependency.
