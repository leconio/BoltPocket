# Google Workspace Connector Core

Shared policy engine for Google Workspace resources represented as bounded
text. Provider packages supply their own URL parser, canonical text format,
API adapter, resource kind, and display language.

The package owns project scope, deterministic patch/approval binding, version
rechecks, recovery-before-write, creation intent enforcement, and result
verification. It contains no OAuth, HTTP, Expo, or token storage code.
