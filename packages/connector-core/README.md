# Connector Core

Repository-owned contracts for project-scoped connectors. A connector exposes
generic text resources rather than platform-specific document or SSH concepts.
Reads are safe by default. Every text write must bind an explicit approval to
the exact connector, resource, base version, proposal, and patch hash; the
connector then rechecks the version, creates a recovery point, and writes. Its
descriptor reports whether the provider offers atomic or recoverable writes.
The registry validates every listed or searched resource against the connector
that returned it and the requested project before exposing it to an Agent or a
write workflow.
