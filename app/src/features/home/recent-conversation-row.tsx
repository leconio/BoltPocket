import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import type { AppPalette } from "@/theme/tokens";
import { spacing } from "@/theme/tokens";
import { SwipeToDelete } from "@/components/swipe-to-delete";
import { useI18n } from "@/i18n/i18n-provider";

export function RecentConversationRow({
  detail,
  isLast = false,
  onPress,
  onDelete,
  palette,
  running = false,
  title,
}: {
  detail?: string;
  isLast?: boolean;
  onPress: () => void;
  onDelete?: () => void;
  palette: AppPalette;
  running?: boolean;
  title: string;
}) {
  const { t } = useI18n();
  const row = (
    <Pressable
      accessibilityLabel={t(
        running ? "home.conversations.openRunning" : "home.conversations.open",
        { title },
      )}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !isLast && { borderBottomColor: palette.border, borderBottomWidth: 1 },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.codeSurface }]}>
        <Ionicons
          color={palette.textSecondary}
          name="chatbubble-outline"
          size={17}
        />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {title}
        </Text>
        {detail ? (
          <Text
            numberOfLines={1}
            style={[styles.detail, { color: palette.textSecondary }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {running ? (
        <LoadingIndicator palette={palette} variant="inline" />
      ) : (
        <Ionicons
          color={palette.textTertiary}
          name="chevron-forward"
          size={17}
        />
      )}
    </Pressable>
  );
  return onDelete ? (
    <SwipeToDelete label={title} onDelete={onDelete} palette={palette}>
      {row}
    </SwipeToDelete>
  ) : (
    row
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  icon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, lineHeight: 17 },
});
