import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  projectWorkspaceMemoryItems,
  projectWorkspaceMemoryResource,
  projectWorkspaceResources,
  projectWorkspaceSkillResource,
  projectWorkspaceSkills,
  resolveProjectWorkspaceContext,
} from "@/application/project-workspace-context";
import { AppIcon } from "@/components/app-icon";
import { MarkdownContent } from "@/components/markdown-content";
import { IconButton, ScreenHeader } from "@/components/ui";
import { getMemoryCatalog, getSkillCatalog } from "@/domain/app-state";
import {
  MAX_GLOBAL_MEMORY_CHARACTERS,
  MAX_GLOBAL_SKILL_CHARACTERS,
} from "@/domain/library-content";
import type { WorkspaceResource } from "@/domain/models";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectLibraryDetailState = createAppStateFieldsSelector(
  "customGlobalMemories",
  "customGlobalSkills",
  "globalMemoryTextById",
  "globalSkillContentById",
  "projectSkillEnabledByProjectId",
  "projects",
  "resources",
  "skillEnabledById",
);

type DetailKind = "memory" | "skill" | "instructions";
type GlobalEditTarget = { kind: "memory" | "skill"; itemId: string };
type LibraryDetail = {
  title: string;
  content: string;
  globalEdit?: GlobalEditTarget;
  projectResource?: WorkspaceResource;
  protected?: boolean;
};

