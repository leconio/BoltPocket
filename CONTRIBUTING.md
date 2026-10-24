# Contributing

Start with the [limitations](docs/LIMITATIONS.md) and [build guide](docs/BUILD.md). Keep the existing chat/Pi/session/tool architecture, the independent BoltPocket identity and the default local inference path. Preserve SSH and user-configured connections.

Run `pnpm install --frozen-lockfile` and `pnpm check` in Linux/WSL. The latter covers the focused TypeScript/Pi checks and host C++ cache-integrity cases; it is not a complete end-to-end test of every reused feature. For native Android changes, also follow the build guide and report whether a physical device was tested.

For performance or GPU correctness reports, include the device/OS/driver, model byte length and SHA-256, backend, context, batch/microbatch, cache origin and reused/new tokens, output length, loading and TTFT definitions, and Android TOTAL PSS/RSS. Remove credentials and conversation contents from diagnostics. Separate per-call model timing from full agent/tool time.

Keep third-party licenses, source pins and notices. Do not commit weights, vendor GPU libraries, APKs, device identifiers, personal recordings, signing material, credentials or private operational configuration. A change to numerical kernels needs correctness checks as well as a speed measurement.
