import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";

import { useI18n } from "@/i18n/i18n-provider";

const LIVE_STATUS_TICK_MS = 1_000;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type NativeElapsedTextProps = TextInputProps & {
  text?: string;
};

/**
 * Keeps the visible clock outside React reconciliation. Reanimated updates the
 * fixed-size native text prop directly, so a one-second tick does not publish a
 * new React tree or resize the surrounding FlatList footer.
 */
export function LiveElapsedText({
  color,
  startedAt,
}: {
  color: string;
  startedAt: number | null;
}) {
  const { t } = useI18n();
  const elapsedLabel = useSharedValue("");
  const animatedProps = useAnimatedProps<NativeElapsedTextProps>(() => ({
    defaultValue: elapsedLabel.get(),
    text: elapsedLabel.get(),
  }));

  useFocusEffect(
    useCallback(() => {
      if (startedAt === null) {
        elapsedLabel.set("");
        return undefined;
      }
      const updateElapsedLabel = () => {
        const elapsedSeconds = Math.max(
          0,
          Math.floor((Date.now() - startedAt) / LIVE_STATUS_TICK_MS),
        );
        elapsedLabel.set(
          elapsedSeconds >= 1
            ? t("chat.content.status.elapsed", { count: elapsedSeconds })
            : "",
        );
      };
      updateElapsedLabel();
      const timer = setInterval(updateElapsedLabel, LIVE_STATUS_TICK_MS);
      return () => clearInterval(timer);
    }, [elapsedLabel, startedAt, t]),
  );

  return (
    <AnimatedTextInput
      accessibilityElementsHidden
      animatedProps={animatedProps}
      caretHidden
      contextMenuHidden
      defaultValue=""
      editable={false}
      focusable={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      showSoftInputOnFocus={false}
      style={[styles.elapsed, { color }]}
      underlineColorAndroid="transparent"
    />
  );
}

const styles = StyleSheet.create({
  elapsed: {
    borderWidth: 0,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    height: 18,
    includeFontPadding: false,
    lineHeight: 18,
    padding: 0,
    textAlign: "right",
    textAlignVertical: "center",
    width: 92,
  },
});
