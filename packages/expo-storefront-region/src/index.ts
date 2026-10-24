import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

import {
  distributionRegionForStorefrontCountryCode,
  resolveStorefrontDistributionRegion,
  type StorefrontDistributionRegion,
} from "./policy.ts";

const STOREFRONT_CHANGED_EVENT = "onStorefrontChange";

type StorefrontChangedEvent = Readonly<{ countryCode?: unknown }>;
type StorefrontEvents = {
  [STOREFRONT_CHANGED_EVENT]: (event: StorefrontChangedEvent) => void;
};

declare class NativeStorefrontRegionModule extends NativeModule<StorefrontEvents> {
  currentCountryCode(): Promise<string | null>;
}

const nativeModule = requireOptionalNativeModule<NativeStorefrontRegionModule>(
  "BoltPocketStorefrontRegion",
);

export async function currentStorefrontDistributionRegion(): Promise<StorefrontDistributionRegion> {
  if (!nativeModule) return "global";
  return resolveStorefrontDistributionRegion(() =>
    nativeModule.currentCountryCode(),
  );
}

export function addStorefrontDistributionRegionListener(
  listener: (region: StorefrontDistributionRegion) => void,
): EventSubscription {
  if (!nativeModule) return { remove() {} };
  return nativeModule.addListener(STOREFRONT_CHANGED_EVENT, ({ countryCode }) =>
    listener(distributionRegionForStorefrontCountryCode(countryCode)),
  );
}

export {
  distributionRegionForStorefrontCountryCode,
  resolveStorefrontDistributionRegion,
  type StorefrontDistributionRegion,
} from "./policy.ts";
