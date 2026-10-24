import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { ListRow, ScreenHeader, SectionLabel } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage, type LocalePreference } from "@/i18n/translate";
import { spacing, useAppPalette } from "@/theme/tokens";

const languageOptions: readonly Readonly<{
  preference: LocalePreference;
  labelKey: MessageKey;
  detailKey?: MessageKey;
  icon: "phone-portrait-outline" | "language-outline";
}>[] = [
  {
    preference: "system",
    labelKey: "settings.language.system",
    detailKey: "settings.language.systemDetail",
    icon: "phone-portrait-outline",
  },
  {
    preference: "zh-CN",
    labelKey: "settings.language.chinese",
    icon: "language-outline",
  },
  {
    preference: "en",
    labelKey: "settings.language.english",
    icon: "language-outline",
  },
];

export function LanguageSettingsScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { preference, ready, setPreference, storageError, t } = useI18n();
  const [pending, setPending] = useState<LocalePreference | null>(null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const selectLanguage = (next: LocalePreference) => {
    if (pending || next === preference) return;
    setPending(next);
    void setPreference(next)
      .catch((error: unknown) => {
        Alert.alert(
          t("settings.language.failed"),
          localizedErrorMessage(error, t("settings.language.saveFailed")),
        );
      })
      .finally(() => setPending(null));
  };

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        title={t("settings.language.title")}
      />
      {!ready ? (
        <View style={styles.loading}>
          <LoadingIndicator
            accessibilityLabel={t("settings.language.reading")}
            palette={palette}
            style={styles.loading}
            variant="list"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel palette={palette}>
            {t("settings.language.applicationLanguage")}
          </SectionLabel>
          {languageOptions.map((option) => (
            <ListRow
              detail={option.detailKey ? t(option.detailKey) : undefined}
              icon={option.icon}
              key={option.preference}
              onPress={() => selectLanguage(option.preference)}
              palette={palette}
              title={t(option.labelKey)}
              value={
                preference === option.preference
                  ? t("settings.language.selected")
                  : undefined
              }
            />
          ))}
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t("settings.language.footer")}
          </Text>
          {storageError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.error, { color: palette.danger }]}
            >
              {t(storageError)}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
});
