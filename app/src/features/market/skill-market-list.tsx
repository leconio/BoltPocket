import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { SkillMarketSummary } from "@/application/ports/skill-market";
import { AppIcon } from "@/components/app-icon";
import { categoryMessage } from "@/features/market/skill-market-view-model";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

export function SkillMarketList({
  entries,
  failed,
  loading,
  onOpen,
  onRetry,
}: {
  entries: readonly SkillMarketSummary[];
  failed: boolean;
  loading: boolean;
  onOpen: (entryId: string) => void;
  onRetry: () => void;
}) {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.4;
  const localized = (value: Readonly<{ en: string; zhCN: string }>) =>
    locale === "zh-CN" ? value.zhCN : value.en;

  if (loading) return <MarketLoading />;
  if (failed) {
    return (
      <MarketMessage
        action={t("market.error.retry")}
        detail={t("market.error.detail")}
        icon="cloud-offline-outline"
        onAction={onRetry}
        title={t("market.error.title")}
      />
    );
  }
  return (
    <FlatList
      contentContainerStyle={
        entries.length ? styles.listContent : styles.emptyContent
      }
      data={entries}
      keyboardDismissMode={
        process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
      }
      keyboardShouldPersistTaps="handled"
      keyExtractor={(entry) => entry.id}
      ListEmptyComponent={
        <MarketMessage
          detail={t("market.empty.detail")}
          icon="search"
          title={t("market.empty.title")}
        />
      }
      ListHeaderComponent={
        <Text style={[styles.count, { color: palette.textSecondary }]}>
          {t("market.list.count", { count: entries.length })}
        </Text>
      }
      renderItem={({ item, index }) => (
        <MarketRow
          entry={item}
          isLast={index === entries.length - 1}
          largeText={largeText}
          localized={localized}
          onPress={() => onOpen(item.id)}
        />
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}

function MarketRow({
  entry,
  isLast,
  largeText,
  localized,
  onPress,
}: {
  entry: SkillMarketSummary;
  isLast: boolean;
  largeText: boolean;
  localized: (value: Readonly<{ en: string; zhCN: string }>) => string;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityLabel={localized(entry.name)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        largeText && styles.rowLargeText,
        {
          backgroundColor: pressed ? palette.codeSurface : palette.surface,
          borderBottomColor: palette.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          largeText && styles.rowIconLargeText,
          { backgroundColor: palette.accentSoft },
        ]}
      >
        <AppIcon
          color={palette.accent}
          name="extension-puzzle-outline"
          size={20}
        />
      </View>
      <View style={styles.rowCopy}>
        <View
          style={[
            styles.rowTitleLine,
            largeText && styles.rowTitleLineLargeText,
          ]}
        >
          <Text
            numberOfLines={largeText ? 2 : 1}
            style={[styles.rowTitle, { color: palette.text }]}
          >
            {localized(entry.name)}
          </Text>
          {entry.verified ? (
            <View style={styles.verified}>
              <AppIcon
                color={palette.accent}
                name="checkmark-circle"
                size={14}
              />
              <Text style={[styles.verifiedText, { color: palette.accent }]}>
                {t("market.badge.verified")}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={largeText ? 3 : 2}
          style={[styles.rowDescription, { color: palette.textSecondary }]}
        >
          {localized(entry.description)}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowMetaText, { color: palette.textTertiary }]}>
            {localized(entry.provider)}
          </Text>
          <View
            style={[styles.dot, { backgroundColor: palette.textTertiary }]}
          />
          <Text style={[styles.rowMetaText, { color: palette.textTertiary }]}>
            {t(categoryMessage[entry.category])}
          </Text>
          <View
            style={[styles.dot, { backgroundColor: palette.textTertiary }]}
          />
          <Text style={[styles.rowMetaText, { color: palette.textTertiary }]}>
            {t(
              entry.risk === "read"
                ? "market.risk.read"
                : "market.risk.propose",
            )}
          </Text>
        </View>
      </View>
      <View style={largeText && styles.rowChevronLargeText}>
        <AppIcon
          color={palette.textTertiary}
          name="chevron-forward"
          size={17}
        />
      </View>
    </Pressable>
  );
}

function MarketLoading() {
  const { t } = useI18n();
  const palette = useAppPalette();
  return (
    <View
      accessibilityLabel={t("market.list.loading")}
      style={styles.loadingWrap}
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          style={[styles.loadingRow, { borderBottomColor: palette.border }]}
        >
          <View
            style={[
              styles.loadingIcon,
              { backgroundColor: palette.codeSurface },
            ]}
          />
          <View style={styles.loadingCopy}>
            <View
              style={[
                styles.loadingTitle,
                { backgroundColor: palette.codeSurface },
              ]}
            />
            <View
              style={[
                styles.loadingLine,
                { backgroundColor: palette.codeSurface },
              ]}
            />
            <View
              style={[
                styles.loadingLineShort,
                { backgroundColor: palette.codeSurface },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function MarketMessage({
  action,
  detail,
  icon,
  onAction,
  title,
}: {
  action?: string;
  detail: string;
  icon: "cloud-offline-outline" | "search";
  onAction?: () => void;
  title: string;
}) {
  const palette = useAppPalette();
  return (
    <View style={styles.message}>
      <View
        style={[styles.messageIcon, { backgroundColor: palette.codeSurface }]}
      >
        <AppIcon color={palette.textSecondary} name={icon} size={24} />
      </View>
      <Text style={[styles.messageTitle, { color: palette.text }]}>
        {title}
      </Text>
      <Text style={[styles.messageDetail, { color: palette.textSecondary }]}>
        {detail}
      </Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.messageAction,
            { borderColor: palette.borderStrong },
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <Text style={[styles.messageActionText, { color: palette.text }]}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    backgroundColor: "transparent",
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  emptyContent: { flexGrow: 1, paddingHorizontal: spacing.md },
  count: { fontSize: 12, fontWeight: "600", paddingBottom: spacing.xs },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 116,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowLargeText: { alignItems: "flex-start", paddingVertical: spacing.md },
  rowIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rowIconLargeText: { marginTop: spacing.xxs },
  rowCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  rowTitleLineLargeText: { alignItems: "flex-start", flexDirection: "column" },
  rowTitle: { flexShrink: 1, fontSize: 16, fontWeight: "700" },
  verified: { alignItems: "center", flexDirection: "row", gap: 2 },
  verifiedText: { fontSize: 10.5, fontWeight: "700" },
  rowDescription: { fontSize: 13.5, lineHeight: 19 },
  rowMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  rowMetaText: { fontSize: 11.5, lineHeight: 16 },
  rowChevronLargeText: { marginTop: spacing.sm },
  dot: { borderRadius: 2, height: 3, width: 3 },
  loadingWrap: { marginHorizontal: spacing.md },
  loadingRow: {
    alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 108,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingIcon: { borderRadius: radii.sm, height: 40, width: 40 },
  loadingCopy: { flex: 1, gap: spacing.xs, paddingTop: 2 },
  loadingTitle: { borderRadius: 4, height: 15, width: "46%" },
  loadingLine: { borderRadius: 4, height: 11, width: "92%" },
  loadingLineShort: { borderRadius: 4, height: 11, width: "66%" },
  message: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  messageIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 52,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: 52,
  },
  messageTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  messageDetail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
    maxWidth: 300,
    textAlign: "center",
  },
  messageAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  messageActionText: { fontSize: 14, fontWeight: "600" },
});
