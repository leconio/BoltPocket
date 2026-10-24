# Third-party notices

The root MIT license covers the author's original contributions. It does not replace licenses for vendored code, dependencies, fonts, assets or model weights. Retain the notices within each subtree when redistributing it.

| Component | License / notice |
|---|---|
| Author-owned Wield chat/project/Pi integration adapted for BoltPocket | Root MIT; existing Wield copyright notices retained |
| Expo application template and Expo / React Native dependencies | Existing [app/LICENSE](app/LICENSE) and installed package notices |
| Pi 0.83.0 (`@earendil-works/pi-*`) | MIT, upstream package license; [project](https://github.com/earendil-works/pi) |
| Vendored llama.cpp / ggml | [MIT](packages/expo-bolt-runtime/cpp/llama/LICENSE); nested vendors retain their own notices |
| Qualcomm Q2_K changes and local Adreno compatibility work | Applied source/patches; see [OpenCL provenance](tools/bolt/OPENCL.md) and upstream notices |
| QuickJS and its source-distribution provenance | [Module MIT](packages/expo-quickjs/LICENSE), [third-party notice](packages/expo-quickjs/THIRD_PARTY_NOTICES.md), source headers and vendor manifest |
| just-bash integration | [Notice](packages/project-shell/THIRD_PARTY_NOTICES.md); upstream Apache-2.0 |
| project-shell-extras adaptations | [Apache-2.0](packages/project-shell-extras/LICENSE) and [NOTICE](packages/project-shell-extras/NOTICE) |
| libssh2, OpenSSL and NMSSH | [SSH notice](packages/expo-ssh/THIRD_PARTY_NOTICES.md) and pinned source build scripts |
| H5 runtime, fonts and resource catalog | [App notice](app/THIRD_PARTY_NOTICES.md) and pinned resource registries |
| MCP client | [Module notice](packages/mcp-client/THIRD_PARTY_NOTICES.md) |

The application uses the system vendor OpenCL library at runtime. That driver is not redistributed here. Model weights are also not redistributed. Consult the [exact model's upstream terms](docs/MODEL.md) separately.
