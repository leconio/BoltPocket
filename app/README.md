# BoltPocket mobile

Expo SDK 57 / React Native application. Follow the repository [build guide](../docs/BUILD.md), [model notes](../docs/MODEL.md) and [limitations](../docs/LIMITATIONS.md).

```text
src/app/            Expo Router routes
src/features/       Chat, projects and other reused feature UI
src/providers/      App-wide providers
src/domain/         Framework-independent models
src/application/    Use cases and repository-owned ports
src/infrastructure/ Pi/native inference, persistence and connectors
```

The standalone app uses the independent `dev.boltpocket.app` identity. Native
models run on the device, and configured third-party model APIs are called
directly. Account sign-in, hosted Skill Market, cloud-document authorization and
reporting implementations are removed. Local files, public Skill imports and
user-configured SSH/MCP remain available.

English is the default for the local demo. English and Simplified Chinese localization resources remain. Model output and user/tool content are not automatically translated.

Custom inference, SSH and QuickJS modules require a native build; Expo Go is insufficient. SSH and network connections remain user-configured. Physical evidence covers the specific S25/model/backend combination documented at the repository root.
