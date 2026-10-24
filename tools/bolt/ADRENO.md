The active Android configuration in this worktree uses OpenCL; see [OPENCL.md](OPENCL.md). The Vulkan changes below are retained for comparison.

# Proprietary Adreno Vulkan compatibility

The vendored llama.cpp revision is `1a24df163920a4744a95373d178d790b72a9bb2f`.
`patches/adreno830.patch` records the nine-file Vulkan delta and is already applied
under `packages/expo-bolt-runtime/cpp/llama`; do not apply it twice. The patch applies
cleanly to that upstream revision. It extends fixes previously tested in another
model runtime, with fresh numerical verification for this model's mixed quantization.

The Android app requests full GPU offload by default. The verified target is a
Galaxy S25 SM-S931U, Adreno 830, Android 16, using the Qualcomm proprietary driver.
The iOS path continues to use Metal; physical iPhone verification is pending.

## Changes

- Replace narrow `unpack8()` integer-vector results with explicit 32-bit extraction
  in the Q2_K/Q4_K/Q5_K/Q6_K and signed Q8_0 paths. Keep Q4/Q5 scale arithmetic in
  32-bit unsigned lanes. Standalone mixed-value Q2/Q5/Q6 tests exposed relative
  errors above 1.0 before the additional fixes.
- Reduce private accumulator arrays for F16 and K-quant matvec kernels.
- Route rejected Q4_K single-column, IQ4_NL/BF16 multi-column and larger matvec
  specializations through the general GPU matrix kernel. These operations stay on
  Vulkan; this routing does not move them to the CPU.
- Use FP32 accumulation for the proprietary Qualcomm scalar matrix path while
  preserving the original weight storage types.
- Keep RMS_NORM and multiplying operations as separate GPU dispatches where the
  driver's multiplying RMS fusion is unreliable.
- Use a shared workgroup flag for partially populated masked attention tiles,
  with a closing barrier before a later tile can reset the flag. Account for
  its shared-memory allocation.
- Disable the mask-classification optimization on the proprietary driver. The
  regular Vulkan attention mask path remains enabled. A 169-query / 512-key
  case returned all zeros with the optimization enabled and passed the independent
  reference after disabling it.
- Default to fenced, one-dispatch submissions on the proprietary driver. The
  full model still loses the device with the upstream batched submission mode,
  despite passing standalone kernels. This compatibility schedule trades speed
  for stability and keeps model computation on Vulkan. The S25 profile uses a
  256-token microbatch.
- Count the current dispatch in the submission node limit so diagnostic
  serialization with a one-node limit actually isolates one GPU operation.
  Device-loss diagnostics include tensor shapes, types and strides.
- Skip the proprietary driver's unsafe device-fault query after device loss. The
  submission diagnostics remain available. Pipeline errors include specialization
  constants in the native log.

## Numerical checks

`gpu_probe.cpp` runs in the real Android application process and uploads seeded
inputs to the Vulkan backend. The reference uses independent FP64 dot products on
CPU-dequantized weights, RMS/multiply and causal softmax attention. Matrix relative
RMSE must be below 0.001, RMS below 0.00001, and attention below 0.005, with separate
absolute-error limits. BF16 general-matrix cases explicitly use
`reference_bf16_rhs: true` because upstream intentionally lowers the F32 activations
to BF16. This models the documented precision conversion without widening the
error budget.

A development probe can be launched with a URL-encoded JSON `probe` parameter, for
example `{"format":"q4_K","steps":1,"width":2560,"rows":128}` or
`{"op":"attention","dim":512,"nq":1,"nk":8192}`. The `short` probe runs a fixed
20-token math prompt and records its synthetic answer; ordinary conversation text
is excluded from metrics. Normal benchmarks and conversations use the original Pi
session and send action. Native probe entry points are for Android diagnostics.

Measure the checked-in default compatibility schedule without intent overrides.
The default proprietary-Adreno schedule serializes one dispatch per submission;
other drivers keep the upstream scheduling defaults. Intent extras
`boltVkSerial`, `boltVkMaxNodes`, `boltVkNoFusion`, `boltVkNoOptimize`, `boltVkNoAsync`,
`boltVkNoF16`, `boltVkNoMmvq`, `boltNoFlashAttention` and `boltUbatch` are diagnostic switches. Their results must not be
mixed with default-scheduler performance results. `boltGpuLayers` can override the
requested layer count for an explicit CPU/GPU comparison.

## Build dependencies used in verification

- Android NDK 28.2, CMake 3.22.1, Node 24, pnpm 11 and JDK 17.
- Vulkan-Headers revision `409c16be502e39fe70dd6fe2d9ad4842ef2c9a53`.
- Vulkan-Hpp revision `028a01abfce3f24e81506aa85b9c3c9daa89a0fd`.
- Ubuntu shaderc/glslc 2023.8, SPIRV-Tools 2023.6 and glslang 14.0.
- See the root README for the required dependency-path environment variables.

Use Android `dumpsys meminfo` for total PSS/RSS, including Graphics. The native
`/proc/self/status` RSS measurement alone does not describe the total GPU footprint.
The JS first-text metric measures bridge arrival; the retained Pi UI buffers final
answer text until completion, so it is not a first-screen-paint measurement.
