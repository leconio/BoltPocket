import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { spacing, useAppPalette } from "@/theme/tokens";
import { LocalModelSettingsCard } from "./local-model-settings-card";

export function LocalModelSettingsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.screen, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        palette={palette}
        title={t("settings.local.title")}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/settings/model");
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <LocalModelSettingsCard />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
