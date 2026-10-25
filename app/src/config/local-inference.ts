/** Native model identifiers and benchmark defaults. */
export const LOCAL_PROVIDER_ID = "on-device-llama";
const bonsai = process.env.EXPO_PUBLIC_BOLTPOCKET_MODEL_PROFILE === "bonsai2";
export const LOCAL_MODEL_ID = bonsai
  ? "Ternary-Bonsai-2-2B-Q2_0"
  : "Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL";
export const LOCAL_MODEL_NAME = bonsai
  ? "Ternary Bonsai 2 · 2B"
  : "Nemotron 3.5 Bolt E4B";
export const LOCAL_MODEL_PROFILE_ID = bonsai
  ? "bonsai2-local"
  : "bolt-e4b-local";
const gpuLayers = Number(process.env.EXPO_PUBLIC_BOLTPOCKET_GPU_LAYERS);
export const LOCAL_GPU_LAYERS =
  Number.isInteger(gpuLayers) && gpuLayers >= 0 ? gpuLayers : bonsai ? 0 : 99;
export const LOCAL_SAMPLING = bonsai
  ? {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      presence_penalty: 1.5,
      repeat_last_n: 64,
    }
  : undefined;
export const LOCAL_CONTEXT_WINDOW = 16384;
export const LOCAL_BASE_URL = "native://llama.cpp";
