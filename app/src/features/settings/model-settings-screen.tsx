import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Alert,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ui";
import { ModelSettingsCard } from "@/features/settings/model-settings-card";
import { ModelSettingsAction } from "@/features/settings/model-settings-components";
import { useModelSettingsSession } from "@/features/settings/model-settings-session";
import { loadMainModelChoice } from "@/infrastructure/model-config";
import { localModelById } from "@/infrastructure/model-config/local-model-catalog";
import { useApiModelDefault } from "@/infrastructure/model-config/local-model-library";
import type { MainModelChoice } from "@/infrastructure/model-config/model-source-selection";
import { useI18n } from "@/i18n/i18n-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

export function ModelSettingsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const session = useModelSettingsSession();
  const [choice, setChoice] = useState<MainModelChoice>();
  const [saving, setSaving] = useState(false);
  const apiDefault = session.models.find(
    (model) => model.id === session.routes?.main,
  );
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      void loadMainModelChoice()
        .then((value) => {
          if (focused) setChoice(value);
        })
        .catch(() => {});
      return () => {
        focused = false;
      };
    }, [session.loaded, session.routes?.main]),
  );
  const selectApiDefault = async () => {
    setSaving(true);
    try {
      await useApiModelDefault();
      setChoice(await loadMainModelChoice());
    } catch {
      Alert.alert(t("settings.local.selectFailed"));
    } finally {
      setSaving(false);
    }
  };
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
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
        title={t("settings.model.title")}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.safeArea}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
            <ModelSettingsAction
              palette={palette}
              secondary
              title={t("settings.local.open")}
              onPress={() => router.push("/settings/local-models")}
            />
            {choice ? (
              <Text style={{ color: palette.textSecondary }}>
                {t("settings.local.currentDefault", {
                  name:
                    choice.source === "local"
                      ? localModelById(choice.id).name
                      : (apiDefault?.name ?? t("settings.local.apiDefault")),
                })}
              </Text>
            ) : null}
            <ModelSettingsAction
              palette={palette}
              title={
                choice?.source === "api"
                  ? t("settings.local.apiDefaultActive")
                  : t("settings.local.useApiDefault")
              }
              disabled={!apiDefault || choice?.source === "api"}
              loading={saving}
              onPress={() => {
                void selectApiDefault();
              }}
            />
          </View>
          <ModelSettingsCard />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
