# Local Text Connector

A React Native-safe connector for scoped plain-text resources. Platform code
supplies a storage port (for example Android SAF or iOS security-scoped URLs).
The connector owns version checks, approval replay protection, recovery-point
creation, and the final verified replacement sequence. A storage port declares
whether its provider can guarantee an atomic replacement or a recoverable one.
