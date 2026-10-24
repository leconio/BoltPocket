import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { IconButton, ScreenHeader, SectionLabel } from "@/components/ui";
import { MAX_GLOBAL_MEMORY_CHARACTERS } from "@/domain/library-content";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type CreateScope = "global" | "project";

const selectLibraryCreateState = createAppStateFieldsSelector("projects");

export function LibraryCreateScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    scope?: string;
    projectId?: string;
  }>();
  const { createGlobalMemory, createProjectMemory } = useAppActions();
  const state = useAppStateSelector(selectLibraryCreateState);
  const requestedProjectId =
    typeof params.projectId === "string" ? params.projectId : null;
  const project = requestedProjectId
    ? state.projects[requestedProjectId]
    : undefined;
  const scope: CreateScope =
    params.scope === "project" && project ? "project" : "global";
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const canSave = !saving && Boolean(content.trim());

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/memory");
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (scope === "project" && project) {
        await createProjectMemory({ projectId: project.id, text: content });
      } else {
        createGlobalMemory(content);
      }
      goBack();
    } catch (error) {
      Alert.alert(
        t("library.create.couldNotSave"),
        localizedErrorMessage(error, t("library.common.retry")),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.safeArea}
      >
        <ScreenHeader
          onBack={goBack}
          palette={palette}
          right={
            saving ? (
              <LoadingIndicator palette={palette} variant="inline" />
            ) : (
              <IconButton
                disabled={!canSave}
                icon="checkmark"
                label={t("library.create.save")}
                onPress={() => void save()}
                palette={palette}
              />
            )
          }
          title={t("library.create.title.memory")}
        />
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel palette={palette}>
            {scope === "project"
              ? (project?.name ?? t("library.common.currentProject"))
              : t("library.common.global")}
          </SectionLabel>
          <TextInput
            accessibilityLabel={t("library.create.content.memory")}
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            maxLength={MAX_GLOBAL_MEMORY_CHARACTERS}
            multiline
            onChangeText={setContent}
            placeholder={t("library.create.longTermMemory")}
            placeholderTextColor={palette.textTertiary}
            spellCheck
            style={[
              styles.contentInput,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                color: palette.text,
              },
            ]}
            textAlignVertical="top"
            value={content}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xxl },
  contentInput: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 14,
    lineHeight: 22,
    minHeight: 280,
    padding: spacing.md,
  },
});