export function LibraryDetailScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { kind, itemId, projectId } = useLocalSearchParams<{
    kind?: DetailKind;
    itemId?: string;
    projectId?: string;
  }>();
  const { updateGlobalMemory, updateGlobalSkill } = useAppActions();
  const state = useAppStateSelector(selectLibraryDetailState);
  const editorInputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const detailKind: DetailKind | null =
    kind === "memory" || kind === "skill" || kind === "instructions"
      ? kind
      : null;
  const detailItemId = typeof itemId === "string" ? itemId : null;
  const resolvedProjectId = typeof projectId === "string" ? projectId : null;
  const project = resolvedProjectId
    ? state.projects[resolvedProjectId]
    : undefined;
  const resources = Object.values(state.resources);
  const memoryCatalog = getMemoryCatalog(state);
  const skillCatalog = getSkillCatalog(state, locale);

  const detail: LibraryDetail | null = (() => {
    if (detailKind === "instructions" && project) {
      const context = resolveProjectWorkspaceContext({
        project,
        resources,
        memories: memoryCatalog,
        skills: skillCatalog,
        enabledById: state.skillEnabledById,
        projectEnabledById: state.projectSkillEnabledByProjectId[project.id],
      });
      return {
        title: t("library.detail.projectInstructions"),
        content: context.instructions,
        projectResource: projectWorkspaceResources(resources, project.id).find(
          (resource) => resource.path === "AGENTS.md",
        ),
      };
    }

    if (detailKind === "memory" && detailItemId) {
      if (project) {
        const item = projectWorkspaceMemoryItems(resources, project.id).find(
          (candidate) => candidate.id === detailItemId,
        );
        return item
          ? {
              title: t("library.detail.memory"),
              content: item.text,
              projectResource: projectWorkspaceMemoryResource(
                resources,
                project.id,
                item.id,
              ),
            }
          : null;
      }
      const item = memoryCatalog.find(
        (candidate) =>
          candidate.id === detailItemId && candidate.scope === "global",
      );
      return item
        ? {
            title: t("library.detail.memory"),
            content: item.text,
            globalEdit: { kind: "memory", itemId: item.id },
          }
        : null;
    }

    if (detailKind === "skill" && detailItemId) {
      if (project) {
        const candidates = projectWorkspaceSkills({
          catalog: skillCatalog,
          resources,
          enabledById: state.skillEnabledById,
          projectEnabledById: state.projectSkillEnabledByProjectId[project.id],
          projectId: project.id,
        });
        const item = candidates.find(
          (candidate) => candidate.id === detailItemId,
        );
        return item
          ? {
              title: item.name,
              content: item.content,
              projectResource: projectWorkspaceSkillResource({
                catalog: skillCatalog,
                resources,
                projectId: project.id,
                skillId: item.id,
              }),
            }
          : null;
      }
      const item = skillCatalog.find(
        (candidate) =>
          candidate.id === detailItemId && candidate.scope === "global",
      );
      return item
        ? {
            title: item.name,
            content: item.content,
            globalEdit: { kind: "skill", itemId: item.id },
          }
        : null;
    }

    return null;
  })();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (detailKind === "instructions" && project) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
      return;
    }
    if (detailKind === "memory") {
      router.replace(
        project
          ? { pathname: "/memory", params: { projectId: project.id } }
          : "/memory",
      );
      return;
    }
    if (detailKind === "skill") {
      router.replace(
        project
          ? { pathname: "/skills", params: { projectId: project.id } }
          : "/skills",
      );
      return;
    }
    router.replace("/");
  };

  const closeEditor = () => {
    setDraft("");
    setEditing(false);
  };

  const requestCloseEditor = () => {
    if (!detail || draft === detail.content) {
      closeEditor();
      return;
    }
    Alert.alert(
      t("library.detail.discardTitle"),
      t("library.detail.discardConfirm"),
      [
        { text: t("library.detail.keepEditing"), style: "cancel" },
        {
          text: t("library.detail.discard"),
          style: "destructive",
          onPress: closeEditor,
        },
      ],
    );
  };

  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        requestCloseEditor();
        return true;
      },
    );
    return () => subscription.remove();
  });

  const startEditing = () => {
    if (!detail) return;
    if (project && detail.projectResource) {
      router.push({
        pathname: "/project-files/[projectId]/[resourceId]",
        params: {
          projectId: project.id,
          resourceId: detail.projectResource.id,
          edit: "1",
        },
      });
      return;
    }
    if (!detail.globalEdit) return;
    setDraft(detail.content);
    setEditing(true);
  };

  const saveGlobalEdit = () => {
    if (!detail?.globalEdit || draft === detail.content) return;
    try {
      if (detail.globalEdit.kind === "memory") {
        updateGlobalMemory(detail.globalEdit.itemId, draft);
      } else {
        updateGlobalSkill(detail.globalEdit.itemId, draft);
      }
      closeEditor();
    } catch (error) {
      Alert.alert(
        t("library.detail.saveFailed"),
        localizedErrorMessage(error, t("library.detail.contentSaveFailed")),
      );
    }
  };

  const dismissEditorKeyboard = () => {
    editorInputRef.current?.blur();
    Keyboard.dismiss();
  };

  if (editing && detail?.globalEdit) {
    const maximum =
      detail.globalEdit.kind === "memory"
        ? MAX_GLOBAL_MEMORY_CHARACTERS
        : MAX_GLOBAL_SKILL_CHARACTERS;
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
            onBack={requestCloseEditor}
            palette={palette}
            right={
              <IconButton
                disabled={draft === detail.content}
                icon="checkmark"
                label={t("library.detail.save")}
                onPress={saveGlobalEdit}
                palette={palette}
              />
            }
            title={detail.title}
          />
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.editorContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={dismissEditorKeyboard}
            onScrollEndDrag={dismissEditorKeyboard}
            showsVerticalScrollIndicator={false}
            style={styles.editorScroll}
          >
            <TextInput
              ref={editorInputRef}
              accessibilityLabel={t("library.detail.edit", {
                title: detail.title,
              })}
              autoCapitalize={
                detail.globalEdit.kind === "memory" ? "sentences" : "none"
              }
              autoCorrect={detail.globalEdit.kind === "memory"}
              maxLength={maximum}
              multiline
              onChangeText={setDraft}
              scrollEnabled={false}
              selectionColor={palette.accent}
              spellCheck={detail.globalEdit.kind === "memory"}
              style={[
                styles.editor,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
              textAlignVertical="top"
              value={draft}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        right={
          detail?.globalEdit || detail?.projectResource ? (
            <IconButton
              icon="create-outline"
              label={t("library.detail.edit", { title: detail.title })}
              onPress={startEditing}
              palette={palette}
            />
          ) : null
        }
        title={detail?.title ?? t("library.detail.fallbackTitle")}
      />
      {
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("library.detail.contentMissing")}
          </Text>
        </View>
      }
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  editorContent: { flexGrow: 1, padding: spacing.md },
  editor: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 1,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 14,
    lineHeight: 21,
    padding: spacing.md,
  },
  editorScroll: { flex: 1 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { fontSize: 14, fontWeight: "500" },
  protectedState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  protectedIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  protectedTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: spacing.md,
    textAlign: "center",
  },
  protectedDetail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
    maxWidth: 320,
    textAlign: "center",
  },
});
