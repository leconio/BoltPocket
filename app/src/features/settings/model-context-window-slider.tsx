import Slider from "@react-native-community/slider";
import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  formatCompactTokenCount,
  MODEL_CONTEXT_WINDOW_OPTIONS,
  nearestContextWindowOption,
} from "@/application/conversation-context-usage";
import { spacing, type AppPalette } from "@/theme/tokens";

export function ModelContextWindowSlider({
  accessibilityLabel,
  disabled = false,
  onChange,
  palette,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  palette: AppPalette;
  value: number;
}) {
  const selected = nearestContextWindowOption(value);
  const lastEmittedValue = useRef(selected);
  const index = MODEL_CONTEXT_WINDOW_OPTIONS.indexOf(selected);
  const lastIndex = MODEL_CONTEXT_WINDOW_OPTIONS.length - 1;
  useEffect(() => {
    lastEmittedValue.current = selected;
  }, [selected]);

  const emitIndex = (nextIndex: number) => {
    const nextValue = MODEL_CONTEXT_WINDOW_OPTIONS[nextIndex]!;
    if (nextValue === lastEmittedValue.current) return;
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
  };

  return (
    <View>
      <Slider
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: 0,
          max: lastIndex,
          now: index,
          text: formatCompactTokenCount(selected),
        }}
        disabled={disabled}
        maximumTrackTintColor={palette.borderStrong}
        maximumValue={lastIndex}
        minimumTrackTintColor={palette.accent}
        minimumValue={0}
        onValueChange={(nextIndex) => emitIndex(Math.round(nextIndex))}
        step={1}
        style={[styles.slider, disabled && styles.disabled]}
        thumbTintColor={palette.accent}
        value={index}
      />
      <View style={styles.bounds}>
        <Text style={[styles.boundText, { color: palette.textTertiary }]}>
          16K
        </Text>
        <Text style={[styles.boundText, { color: palette.textTertiary }]}>
          2M
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slider: { minHeight: 44 },
  disabled: { opacity: 0.42 },
  bounds: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  boundText: { fontSize: 11 },
});
