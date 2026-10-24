import Ionicons from "@react-native-vector-icons/ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { useI18n } from "@/i18n/i18n-provider";
import type { AppPalette } from "@/theme/tokens";
import { spacing } from "@/theme/tokens";

export function SwipeToDelete({
  children,
  label,
  onDelete,
  palette,
}: {
  children: ReactNode;
  label: string;
  onDelete: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  const renderDeleteAction = (
    _progress: unknown,
    _translation: unknown,
    methods: SwipeableMethods,
  ) => (
    <Pressable
      accessibilityLabel={t("common.swipeDelete.accessibility", { label })}
      accessibilityRole="button"
      onPress={() => {
        methods.close();
        onDelete();
      }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.danger },
        pressed && { opacity: 0.78 },
      ]}
    >
      <Ionicons color={palette.accentText} name="trash-outline" size={18} />
      <Text style={[styles.actionText, { color: palette.accentText }]}>
        {t("common.swipeDelete.action")}
      </Text>
    </Pressable>
  );

  return (
    <ReanimatedSwipeable
      childrenContainerStyle={{ backgroundColor: palette.surface }}
      friction={1}
      overshootRight={false}
      renderRightActions={renderDeleteAction}
      rightThreshold={24}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    gap: spacing.xxs,
    justifyContent: "center",
    width: 80,
  },
  actionText: { fontSize: 12, fontWeight: "600" },
});
