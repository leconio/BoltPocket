import type { PropsWithChildren } from "react";
import { createContext, useContext, useLayoutEffect, useMemo } from "react";

import type { DistributionRegion } from "@/config/distribution";
import { createRegionalNativeServices } from "@/infrastructure/regional-services/regional-native-services";
import { createAppServices } from "@/providers/app-services";
import { createDistributionRuntimeLifetime } from "@/providers/distribution-runtime-lifetime";
import { registerDistributionTransitionHandler } from "@/providers/distribution-transition";

function createRuntimeServices(region: DistributionRegion) {
  const lifetime = createDistributionRuntimeLifetime();
  const externalFetch = lifetime.fetch;
  return {
    application: createAppServices({
      externalFetch,
      region,
    }),
    abortRegionOperations: lifetime.abort,
    regionalNative: createRegionalNativeServices(region),
    region,
  };
}

export type RuntimeServices = ReturnType<typeof createRuntimeServices>;

const RuntimeServicesContext = createContext<RuntimeServices | null>(null);

export function RuntimeServicesProvider({
  children,
  region,
}: PropsWithChildren<{ region: DistributionRegion }>) {
  const services = useMemo(() => createRuntimeServices(region), [region]);
  useLayoutEffect(() => {
    const unregister = registerDistributionTransitionHandler(async () => {
      services.abortRegionOperations();
    });
    return () => {
      unregister();
      services.abortRegionOperations();
    };
  }, [services]);
  return (
    <RuntimeServicesContext.Provider value={services}>
      {children}
    </RuntimeServicesContext.Provider>
  );
}

export function useRuntimeServices() {
  const services = useContext(RuntimeServicesContext);
  if (!services) {
    throw new Error(
      "useRuntimeServices must be used inside RuntimeServicesProvider",
    );
  }
  return services;
}

export function useAppServices() {
  return useRuntimeServices().application;
}
