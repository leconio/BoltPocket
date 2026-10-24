# Publication validation — 2026-10-24

The independent public source was frozen and built locally in an isolated Linux/WSL workspace. This validation covers source checks and Android packaging. Physical-device performance is the separate historical B13 evidence in [BENCHMARKS.md](BENCHMARKS.md).

| Check | Result |
|---|---|
| Frozen-lockfile dependency installation | Passed |
| TypeScript checks | Passed |
| Pi/mobile focused tests | 82 passed |
| Host C++ prefix-cache integrity cases | 6 passed |
| Native OpenCL library compilation | Passed |
| Expo Android prebuild and ARM64 release assembly | Passed |
| APK identity | `dev.boltpocket.app`, version `0.1.0` (1) |
| Compiled Bolt library in APK | Present, ARM64 |
| Proprietary vendor `libOpenCL.so` in APK | Absent |
| Directory secret scan | Passed with ten individually reviewed fixture/identifier false positives in `.gitleaksignore` |
| Local documentation links and numerical rows | Checked |

Build run: `50551154b60e458cb52820217cffaec5`.

Build source commit: `088a84bbd3fa098e2f48e04161199b97dd39090c`.

Frozen content SHA-256: `b3cac0575e62d99aa8535fdf3dc11ef2fdf3c55d2889c33cf9682ed01396f4a9`.

Locally generated test APK: 93,184,778 bytes, SHA-256 `5cd28d21275b1050fa09fcece22c32cd77d534cbb1a84c40a075cc7c0d35eb53`. It is not distributed by this source publication.

The public application/native runtime source was compared with the frozen source export used for the earlier S25 recording; no runtime-code changes were introduced for publication. Publication adds documentation, license/metadata, a portable logical build configuration and sanitized measurement data. This validation document is added after the build and does not change executable code.

No new phone installation or benchmark is represented by the source build. iOS, other devices/models, cross-APK cache persistence, long-duration thermals/energy and complete connector/security coverage remain outside this validation. The focused suite is not an end-to-end test of every reused feature. The historical model availability gap and failed content checks remain documented.
