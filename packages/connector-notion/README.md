# Notion Connector

Repository-owned Notion connector for explicitly project-scoped pages. The
mobile adapter supplies authenticated Notion API and encrypted recovery ports.
The package never stores OAuth credentials and never discovers pages outside
the resources selected by the user.

Every write is bound to the shared patch approval, re-reads the page version,
creates a local encrypted recovery snapshot, applies the exact markdown patch,
and verifies the resulting page. Page creation records an absence recovery
intent before calling Notion. Trash and restore are recoverable provider
operations; permanent deletion is intentionally not part of this connector.
