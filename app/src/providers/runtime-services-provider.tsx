import type { PropsWithChildren } from "react";
import { createContext, useContext, useLayoutEffect, useMemo } from "react";

import type { DistributionRegion } from "@/config/distribution";
import { LOCAL_INFERENCE, rejectServerFetch } from "@/config/local-inference";
import { createAppAccountDeletion } from "@/infrastructure/auth/app-account-deletion";
import { createAppAuthentication } from "@/infrastructure/auth/app-authentication";
import { createAppFirstPartyAuthenticatedFetch } from "@/infrastructure/auth/app-first-party-fetch";
import { createRegionalNativeServices } from "@/infrastructure/regional-services/regional-native-services";
import { createAppServices } from "@/providers/app-services";
import { createDistributionRuntimeLifetime } from "@/providers/distribution-runtime-lifetime";
import { registerDistributionTransitionHandler } from "@/providers/distribution-transition";

function createRuntimeServices(region: DistributionRegion) {
  const lifetime = createDistributionRuntimeLifetime();
  const externalFetch = lifetime.fetch;
  const authentication = createAppAuthentication(region, externalFetch);
  const firstPartyAuthenticatedFetch = LOCAL_INFERENCE
    ? rejectServerFetch
    : createAppFirstPartyAuthenticatedFetch(
        region,
        authentication,
        externalFetch,
      );
  const accountDeletion = createAppAccountDeletion({
    authentication,
    fetch: firstPartyAuthenticatedFetch,
    region,
  });
  return {
    accountDeletion,
    application: createAppServices({
      externalFetch,
      firstPartyAuthenticatedFetch,
      region,
    }),
    abortRegionOperations: lifetime.abort,
    authentication,
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
