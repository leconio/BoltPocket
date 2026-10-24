# Current limitations

Evidence cutoff: **2026-10-24**. This repository publishes an experimental application, not a general mobile-model compatibility claim.

## Device and backend coverage

| Route | Evidence |
|---|---|
| Galaxy S25 SM-S931U, Android 16, Adreno 830, OpenCL | Successful inference, project tools, recordings and cache restoration with the historical tested GGUF |
| Same S25, CPU | Older baseline; different language/microbatch from the GPU benchmark |
| Same S25, Vulkan | Driver/library failures including device loss; no accepted Vulkan performance result |
| iPhone / Metal | Bridge and build sources included; physical installation, performance and cache restoration not verified |
| Other Android devices, GPU drivers or GGUFs | Not validated by these results |

The working OpenCL path includes Qualcomm Q2_K changes and a local Adreno 830 large-M Q4_K conversion/dispatch workaround. The original optimized route produced wrong logits. The generic flat projection remains a GPU operation. This does not establish numerical correctness for all kernels/shapes or eliminate possible CPU fallback. No system driver replacement or root is part of the working recipe. See [OPENCL.md](../tools/bolt/OPENCL.md).

## Model availability and resource cost

The tested 4,758,125,760-byte GGUF is about 4.43 GiB on disk. The current upstream same-name file has a different size and hash, and the recorded historical revision was not retrievable during publication checks. The newer artifact has not been substituted into these benchmarks. This is a reproducibility gap; see [MODEL.md](MODEL.md).

The recorded 16K long task reached **6.67 GiB total app PSS**, including UI, model, KV, computation and graphics allocations. Lower-memory phones, sustained thermals, background eviction and battery/energy efficiency are not established. Tests were performed while charging. A sampled peak can miss a short spike.

## Prefix persistence is limited

- Only the fixed system/tool prefix before the first user message is saved in the private checkpoint. It is not a complete conversation cache, chat-history export, or retrieval memory.
- Weight loading, new user text, conversation continuations and tool results still cost time. Restoring KV is disk I/O, not zero-cost startup.
- The observed 7,417-token checkpoint is about 406 MiB of **disk storage**. Its state occupies memory when restored. Storage and RAM must not be conflated.
- At most two committed checkpoints, each no larger than 512 MiB, are retained. Different prompts/configurations may evict or invalidate them.
- Identity includes model/native/backend/configuration/system/prefix information. A mismatch, corrupt file, failed write or oversized state falls back to ordinary prefill. Clearing app data or uninstalling removes the cache.
- Same-APK process restarts were physically verified. Compatible UI-only updates are supported by the cache identity design, but cross-APK upgrade persistence was not validated in these recordings. iOS persistence is not verified.
- Sliding-window KV rollback may need a disk snapshot again. An apparent matching text prefix does not imply all its KV entries remain resident.

## Context, output and UI

The current project-workspace configuration is **16,384 context tokens**, **256 output tokens per model call**, F16 KV, six CPU threads, temperature 1, top-p 0.95, seed 42 and **Thinking Off**. These are application settings, not the model's advertised maximum capacity. Long output or a large tool-call JSON can hit the 256-token cap.

The full system/tool catalog consumes roughly 7.4K tokens before useful user/tool content. Pi's auto-compaction code is retained, but compaction is not unlimited or guaranteed lossless memory. The published multi-step recordings did not cross the compaction boundary and do not verify post-compaction correctness.

The fixed-height panel shows execution stages, tool activity and token counters. It does not expose a reasoning stream. A prefill percentage counts newly submitted prompt tokens, excluding reused tokens; it is not an estimated time-to-completion bar.

The reused chat logic buffers the final answer until completion. Native TTFT and the first displayable-text event at the JS bridge are different from the first painted answer on screen. Agent elapsed time includes multiple model calls and tools.

## Agent and tool reliability

The weather/project task executed tools and applied text changes, but its content acceptance was incomplete. Budget rows summed to HKD300. After an additional audit turn, the plan gained concrete stops and an IFC Mall rain alternative, yet it still said **`Obs time noted`** instead of giving the observation timestamp. It also did not adequately distinguish general storm news from a Hong Kong warning. The model's own completion claim was not accepted as proof of correctness. First-pass and followup metrics are kept separate.

The project `bash` tool runs a bounded virtual project shell. Commands such as Python/Node are unavailable unless explicitly supplied by an adapter; this is not a general Android terminal. Writes go through project text changes, version checks and recovery. A successful tool invocation or applied Diff does not prove the resulting document is factually correct.

SSH, MCP, browser, device and connector code is retained. Only the described local-project/public-weather workflow is established by this demo. External connections need user configuration/credentials, may send data over the network, and were not comprehensively revalidated against the local model. Legacy first-party connector interfaces/tests remain as scaffolding; hosted account/OAuth-broker services and production deployment configuration are not supplied. Disabling local-only mode is not a supported hosted-service setup.

The tested local model path is text-only. Voice, vision and media-generation UI/code elsewhere in the reused application do not establish those capabilities for this model.

## Distribution and measurement scope

Build tools and SDKs are required. Expo Go is insufficient. Weights, system vendor OpenCL libraries, signing credentials and production APKs are not shipped. Build scripts currently target ARM64 with dotprod/i8mm and were exercised in Linux/WSL; generic Windows-native/macOS Android builds and older devices are not established.

The focused checks do not cover every reused connector or screen. No production security audit, app-store acceptance, long-duration performance test or complete agent benchmark suite is claimed. The [benchmark document](BENCHMARKS.md) distinguishes older 8K runs, 16K cache tests and the real multi-call task.
