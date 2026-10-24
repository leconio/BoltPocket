import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SearchField } from "@/components/search-field";
import { ScreenHeader } from "@/components/ui";
import { SkillMarketList } from "@/features/market/skill-market-list";
import { selectMarketEntries } from "@/features/market/skill-market-view-model";
import { useSkillMarketCatalog } from "@/features/market/use-skill-market-catalog";
import { useI18n } from "@/i18n/i18n-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

export function SkillMarketSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useAppPalette();
  const { locale, t } = useI18n();
  const { catalog, failed, loading, retry } = useSkillMarketCatalog(true);
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () =>
      selectMarketEntries(catalog?.entries ?? [], {
        category: "all",
        locale,
        query,
        sort: "featured",
      }),
    [catalog?.entries, locale, query],
  );

  return (
    <View
      style={[
        styles.safeArea,
        { backgroundColor: palette.background, paddingTop: insets.top },
      ]}
    >
      <ScreenHeader
        onBack={() => router.back()}
        palette={palette}
        title={t("market.search.title")}
      />
      <View style={styles.searchWrap}>
        <SearchField
          accessibilityHint={t("market.search.hint")}
          accessibilityLabel={t("market.search.placeholder")}
          autoFocus
          clearAccessibilityLabel={t("market.search.clear")}
          onChangeText={setQuery}
          palette={palette}
          placeholder={t("market.search.placeholder")}
          value={query}
        />
      </View>
      <SkillMarketList
        entries={entries}
        failed={failed}
        loading={loading}
        onOpen={(entryId) =>
          router.push(`/skill-market/${encodeURIComponent(entryId)}` as Href)
        }
        onRetry={retry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  searchWrap: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
