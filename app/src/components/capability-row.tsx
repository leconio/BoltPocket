import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AppIcon, type IconName } from "@/components/app-icon";
import { AppSwitch } from "@/components/ui";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

export function CapabilityRow({
  badge,
  detail,
  disabled = false,
  enabled,
  icon,
  onPress,
  onToggle,
  palette,
  title,
  toggleLabel,
}: {
  badge?: string;
  detail?: string;
  disabled?: boolean;
  enabled?: boolean;
  icon: IconName;
  onPress?: () => void;
  onToggle?: (enabled: boolean) => void;
  palette: AppPalette;
  title: string;
  toggleLabel?: string;
}) {
  const { fontScale, width } = useWindowDimensions();
  const stacksControl = width <= 360 || fontScale >= 1.35;
  const active = enabled ?? true;
  const copy = (
    <View style={styles.copy}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
        {badge ? (
          <Text style={[styles.badge, { color: palette.textSecondary }]}>
            {badge}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text
          numberOfLines={3}
          style={[styles.detail, { color: palette.textSecondary }]}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
  const leading = (
    <View style={styles.mainRow}>
      <View
        style={[
          styles.icon,
          {
            backgroundColor: active ? palette.accentSoft : palette.codeSurface,
          },
        ]}
      >
        <AppIcon
          color={active ? palette.accent : palette.textSecondary}
          name={icon}
          size={19}
        />
      </View>
      {onPress ? (
        <Pressable
          accessibilityLabel={[title, detail].filter(Boolean).join(", ")}
          accessibilityRole="button"
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.copyButton,
            pressed && { opacity: 0.58 },
          ]}
        >
          {copy}
        </Pressable>
      ) : (
        copy
      )}
    </View>
  );
  const control =
    enabled === undefined || !onToggle ? null : (
      <AppSwitch
        accessibilityLabel={toggleLabel ?? title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        ios_backgroundColor={palette.borderStrong}
        onValueChange={onToggle}
        thumbColor={enabled ? palette.accentText : palette.surface}
        trackColor={{ false: palette.borderStrong, true: palette.accent }}
        value={enabled}
      />
    );

  return (
    <View
      style={[
        styles.row,
        !stacksControl && styles.inlineRow,
        { borderBottomColor: palette.border },
        disabled && { opacity: 0.52 },
      ]}
    >
      {leading}
      {control ? (
        <View
          style={stacksControl ? styles.stackedControl : styles.inlineControl}
        >
          {control}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    minHeight: 68,
    paddingVertical: spacing.sm,
  },
  inlineRow: { alignItems: "center", flexDirection: "row" },
  mainRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0,
    flex: 1,
  },
  icon: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  copyButton: { flex: 1, minHeight: 44, minWidth: 0 },
  copy: { flex: 1, justifyContent: "center", minHeight: 44, minWidth: 0 },
  titleRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  title: { flexShrink: 1, fontSize: 16, fontWeight: "600" },
  badge: { fontSize: 12 },
  detail: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  inlineControl: { alignItems: "flex-end", justifyContent: "center" },
  stackedControl: { alignSelf: "flex-start", marginLeft: 44 + spacing.sm },
});
