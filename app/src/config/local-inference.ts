/** Selected at build time for the separately installed phone experiment. */
export const LOCAL_INFERENCE =
  process.env.EXPO_PUBLIC_BOLTPOCKET_LOCAL_ONLY !== "0";
export const LOCAL_PROVIDER_ID = "on-device-llama";
export const LOCAL_MODEL_ID = "Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL";
export const LOCAL_CONTEXT_WINDOW = 16384;
export const LOCAL_BASE_URL = "native://llama.cpp";

export const rejectServerFetch: typeof fetch = async () => {
  throw new Error("Server connections are disabled in this local build.");
};
