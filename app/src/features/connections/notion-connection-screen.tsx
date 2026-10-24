import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectNotionConnectionState = createAppStateFieldsSelector("projects");

export function NotionConnectionScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { connectNotionPage } = useAppActions();
  const state = useAppStateSelector(selectNotionConnectionState);
  const project = projectId ? state.projects[projectId] : undefined;
  const [pageUrl, setPageUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else {
      router.replace(
        project
          ? { pathname: "/connections", params: { projectId: project.id } }
          : "/projects",
      );
    }
  };

  const connect = async () => {
    if (!project || !pageUrl.trim() || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const bundle = await connectNotionPage(pageUrl, project.id);
      if (bundle) {
        router.dismissTo({
          pathname: "/connections",
          params: { projectId: project.id },
        });
      }
    } catch (caught) {
      setError(localizedErrorMessage(caught, t("connections.notion.failed")));
    } finally {
      setIsConnecting(false);
    }
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
        title={t("connections.catalog.notion.title")}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={[styles.label, { color: palette.text }]}>
              {t("connections.notion.pageLink")}
            </Text>
            <TextInput
              accessibilityLabel={t("connections.notion.pageLinkAccessibility")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(value) => {
                setPageUrl(value);
                setError(null);
              }}
              onSubmitEditing={() => void connect()}
              placeholder="https://www.notion.so/…"
              placeholderTextColor={palette.textTertiary}
              returnKeyType="go"
              style={[
                styles.input,
                {
                  backgroundColor: palette.surface,
                  borderColor: error ? palette.danger : palette.border,
                  color: palette.text,
                },
              ]}
              value={pageUrl}
            />
          </View>
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t("connections.notion.note")}
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: palette.danger }]}
            >
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel={t("connections.notion.connectAccessibility")}
            accessibilityRole="button"
            disabled={!project || !pageUrl.trim() || isConnecting}
            onPress={() => void connect()}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: palette.text },
              (!project || !pageUrl.trim() || isConnecting) && {
                opacity: 0.36,
              },
              pressed && { opacity: 0.68 },
            ]}
          >
            {isConnecting ? (
              <LoadingIndicator
                color={palette.background}
                palette={palette}
                variant="inline"
              />
            ) : (
              <Text style={[styles.buttonText, { color: palette.background }]}>
                {t("connections.notion.connect")}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: spacing.md },
  field: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  note: { fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  error: { fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 50,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
