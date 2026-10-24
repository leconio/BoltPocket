import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { SkillMarketScreen } from "@/features/market/skill-market-screen";
import { HomeScreen } from "./home-screen";

export function HomePagerScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { market } = useLocalSearchParams<{ market?: string | string[] }>();
  const marketValue = Array.isArray(market) ? market[0] : market;
  const pager = useRef<ScrollView>(null);
  const internalRoutePage = useRef<0 | 1 | null>(null);
  const [page, setPage] = useState(marketValue === "1" ? 1 : 0);

  const moveTo = useCallback(
    (nextPage: 0 | 1, animated = true) => {
      setPage(nextPage);
      internalRoutePage.current = nextPage;
      router.setParams({ market: nextPage === 1 ? "1" : "0" });
      // iOS can ignore a scroll requested from a Pressable while the current
      // touch transaction still owns the horizontal ScrollView. Move on the
      // next frame so the shortcut and header back button are deterministic.
      requestAnimationFrame(() => {
        pager.current?.scrollTo({ animated, x: width * nextPage, y: 0 });
      });
    },
    [router, width],
  );

  useEffect(() => {
    const target = marketValue === "1" ? 1 : 0;
    if (internalRoutePage.current === target) {
      internalRoutePage.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      pager.current?.scrollTo({ animated: false, x: width * target, y: 0 });
      setPage(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [marketValue, width]);

  const settlePage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextPage = event.nativeEvent.contentOffset.x >= width / 2 ? 1 : 0;
    if (nextPage !== page) {
      setPage(nextPage);
      internalRoutePage.current = nextPage;
      router.setParams({ market: nextPage === 1 ? "1" : "0" });
    }
  };

  return (
    <ScrollView
      bounces={false}
      decelerationRate="fast"
      directionalLockEnabled
      horizontal
      nestedScrollEnabled
      onMomentumScrollEnd={settlePage}
      overScrollMode="never"
      pagingEnabled
      ref={pager}
      scrollEventThrottle={16}
      showsHorizontalScrollIndicator={false}
      style={styles.pager}
    >
      <View
        accessibilityElementsHidden={page !== 0}
        importantForAccessibility={page === 0 ? "auto" : "no-hide-descendants"}
        style={[styles.page, { width }]}
      >
        <HomeScreen />
      </View>
      <View
        accessibilityElementsHidden={page !== 1}
        importantForAccessibility={page === 1 ? "auto" : "no-hide-descendants"}
        style={[styles.page, { width }]}
      >
        <SkillMarketScreen active={page === 1} onReturnHome={() => moveTo(0)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
});
