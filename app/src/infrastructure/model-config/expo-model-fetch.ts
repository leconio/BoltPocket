/**
 * Web and Node fallback. Metro selects expo-model-fetch.native.ts on iOS and
 * Android, where incremental response bodies must use Expo's native fetch.
 */
export const expoModelFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init);
