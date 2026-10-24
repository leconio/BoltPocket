import {
  addStorefrontDistributionRegionListener,
  currentStorefrontDistributionRegion,
} from "@boltpocket/expo-storefront-region";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import {
  activateDistributionRegion,
  compiledDistributionMode,
  type DistributionMode,
  type DistributionRegion,
} from "@/config/distribution";
import { prepareForDistributionTransition } from "@/providers/distribution-transition";
import { useAppPalette } from "@/theme/tokens";

const DistributionRegionContext = createContext<DistributionRegion | null>(
  null,
);

type ResolutionState = Readonly<{
  region: DistributionRegion | null;
  switching: boolean;
}>;

function initialResolution(mode: DistributionMode): ResolutionState {
  if (mode === "automatic") return { region: null, switching: false };
  activateDistributionRegion(mode);
  return { region: mode, switching: false };
}

export function DistributionRegionProvider({ children }: PropsWithChildren) {
  const palette = useAppPalette();
  const mode = useMemo(() => compiledDistributionMode(), []);
  const [resolution, setResolution] = useState(() => initialResolution(mode));
  const regionRef = useRef(resolution.region);

  useEffect(() => {
    if (mode !== "automatic") return;

    let mounted = true;
    let receivedUpdate = false;
    let transition = Promise.resolve();

    const apply = (next: DistributionRegion) => {
      transition = transition
        .then(async () => {
          if (!mounted || regionRef.current === next) return;
          if (regionRef.current !== null) {
            setResolution((current) => ({ ...current, switching: true }));
            await prepareForDistributionTransition().catch(() => undefined);
            if (!mounted) return;
          }
          activateDistributionRegion(next);
          regionRef.current = next;
          setResolution({ region: next, switching: false });
        })
        .catch(() => undefined);
    };

    const subscription = addStorefrontDistributionRegionListener((next) => {
      receivedUpdate = true;
      apply(next);
    });
    void currentStorefrontDistributionRegion().then((next) => {
      if (!receivedUpdate) apply(next);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [mode]);

  if (resolution.region === null || resolution.switching) {
    return (
      <View style={[styles.loading, { backgroundColor: palette.background }]}>
        <LoadingIndicator
          accessibilityLabel="Preparing BoltPocket"
          palette={palette}
          style={styles.indicator}
          variant="screen"
        />
      </View>
    );
  }

  return (
    <DistributionRegionContext.Provider value={resolution.region}>
      {children}
    </DistributionRegionContext.Provider>
  );
}

export function useDistributionRegion() {
  const region = useContext(DistributionRegionContext);
  if (!region) {
    throw new Error(
      "useDistributionRegion must be used inside DistributionRegionProvider",
    );
  }
  return region;
}

const styles = StyleSheet.create({
  indicator: {
    flex: 1,
  },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
