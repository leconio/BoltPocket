import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { spacing, type AppPalette } from "@/theme/tokens";

export type LoadingIndicatorVariant =
  "content" | "inline" | "list" | "media" | "screen";

type LoadingIndicatorProps = {
  palette: AppPalette;
  accessibilityLabel?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  variant?: LoadingIndicatorVariant;
};

export function LoadingIndicator({
  accessibilityLabel,
  color,
  palette,
  style,
  variant = "content",
}: LoadingIndicatorProps) {
  const accessibility = accessibilityLabel
    ? {
        accessibilityLabel,
        accessibilityRole: "progressbar" as const,
        accessibilityState: { busy: true },
        accessible: true,
      }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants" as const,
      };

  return (
    <View {...accessibility} style={[styles.root, styles[variant], style]}>
      <ActivityIndicator color={color ?? palette.accent} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    width: "100%",
  },
  inline: {
    minHeight: 18,
    minWidth: 18,
  },
  list: {
    minHeight: 180,
    width: "100%",
  },
  media: {
    flex: 1,
    minHeight: 180,
    width: "100%",
  },
  screen: {
    flex: 1,
    width: "100%",
  },
});
