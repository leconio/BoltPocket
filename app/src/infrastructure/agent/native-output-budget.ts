export const DEFAULT_LOCAL_OUTPUT_TOKENS = 2048;
export const MAX_LOCAL_OUTPUT_TOKENS = 4096;

export function localOutputTokens(requested?: number) {
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || requested < 1)
  ) {
    throw new Error("The local output budget must be a positive integer.");
  }
  return Math.min(
    requested ?? DEFAULT_LOCAL_OUTPUT_TOKENS,
    MAX_LOCAL_OUTPUT_TOKENS,
  );
}
