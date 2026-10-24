import type { PropsWithChildren } from "react";
import {
  StyleSheet,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
  View,
} from "react-native";

type BoundedFlexProps = PropsWithChildren<
  Omit<ViewProps, "style"> & {
    style?: StyleProp<ViewStyle>;
  }
>;

/**
 * Flexible copy beside fixed controls must have a one-way width constraint.
 * Without minWidth: 0, long unbroken text can feed its intrinsic width back
 * into a Fabric/Yoga row and keep the native mounting tree relaying out.
 */
export function BoundedFlex({ style, ...props }: BoundedFlexProps) {
  return <View {...props} style={[styles.flex, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrinkableText: { flexShrink: 1, minWidth: 0 },
});

/** Use on flexible Text nodes that sit directly in a horizontal row. */
export const shrinkableTextStyle = styles.shrinkableText;
