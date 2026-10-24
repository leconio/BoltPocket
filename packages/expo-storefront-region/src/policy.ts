export type StorefrontDistributionRegion = "global" | "china-mainland";

/**
 * Apple exposes StoreKit storefront country codes as ISO 3166-1 alpha-3.
 * Only an exact CHN value selects the Mainland China policy. Missing,
 * malformed, and unrecognized values deliberately fall back to global.
 */
export function distributionRegionForStorefrontCountryCode(
  value: unknown,
): StorefrontDistributionRegion {
  return value === "CHN" ? "china-mainland" : "global";
}

export async function resolveStorefrontDistributionRegion(
  readCountryCode: () => Promise<unknown>,
): Promise<StorefrontDistributionRegion> {
  try {
    return distributionRegionForStorefrontCountryCode(await readCountryCode());
  } catch {
    return "global";
  }
}
