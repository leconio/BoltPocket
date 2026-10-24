# Model artifact, availability and license

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

The iOS bridge expects `model.gguf` in the app's Documents directory. Normal signed iPhone installation and that import/runtime path remain unverified. Native source compilation does not require downloading a GGUF.
