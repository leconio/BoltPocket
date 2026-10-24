import assert from "node:assert/strict";
import test from "node:test";

import {
  createRegionalNativeServices,
  RegionalNativeServiceUnavailableError,
} from "./regional-native-services.ts";

for (const region of ["global", "china-mainland"] as const) {
  test(`${region} exposes stable unavailable regional service adapters`, async () => {
    const services = createRegionalNativeServices(region);

    assert.deepEqual(services.pushNotifications.availability, {
      provider: null,
      reason: "not-configured",
      region,
      status: "unavailable",
    });
    assert.deepEqual(services.maps.availability, {
      provider: null,
      reason: "not-configured",
      region,
      status: "unavailable",
    });
    await assert.rejects(
      services.pushNotifications.register(),
      (error: unknown) =>
        error instanceof RegionalNativeServiceUnavailableError &&
        error.capability === "push-notifications" &&
        error.region === region,
    );
    await assert.rejects(
      services.maps.open({
        kind: "place",
        coordinate: {
          latitude: 22.5431,
          longitude: 114.0579,
          referenceSystem: region === "china-mainland" ? "gcj02" : "wgs84",
        },
      }),
      (error: unknown) =>
        error instanceof RegionalNativeServiceUnavailableError &&
        error.capability === "maps" &&
        error.region === region,
    );
    await services.pushNotifications.unregister();
  });
}
