import Ionicons from "@react-native-vector-icons/ionicons";
import { type ReactNode, useRef } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { useI18n } from "@/i18n/i18n-provider";
import type { AppPalette } from "@/theme/tokens";
import { spacing } from "@/theme/tokens";

export function SwipeToUpdate({
  children,
  label,
  onUpdate,
  palette,
}: {
  children: ReactNode;
  label: string;
  onUpdate: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  const swipeable = useRef<SwipeableMethods>(null);
  const renderAction = (
    _progress: unknown,
    _translation: unknown,
    methods: SwipeableMethods,
  ) => (
    <Pressable
      accessibilityLabel={t("library.screen.skill.updateAccessibility", {
        name: label,
      })}
      accessibilityRole="button"
      onPress={() => {
        methods.close();
        onUpdate();
      }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.accent },
        pressed && { opacity: 0.78 },
      ]}
    >
      <Ionicons color={palette.accentText} name="refresh" size={18} />
      <Text style={[styles.actionText, { color: palette.accentText }]}>
        {t("library.screen.skill.update")}
      </Text>
    </Pressable>
  );

  return (
    <ReanimatedSwipeable
      childrenContainerStyle={{ backgroundColor: palette.surface }}
      friction={1}
      onSwipeableOpen={() => {
        swipeable.current?.close();
        onUpdate();
      }}
      overshootRight={false}
      ref={swipeable}
      renderRightActions={renderAction}
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
