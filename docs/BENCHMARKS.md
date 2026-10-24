# Galaxy S25 measurements

Measured 2026-10-24 on a Galaxy S25 SM-S931U, Android 16, Adreno 830, 12 GB RAM class, charging. Driver: OpenCL 3.0 QUALCOMM build 0800.64.7, Compiler E031.47.18.50. All model results below use the **historical artifact** identified in [MODEL.md](MODEL.md), not the different current upstream file.

These are recorded engineering samples, not a controlled CPU/GPU speedup study or a broad mobile-agent evaluation. System file and compiled OpenCL-kernel caches were retained. A new process with no KV cache is not a clean-install or cold-storage test.

## Older 8K CPU and OpenCL runs

Both used six CPU threads, batch 256, max output 256, temperature 1, top-p 0.95, seed 42 and Thinking Off. CPU used Chinese and ubatch 64; GPU used English and ubatch 256. GPU logs reported 43/43 layers offloaded; tokenization, sampling and unsupported work can still use CPU.

| Metric | CPU | OpenCL |
|---|---:|---:|
| Decode median, three repeated prompts | 5.05 tok/s | 7.10 tok/s |
| Decode range | 4.99–5.06 | 7.05–7.17 |
| Output tokens per repeated answer | 99–102 | 59 |
| Model load | 6.32 s | 17.01 s |
| First request, no KV cache, about 5,070 input tokens: native TTFT | 332.27 s | 79.08 s |
| Same first request: submit to first JS text event, including load | 338.75 s | 96.34 s |
| Cached repeated requests: median native TTFT | 0.373 s | 0.220 s |
| Cached repeated requests: median submit to first JS text event | 0.461 s | 0.369 s |
| Sampled peak Android TOTAL PSS | 7.23 GiB | 6.68 GiB |

The observed decode ratio is about 1.41, but the prompts/language/microbatch differ. It is not a matched speedup. The different output lengths also prevent treating whole-answer duration as an equivalent-task comparison. Recording and longer tool tasks produced different decode rates.

## 16K fixed-prefix persistence

Same APK and configuration, two real process restarts; F16 KV, batch/ubatch 256, six threads. Fixed prefix: 7,417 tokens. Checkpoint file: 425,528,770 bytes (405.82 MiB), separate from RAM use.

| Case | Input / restored tokens | New prefill | Model initialization | Native TTFT |
|---|---:|---:|---:|---:|
| First construction, `Reply only: Ready.` | 7427 / 0 | 7427 | 46.61 s | 102.32 s |
| Restart, same prompt | 7427 / 7417 | 10 | 18.11 s | 8.59 s |
| Second restart, different question | 7439 / 7417 | 22 | 18.00 s | 8.47 s |

First initialization included a one-time full model hash. Disk restore took 3.80 s and 3.04 s on the two restart samples. Native TTFT excludes model initialization. The two-token `Ready.` answers establish cache correctness/latency, not representative decode speed. No CPU-plus-persistent-cache comparison was performed.

## Real cached project task

The task inspected the project, fetched live HKO observations/warnings/forecast, wrote a budget, totaled it with awk, wrote a short itinerary, then read both files. It requested separate short tool calls. The app was restarted before submission and restored 7,417 fixed-prefix tokens from disk in 3.394 s; only 312 of the first 7,729 input tokens needed new prefill. One later rollback restored the fixed snapshot again.

| Main task metric | Observed |
|---|---:|
| Page Processed time | 142 s |
| Model calls / tool invocations | 12 / 11 |
| Generated tokens, all calls | 455 |
| Model initialization | 16.69 s |
| First native TTFT, including restore, excluding model load | 11.63 s |
| Per-call decode median / range | 6.58 / 5.58–8.61 tok/s |
| Sampled peak TOTAL PSS / RSS | 6.67 / 6.57 GiB |
| End-of-task PSS snapshot | 5.85 GiB |

A followup audit used seven more model calls and 68 s of page Processed time in the same process. Its first call reused 9,829 memory tokens and added 152, with native TTFT 2.72 s. Its median per-call decode rate was 6.34 tok/s. Two turns combined used 19 model calls and about 210 s, excluding post-completion viewing time. Each turn's rates are mixed short tool/answer samples, not a repeated fixed-prompt benchmark.

**Content checks were not all successful.** Four CSV costs totaled HKD300 and were verified from the applied Diff. The first plan was vague. The audit added a start time and IFC Mall alternative, but the model still wrote `Obs time noted` instead of the exact timestamp and did not adequately separate general storm information from Hong Kong warnings. Those failures remain in the published acceptance summary. No manually corrected document is presented as model output.

Numerical rows and the task prompt are in [data/s25-20261024](../data/s25-20261024). Private device serials, PIDs, operation paths, credential helpers, recordings and system logs are not included. The original videos remain local; this source publication does not publish those recordings.

## Definitions and provenance

- Decode rate measures token generation after the first token, excluding prefill. It does not equal whole-agent throughput.
- Native TTFT is per generate call; model loading before that call is separate.
- The fixture's first-text event is JS/Pi bridge arrival. The current UI buffers final answers, so this is not first painted text.
- PSS/RSS are Android totals. Do not add Graphics PSS again or equate native VmRSS with total app RAM. Peaks are observed samples.
- Base llama.cpp: `1a24df163920a4744a95373d178d790b72a9bb2f`; applied Q2_K patch: `0c50cc146ac66155afdc219ef9004edafd5defb0`; the Adreno compatibility change is described in [OPENCL.md](../tools/bolt/OPENCL.md).
- Physical 16K cache/long-task build source fingerprint: `b9f7d3dce8ea7ff5955f64349338442d5e6b00abb21d9639a1062b8046305c46`; APK SHA-256 `47787daa1e4af042d3e5bd90629322145f021d0e12af70e2939e8654b7833fb3`.
- Public repository packaging/documentation changes are distinct from that frozen physical-device build. A later source build does not create new phone measurements.
