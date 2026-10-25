# BoltPocket

The current local build keeps the Wield navigation and chat interface. Open
**Settings → Models** to download either local model, see progress, cancel/retry,
and choose the default. Downloaded models also appear in the existing conversation
model picker. No model weights are bundled.

| Model | Download size | Android default | iOS default |
|---|---:|---|---|
| Ternary Bonsai 2 · 2B · Q2_0 | 546,689,504 bytes | CPU | Metal |
| Nemotron 3.5 Bolt E4B · UD-Q4_K_XL | 5,060,482,240 bytes | OpenCL | Metal |

Downloads use pinned Hugging Face revisions and streaming native SHA-256 verification.
Only a verified file can be selected or loaded. Keep the app open while downloading;
cancelled or interrupted transfers restart from the beginning. Models use separate
files in app documents storage and are excluded from iCloud backup on iOS.

**The downloadable Nemotron file differs from the historical benchmark artifact
described below. Those measurements do not establish the new file's performance
or memory fit.** See [model identities and licenses](docs/MODEL.md).

Download acceptance on 2026-10-25: both full artifacts passed native verification
on the S25; default selection survived restart, and both appeared in the existing
conversation picker. Cancellation, retry, low storage and failed verification are
covered by controller tests. Android and iOS build from the same frozen source.
The signed iOS app was installed, and native verifier tests passed; the iPhone
was locked, so its on-device download flow remains unverified.

[中文说明](README.zh-CN.md) · [Limitations](docs/LIMITATIONS.md) · [Measured results](docs/BENCHMARKS.md) · [Build guide](docs/BUILD.md)

A mobile agent experiment with **on-device llama.cpp inference**, a React Native / Expo chat interface, and the Pi 0.83.0 session and tool loop. The chat and project code is adapted from the author's Wield application. BoltPocket has its own app identity, `dev.boltpocket.app`, and uses no Wield account or inference backend.

The working Android path uses OpenCL on a **Galaxy S25 / Adreno 830**, including a compatibility fix for a large Q4_K vocabulary projection. A fixed system/tool prefix can be saved privately and restored across process restarts. The execution panel shows loading, cache restoration, real prefill token progress, and tool activity.

**This is an experimental source release.** Physical-device results cover one S25 and one historical GGUF. iPhone installation, performance and persistent-cache restoration are not verified. Vulkan failed on the tested S25. The local model can omit instructions and incorrectly claim a task is complete. Read the [current limitations](docs/LIMITATIONS.md) before relying on the demo.

## S25 cached-prefill demo

Cached Hong Kong weather lookup in the project workspace on a Galaxy S25. The app restores **7,417 fixed-prefix tokens** and uses a Pi tool to fetch live HKO data, with model inference running on-device.

https://github.com/user-attachments/assets/bce2af11-77f7-47a2-a8bc-bb64620d8b3e

**27.4-second video:** the first 20 seconds play at **4×**; the final 7.4 seconds show the result at **1×**. Playback speed is labeled in the video. This weather demo is separate from the 142-second budget/itinerary task below; see [measured elapsed times and limitations](docs/BENCHMARKS.md).

## What was measured

| S25 sample | Observation |
|---|---|
| 8K OpenCL, three repeated English prompts | **7.10 tok/s** median decode |
| 16K cached multi-step project task | **6.58 tok/s** median across 12 model calls; **6.67 GiB** sampled peak total PSS |
| Fixed prefix restored after a real restart | **7,417 tokens**, about **406 MiB** of private disk storage |
| Same short prompt before/after persistence | Native TTFT **102.32 s → 8.59 s**; restarted model loading **18.11 s** is additional |

These are different workloads, not interchangeable benchmark runs. TTFT is not screen-first-paint latency. The older CPU and GPU samples also differ in language and microbatch size. [Conditions, numerical rows and definitions](docs/BENCHMARKS.md).

## Features and boundaries

- Reused chat, projects, session persistence, Pi tools and automatic-compaction code.
- In-process native inference; no separate llama HTTP server is required.
- Android OpenCL with a pinned, patched llama.cpp source tree.
- Exact-prefix memory reuse and Android private fixed-prefix checkpoints.
- Bounded project shell, project text changes with Diff/version checks/recovery, public HTTP reads, and retained SSH/MCP integration code.
- English is the default demo/UI language. The reused localization resources also include Simplified Chinese.

Inference is local. Weather requests, SSH, MCP and other user-configured connections use the network. The project shell is a scoped in-memory shell, not unrestricted access to Android's OS shell. Included connector code is not evidence that every connector works without additional setup.

## Build and run

Start with [the build guide](docs/BUILD.md). The Android build has been exercised on Linux/WSL with Node 24, pnpm 11, JDK 17, NDK 28 and CMake 3.22. The native CPU target requires ARM dotprod/i8mm support.

```sh
pnpm install --frozen-lockfile
pnpm check
# Then follow docs/BUILD.md to compile the native libraries and Android app.
```

Expo Go cannot load these custom native modules. Model weights, compiled native libraries, vendor GPU drivers, signing keys and APKs are not included in this repository.

### Model availability

The tested file was `NVIDIA-Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL.gguf`, 4,758,125,760 bytes, SHA-256 `b19f200ff71cc33668ad935a814ad466e7e16428fc260f1d2fbfdd49eab66a38`.

**The current upstream file with that name has a different size and hash.** The recorded historical revision could not be retrieved during publication checks on 2026-10-24. Do not assume a current download reproduces these measurements. See [model provenance, import instructions and the availability limitation](docs/MODEL.md).

## Repository layout

```text
app/                              Chat UI, project orchestration and native adapter
packages/agent-runtime/            Pi integration
packages/expo-bolt-runtime/        llama.cpp bridge and vendored native source
packages/project-shell*/           Bounded project shell and extra commands
packages/expo-ssh/                 Retained SSH implementation
patches/                          Dependency and backend patches
tools/bolt/                       Native build, cache checks and GPU notes
docs/                             Build, model, measurements and limitations
```

## License and attribution

Author-owned code is released under [MIT](LICENSE). Existing third-party licenses and copyright notices remain in place, including the Apache-2.0 adaptations in `packages/project-shell-extras`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Model weights are separate from the application's MIT license. The current [upstream model card](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF) identifies OpenMDW-1.1; review the upstream terms for the exact artifact you obtain. This repository does not redistribute weights or model training materials.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reporting: [SECURITY.md](SECURITY.md).
