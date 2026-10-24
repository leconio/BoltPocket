# Security

BoltPocket is experimental. The local model is not a security boundary or a reliable verifier of its own output. Project writes use the application's Diff, version-check and recovery workflow. The bounded project shell does not grant arbitrary Android OS shell access. SSH and other external connections require explicit user configuration.

Local inference does not make every tool offline: network tools can send requested information to configured hosts. The fixed-prefix checkpoint excludes user messages and tool results, but regular conversation persistence is separate and can contain user content. Exported logs or screenshots should be reviewed before sharing.

Do not publish live credentials or private data in an issue. Use [GitHub private vulnerability reporting](https://github.com/leconio/BoltPocket/security/advisories/new) if enabled. Otherwise open an issue requesting a private reporting channel without including exploit secrets or personal content.

No production security audit, cross-device isolation certification or complete connector security assessment is claimed for this release.
