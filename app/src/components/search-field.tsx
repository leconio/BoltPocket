import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

export function SearchField({
  accessibilityLabel,
  accessibilityHint,
  autoFocus = false,
  clearAccessibilityLabel,
  onChangeText,
  onSubmitEditing,
  palette,
  placeholder,
  value,
}: {
  accessibilityLabel: string;
  accessibilityHint?: string;
  autoFocus?: boolean;
  clearAccessibilityLabel?: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  palette: AppPalette;
  placeholder: string;
  value: string;
}) {
  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <AppIcon color={palette.textSecondary} name="search" size={18} />
      <TextInput
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        clearButtonMode="while-editing"
        enablesReturnKeyAutomatically
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        returnKeyType="search"
        style={[styles.input, { color: palette.text }]}
        value={value}
      />
      {process.env.EXPO_OS !== "ios" && value && clearAccessibilityLabel ? (
        <Pressable
          accessibilityLabel={clearAccessibilityLabel}
          accessibilityRole="button"
          onPress={() => onChangeText("")}
          style={styles.clearButton}
        >
          <AppIcon color={palette.textSecondary} name="close" size={17} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 48,
    paddingLeft: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: 16,
    minHeight: 46,
    minWidth: 0,
    paddingRight: spacing.md,
  },
  clearButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
});
