import type {
  MapServicePort,
  PushNotificationServicePort,
  RegionalNativeServiceAvailability,
  RegionalNativeServiceCapability,
  RegionalNativeServices,
} from "@/application/ports/regional-native-services";
import type { DistributionRegion } from "@/config/distribution";

export class RegionalNativeServiceUnavailableError extends Error {
  readonly code = "regional_native_service_unavailable";

  constructor(
    readonly capability: RegionalNativeServiceCapability,
    readonly region: DistributionRegion,
  ) {
    super(`${capability} is not configured for ${region}`);
    this.name = "RegionalNativeServiceUnavailableError";
  }
}

function unavailable(
  region: DistributionRegion,
): RegionalNativeServiceAvailability {
  return Object.freeze({
    provider: null,
    reason: "not-configured",
    region,
    status: "unavailable",
  });
}

function unavailableOperation(
  capability: RegionalNativeServiceCapability,
  region: DistributionRegion,
): () => Promise<never> {
  return async () => {
    throw new RegionalNativeServiceUnavailableError(capability, region);
  };
}

/**
 * The single composition point for regional native adapters. Vendor push and
 * map implementations replace these unavailable adapters without branching in
 * screens, stores, or domain code.
 */
export function createRegionalNativeServices(
  region: DistributionRegion,
): RegionalNativeServices {
  const pushNotifications: PushNotificationServicePort = Object.freeze({
    availability: unavailable(region),
    register: unavailableOperation("push-notifications", region),
    unregister: async () => undefined,
  });
  const maps: MapServicePort = Object.freeze({
    availability: unavailable(region),
    open: unavailableOperation("maps", region),
  });
  return Object.freeze({ maps, pushNotifications });
}
