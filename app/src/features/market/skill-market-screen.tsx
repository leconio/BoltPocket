import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SkillMarketCategory } from "@/application/ports/skill-market";
import { AppIcon } from "@/components/app-icon";
import { BottomSheet, IconButton, ScreenHeader } from "@/components/ui";
import { SkillMarketList } from "@/features/market/skill-market-list";
import {
  categoryMessage,
  marketCategories,
  selectMarketEntries,
  type SkillMarketSort,
} from "@/features/market/skill-market-view-model";
import { useSkillMarketCatalog } from "@/features/market/use-skill-market-catalog";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type ActiveSheet = "category" | "sort" | null;

const sortMessages = {
  featured: "market.sort.featured",
  name: "market.sort.name",
  newest: "market.sort.newest",
} as const;

export function SkillMarketScreen({
  active,
  onReturnHome,
}: {
  active: boolean;
  onReturnHome: () => void;
}) {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const { catalog, failed, loading, retry } = useSkillMarketCatalog(active);
  const [selectedCategory, setSelectedCategory] = useState<
    SkillMarketCategory | "all"
  >("all");
  const [sort, setSort] = useState<SkillMarketSort>("featured");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const largeText = fontScale >= 1.4;

  const visibleEntries = useMemo(
    () =>
      selectMarketEntries(catalog?.entries ?? [], {
        category: selectedCategory,
        locale,
        sort,
      }),
    [catalog?.entries, locale, selectedCategory, sort],
  );
  const categoryLabel = t(
    selectedCategory === "all"
      ? "market.category.all"
      : categoryMessage[selectedCategory],
  );

  const openDetail = (entryId: string) => {
    router.push(`/skill-market/${encodeURIComponent(entryId)}` as Href);
  };

  return (
    <View
      style={[
        styles.safeArea,
        { backgroundColor: palette.background, marginTop: insets.top },
      ]}
    >
      <ScreenHeader
        onBack={onReturnHome}
        palette={palette}
        right={
          <IconButton
            icon="search"
            label={t("market.search.open")}
            onPress={() => router.push("/skill-market/search")}
            palette={palette}
          />
        }
        title={t("market.list.title")}
      />

      <View
        style={[styles.controlBar, largeText && styles.controlBarLargeText]}
      >
        <FilterButton
          icon="apps-outline"
          label={t("market.filter.category")}
          largeText={largeText}
          onPress={() => setActiveSheet("category")}
          value={categoryLabel}
        />
        <FilterButton
          icon="options-outline"
          label={t("market.filter.sort")}
          largeText={largeText}
          onPress={() => setActiveSheet("sort")}
          value={t(sortMessages[sort])}
        />
      </View>

      <SkillMarketList
        entries={visibleEntries}
        failed={failed}
        loading={loading}
        onOpen={openDetail}
        onRetry={retry}
      />

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("market.filter.categoryTitle")}
        visible={activeSheet === "category"}
      >
        {(["all", ...marketCategories] as const).map((category) => (
          <OptionRow
            key={category}
            label={t(
              category === "all"
                ? "market.category.all"
                : categoryMessage[category],
            )}
            onPress={() => {
              setSelectedCategory(category);
              setActiveSheet(null);
            }}
            selected={selectedCategory === category}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("market.filter.sortTitle")}
        visible={activeSheet === "sort"}
      >
        {(["featured", "newest", "name"] as const).map((option) => (
          <OptionRow
            key={option}
            label={t(sortMessages[option])}
            onPress={() => {
              setSort(option);
              setActiveSheet(null);
            }}
            selected={sort === option}
          />
        ))}
      </BottomSheet>
    </View>
  );
}

function FilterButton({
  icon,
  label,
  largeText,
  onPress,
  value,
}: {
  icon: "apps-outline" | "options-outline";
  label: string;
  largeText: boolean;
  onPress: () => void;
  value: string;
}) {
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityLabel={`${label}，${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterButton,
        largeText && styles.filterButtonLargeText,
        { backgroundColor: palette.surface, borderColor: palette.border },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <AppIcon color={palette.textSecondary} name={icon} size={17} />
      <View style={styles.filterCopy}>
        <Text style={[styles.filterLabel, { color: palette.textTertiary }]}>
          {label}
        </Text>
        <Text
          numberOfLines={largeText ? 2 : 1}
          style={[styles.filterValue, { color: palette.text }]}
        >
          {value}
        </Text>
      </View>
      <AppIcon color={palette.textTertiary} name="chevron-down" size={14} />
    </Pressable>
  );
}

function OptionRow({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        { borderBottomColor: palette.border },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <Text
        style={[
          styles.optionLabel,
          { color: selected ? palette.accent : palette.text },
        ]}
      >
        {label}
      </Text>
      {selected ? (
        <AppIcon color={palette.accent} name="checkmark" size={19} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  controlBar: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  controlBarLargeText: { flexDirection: "column" },
  filterButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  filterButtonLargeText: { flex: 0, width: "100%" },
  filterCopy: { flex: 1, minWidth: 0 },
  filterLabel: { fontSize: 10.5, fontWeight: "600", lineHeight: 14 },
  filterValue: { fontSize: 13.5, fontWeight: "700", lineHeight: 18 },
  optionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.xs,
  },
  optionLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
});
