import type { DistributionRegion } from "@/config/distribution";

export type RegionalNativeServiceCapability = "push-notifications" | "maps";

export type RegionalNativeServiceAvailability =
  | Readonly<{
      region: DistributionRegion;
      status: "available";
      provider: string;
    }>
  | Readonly<{
      region: DistributionRegion;
      status: "unavailable";
      provider: null;
      reason: "not-configured";
    }>;

export type PushNotificationRegistration = Readonly<{
  provider: string;
  token: string;
}>;

export interface PushNotificationServicePort {
  readonly availability: RegionalNativeServiceAvailability;
  register(signal?: AbortSignal): Promise<PushNotificationRegistration>;
  unregister(signal?: AbortSignal): Promise<void>;
}

export type MapCoordinateReferenceSystem = "wgs84" | "gcj02";

export type MapCoordinate = Readonly<{
  latitude: number;
  longitude: number;
  referenceSystem: MapCoordinateReferenceSystem;
}>;

export type MapOpenRequest =
  | Readonly<{
      kind: "place";
      coordinate: MapCoordinate;
      label?: string;
    }>
  | Readonly<{
      kind: "directions";
      destination: MapCoordinate;
      origin?: MapCoordinate;
      label?: string;
    }>;

export interface MapServicePort {
  readonly availability: RegionalNativeServiceAvailability;
  open(request: MapOpenRequest, signal?: AbortSignal): Promise<void>;
}

export type RegionalNativeServices = Readonly<{
  maps: MapServicePort;
  pushNotifications: PushNotificationServicePort;
}>;
