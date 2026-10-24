# Google Docs Connector

Repository-owned Google Docs connector for project-scoped text resources. The
mobile adapter supplies authenticated Docs API and encrypted recovery ports.
The connector never stores OAuth tokens, never discovers documents outside its
explicit resource definitions, and binds every recoverable write to the shared
approval contract and the document revision returned by Google.

Documents that cannot be replaced without losing structure are registered as
read-only by the mobile adapter.

The package contains no Google login or HTTP implementation. Those remain
mobile ports so OAuth tokens, native SDKs, and encrypted recovery storage never
cross into the connector policy package.
