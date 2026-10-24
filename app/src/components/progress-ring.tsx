import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

const DEFAULT_SEGMENTS = 64;

export function ProgressRing({
  activeColor,
  progress,
  size = 22,
  strokeWidth = 2,
  trackColor,
}: {
  activeColor: string;
  progress: number;
  size?: number;
  strokeWidth?: number;
  trackColor: string;
}) {
  const boundedProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  const filledSegments =
    boundedProgress === 0
      ? 0
      : Math.min(
          DEFAULT_SEGMENTS,
          Math.ceil(boundedProgress * DEFAULT_SEGMENTS),
        );
  const segments = useMemo(
    () => Array.from({ length: DEFAULT_SEGMENTS }, (_, index) => index),
    [],
  );
  const segmentWidth = Math.max(
    1,
    ((Math.PI * (size - strokeWidth)) / DEFAULT_SEGMENTS) * 1.25,
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ height: size, width: size }}
    >
      <View
        style={[
          styles.track,
          {
            borderColor: trackColor,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            height: size,
            width: size,
          },
        ]}
      />
      {segments.slice(0, filledSegments).map((index) => (
        <View
          key={index}
          style={[
            styles.orbit,
            {
              height: size,
              transform: [{ rotate: `${(index * 360) / DEFAULT_SEGMENTS}deg` }],
              width: size,
            },
          ]}
        >
          <View
            style={{
              backgroundColor: activeColor,
              borderRadius: segmentWidth,
              height: strokeWidth,
              left: (size - segmentWidth) / 2,
              position: "absolute",
              top: 0,
              width: segmentWidth,
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  orbit: { left: 0, position: "absolute", top: 0 },
  track: { left: 0, position: "absolute", top: 0 },
});
