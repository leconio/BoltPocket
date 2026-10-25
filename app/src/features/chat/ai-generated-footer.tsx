import Ionicons from "@react-native-vector-icons/ionicons";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/i18n/i18n-provider";
import type { useAppPalette } from "@/theme/tokens";

export function AiGeneratedFooter({
  palette,
}: {
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  return (
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
  );
}
const styles = StyleSheet.create({
  label: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    paddingVertical: 2,
  },
  text: { fontSize: 10, fontWeight: "500", letterSpacing: 0.2, lineHeight: 14 },
});
