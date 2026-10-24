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

The supported experimental path is local-only with the independent `dev.boltpocket.app` identity. Account and hosted-service entry points are removed from that path. Reused connector interfaces and their unit tests remain, but no first-party authentication/OAuth-broker deployment is supplied. Do not interpret those sources as a configured production service.

English is the default for the local demo. English and Simplified Chinese localization resources remain. Model output and user/tool content are not automatically translated.

Custom inference, SSH and QuickJS modules require a native build; Expo Go is insufficient. SSH and network connections remain user-configured. Physical evidence covers the specific S25/model/backend combination documented at the repository root.
