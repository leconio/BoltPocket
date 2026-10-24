import Ionicons from "@react-native-vector-icons/ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/i18n/i18n-provider";
import type { useAppPalette } from "@/theme/tokens";
import { LOCAL_INFERENCE } from "@/config/local-inference";

export function AiGeneratedFooter({
  onReport,
  palette,
}: {
  onReport: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel={t("chat.content.aiGenerated.accessibility")}
        style={styles.label}
      >
        <Ionicons
          color={palette.textTertiary}
          name="sparkles-outline"
          size={10}
        />
        <Text style={[styles.text, { color: palette.textTertiary }]}>
          {t("chat.content.aiGenerated")}
        </Text>
      </View>
      {!LOCAL_INFERENCE && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onReport}
          style={({ pressed }) => [
            styles.reportButton,
            pressed && { opacity: 0.55 },
          ]}
        >
          <Ionicons
            color={palette.textTertiary}
            name="flag-outline"
            size={12}
          />
          <Text style={[styles.text, { color: palette.textTertiary }]}>
            {t("chat.report.action")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    width: "100%",
  },
  label: { alignItems: "center", flexDirection: "row", gap: 3 },
  reportButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 8,
  },
  text: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2,
    lineHeight: 14,
  },
});
