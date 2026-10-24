import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { radii, spacing, useAppPalette } from "@/theme/tokens";

export type LabeledTextFieldProps = {
  action?: Readonly<{ hint?: string; label: string; onPress: () => void }>;
  emphasized?: boolean;
  error?: string;
  hint?: string;
  label: string;
} & ComponentProps<typeof TextInput>;

export function LabeledTextField({
  accessibilityHint,
  accessibilityLabel,
  action,
  emphasized = false,
  error,
  hint,
  label,
  multiline,
  style,
  ...props
}: LabeledTextFieldProps) {
  const palette = useAppPalette();
  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        {action ? (
          <Pressable
            accessibilityHint={action.hint}
            accessibilityLabel={action.label}
            accessibilityRole="button"
            hitSlop={4}
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.action,
              pressed && { opacity: 0.58 },
            ]}
          >
            <Text style={[styles.actionText, { color: palette.accent }]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
      <TextInput
        {...props}
        accessibilityHint={accessibilityHint ?? hint}
        accessibilityLabel={accessibilityLabel ?? label}
        multiline={multiline}
        placeholderTextColor={palette.textTertiary}
        style={[
          styles.input,
          multiline && styles.multiline,
          emphasized && styles.emphasized,
          {
            backgroundColor: palette.surface,
            borderColor: error
              ? palette.danger
              : emphasized
                ? palette.borderStrong
                : palette.border,
            color: palette.text,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          selectable
          style={[styles.error, { color: palette.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  label: { flex: 1, fontSize: 15, fontWeight: "600" },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 19 },
  input: {
    borderCurve: "continuous",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  emphasized: { borderWidth: 1 },
  error: { fontSize: 13, lineHeight: 19 },
});
