import { Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing, type AppPalette } from "@/theme/tokens";

export type SegmentOption<Value extends string> = Readonly<{
  accessibilityLabel?: string;
  label: string;
  value: Value;
}>;

export function SegmentedControl<Value extends string>({
  accessibilityLabel,
  onChange,
  options,
  palette,
  value,
}: {
  accessibilityLabel: string;
  onChange: (value: Value) => void;
  options: readonly SegmentOption<Value>[];
  palette: AppPalette;
  value: Value;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        {
          backgroundColor: palette.codeSurface,
          borderColor: palette.border,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && [
                styles.selectedSegment,
                {
                  backgroundColor: palette.surfaceRaised,
                  borderColor: palette.borderStrong,
                },
              ],
              pressed && { opacity: 0.62 },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: selected ? palette.text : palette.textSecondary,
                  fontWeight: selected ? "700" : "600",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderCurve: "continuous",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    padding: spacing.xxs,
  },
  segment: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedSegment: { borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 15, textAlign: "center" },
});
