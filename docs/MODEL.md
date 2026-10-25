# Model artifact, availability and license

## In-app downloads

The local build's existing **Settings → Models** page offers these pinned artifacts:

| Model | Repository | Revision | Bytes | SHA-256 |
|---|---|---|---:|---|
| Ternary Bonsai 2 · 2B · Q2_0 | prism-ml/Ternary-Bonsai-2-2B-gguf | 683f7be2629342a50987627b40881e54761a2430 | 546689504 | c2893fa6f951daee8b7263d5f49b455e57989ef56417a22125b03566dc560650 |
| Nemotron 3.5 Bolt E4B · UD-Q4_K_XL | unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF | b738967d6da3441a7d1c71fcec15e49e32e16ecd | 5060482240 | 84ff34f5834b929043f5ae74799e8d562d4056998f6a5923ceb44831e8ad84d6 |

Metadata checked on 2026-10-25 using the Hugging Face CLI. Bonsai uses Apache-2.0;
Nemotron uses OpenMDW-1.1. The settings page links each pinned source and license.
The text-only runtime downloads no vision projector.

Each artifact has its own file. A foreground transfer writes a partial file, then
native code checks its full 64-bit byte length and streams SHA-256 in 1 MiB chunks.
A same-volume rename and verification receipt make it available to the picker.
The whole model is never read into JavaScript memory. Failed/cancelled transfers
cannot become ready; retry removes the old partial file. Free storage must cover
the model plus a 256 MiB reserve.

Selecting a model updates the default for the next message. The existing
conversation picker can override it. Native inference jobs stay serialized; changing
models reloads the chosen artifact and resets incompatible runtime/prefix state.
Both models use the same existing Pi tool/session flow.

The Nemotron download is the newer artifact, **not the historical benchmark file**.
It needs separate runtime, quality, memory and performance acceptance. The older
manual `model.gguf` path below remains available for the separate benchmark route;
in-app downloads do not replace that file or clear existing conversations.

Model weights are not part of this repository or its MIT license. The current [Unsloth model card](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF) identifies **OpenMDW-1.1** and links its upstream terms. Review the terms applicable to the exact artifact you obtain. Publishing this application does not publish model training data, recipes or weights.

## Historical artifact used for the S25 results

| Field | Value |
|---|---|
| Repository | `unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF` |
| File | `NVIDIA-Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL.gguf` |
| Recorded historical revision | `2104306495395ad940bc1365381a09c59a1a1600` |
| Byte length | `4758125760` |
| SHA-256 | `b19f200ff71cc33668ad935a814ad466e7e16428fc260f1d2fbfdd49eab66a38` |

The running file's metadata describes a Gemma 4 E4B architecture with mixed quantization. Its metadata label is not a substitute for the filename, byte length and digest above.

## Publication-time availability check

On **2026-10-24**, requests for the recorded revision failed. A current metadata query succeeded, reporting:

| Current upstream field | Observed value |
|---|---|
| Revision | `f1d522f252c53d191aec80b9e0d64b5984047cf5` |
| Same-name file byte length | `5060482240` |
| Same-name file LFS SHA-256 | `84ff34f5834b929043f5ae74799e8d562d4056998f6a5923ceb44831e8ad84d6` |

This is a **different artifact**. It has not been benchmarked with this application, and neither correctness nor memory fit is established by the historical S25 measurements. There is currently no confirmed reachable upstream download for the exact benchmark artifact. Do not silently replace it and claim a reproduction.

To inspect upstream metadata without downloading weights:

```sh
hf models info unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF --format json
```

If you obtain a legitimate local copy of the historical artifact, verify its SHA-256 before using it to reproduce the historical numbers. Other GGUFs require their own compatibility and quality checks. A filename alone is insufficient.

## Import a separately obtained model

For Android, install and open the app once. It creates an application-owned placeholder at:

```text
/sdcard/Android/data/dev.boltpocket.app/files/model.gguf
```

Overwrite that existing file with your model:

```sh
sha256sum /path/to/model.gguf
adb push /path/to/model.gguf /sdcard/Android/data/dev.boltpocket.app/files/model.gguf
```

Do not pre-create the file as the shell user before the app has created its own file; Android external-storage ownership can otherwise prevent reads. Replacing the model changes cache identity and invalidates an incompatible fixed-prefix checkpoint.

The separate iOS benchmark bridge expects `model.gguf` in the app's Documents directory.
In-app downloads instead use the managed `Documents/models/` directory. The signed
download-feature build installed on the connected iPhone on 2026-10-25 and its
native verifier tests passed. Its on-device download UI remains unverified because
the phone was locked. Native source compilation does not require downloading a GGUF.
