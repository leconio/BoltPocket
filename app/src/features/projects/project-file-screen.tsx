import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
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

import {
  getProjectFileEditability,
  MAX_PROJECT_FILE_EDIT_CHARACTERS,
} from "@/application/project-file-manager";
import { MarkdownContent } from "@/components/markdown-content";
import { LoadingIndicator } from "@/components/loading-indicator";
import { IconButton, ScreenHeader } from "@/components/ui";
import { useBrowserActions } from "@/features/browser/browser-provider";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { isBinaryProjectWorkspaceResource } from "@/domain/models";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectProjectFileState = createAppStateFieldsSelector(
  "projects",
  "resources",
);

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function isMarkdownFile(path: string) {
  return /\.(md|markdown)$/iu.test(path);
}

export function ProjectFileScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const { newPreviewTask } = useBrowserActions();
  const router = useRouter();
  const { edit, projectId, resourceId } = useLocalSearchParams<{
    edit?: string;
    projectId: string;
    resourceId: string;
  }>();
  const {
    applyProposal,
    createProjectPreview,
    createProjectFileEditProposal,
    readProjectFile,
  } = useAppActions();
  const state = useAppStateSelector(selectProjectFileState);
  const project = state.projects[projectId];
  const candidate = state.resources[resourceId];
  const resource = candidate?.projectId === projectId ? candidate : undefined;
  const [editing, setEditing] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [draft, setDraft] = useState(resource?.content ?? "");
  const [readAttempt, setReadAttempt] = useState(0);
  const [readState, setReadState] = useState<
    | { status: "loading" }
    | { status: "ready" }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const initialEditHandled = useRef(false);
  const editability = resource
    ? getProjectFileEditability(resource)
    : ({
        editable: false,
        reason: t("project.file.missingCurrent"),
      } as const);
  const markdown = resource ? isMarkdownFile(resource.path) : false;
  const binary = resource ? isBinaryProjectWorkspaceResource(resource) : false;
  const canRenderMarkdown =
    markdown &&
    !binary &&
    resource !== undefined &&
    resource.content.length <= MAX_PROJECT_FILE_EDIT_CHARACTERS;
  const dirty = resource ? draft !== resource.content : false;
  const previewable = Boolean(resource && /\.html?$/iu.test(resource.path));

  useEffect(() => {
    let active = true;
    void readProjectFile({ projectId, resourceId }).then(
      () => {
        if (active) setReadState({ status: "ready" });
      },
      (error: unknown) => {
        if (!active) return;
        setReadState({
          status: "error",
          message: localizedErrorMessage(error, t("project.file.readFailed")),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, readAttempt, readProjectFile, resourceId, t]);

  useEffect(() => {
    if (
      edit !== "1" ||
      initialEditHandled.current ||
      readState.status !== "ready" ||
      !resource ||
      !editability.editable
    ) {
      return;
    }
    initialEditHandled.current = true;
    setDraft(resource.content);
    setEditing(true);
  }, [edit, editability.editable, readState.status, resource]);

  const leaveEditor = () => {
    setDraft(resource?.content ?? "");
    setEditing(false);
  };

  const requestLeaveEditor = () => {
    if (!dirty) {
      leaveEditor();
      return;
    }
    Alert.alert(
      t("project.file.discardTitle"),
      t("project.file.discardConfirm"),
      [
        { text: t("project.file.keepEditing"), style: "cancel" },
        {
          text: t("project.file.discard"),
          style: "destructive",
          onPress: leaveEditor,
        },
      ],
    );
  };

  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        requestLeaveEditor();
        return true;
      },
    );
    return () => subscription.remove();
  });

  const returnToPrevious = () => {
    if (editing) {
      requestLeaveEditor();
      return;
    }
    if (router.canGoBack()) router.back();
    else if (project) {
      router.replace({
        pathname: "/project-files/[projectId]",
        params: { projectId: project.id },
      });
    } else router.replace("/projects");
  };

  const saveAndReview = async () => {
    if (!resource || !dirty) return;
    let proposal;
    try {
      proposal = createProjectFileEditProposal({
        projectId,
        resourceId: resource.id,
        after: draft,
      });
      setEditing(false);
      await applyProposal(proposal.id);
    } catch (error) {
      if (!proposal) {
        Alert.alert(
          t("project.file.couldNotCreateDiff"),
          localizedErrorMessage(error, t("project.file.diffChanged")),
        );
        return;
      }
      Alert.alert(
        t("project.file.notApplied"),
        localizedErrorMessage(error, t("project.file.reviewDiff")),
      );
    } finally {
      if (!proposal) return;
      router.push({
        pathname: "/changes/[proposalId]",
        params: { proposalId: proposal.id, origin: "project" },
      });
    }
  };

  const retryRead = () => {
    setReadState({ status: "loading" });
    setReadAttempt((current) => current + 1);
  };

  const openPreview = async () => {
    if (!resource || !previewable || previewBusy) return;
    setPreviewBusy(true);
    let snapshot;
    try {
      snapshot = await createProjectPreview({
        projectId,
        resourceId: resource.id,
      });
      newPreviewTask(snapshot, true);
    } catch (error) {
      if (snapshot) {
        await Promise.resolve(
          projectPreviewSnapshots.release(snapshot.id),
        ).catch(() => undefined);
      }
      Alert.alert(
        t("project.file.couldNotPreview"),
        localizedErrorMessage(error, t("project.common.retry")),
      );
    } finally {
      setPreviewBusy(false);
    }
  };

  if (!project || !resource) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={returnToPrevious}
          palette={palette}
          title={t("project.file.projectFiles")}
        />
        <View style={styles.missingState}>
          <Text style={[styles.missingTitle, { color: palette.text }]}>
            {t("project.file.missing")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (editing) {
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
            onBack={returnToPrevious}
            palette={palette}
            title={fileName(resource.path)}
          />
          <TextInput
            accessibilityLabel={t("project.file.edit", {
              path: resource.path,
            })}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={MAX_PROJECT_FILE_EDIT_CHARACTERS}
            multiline
            onChangeText={setDraft}
            selectionColor={palette.accent}
            spellCheck={false}
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
          <View
            style={[styles.editorFooter, { borderTopColor: palette.border }]}
          >
            <View style={styles.editorActions}>
              <Pressable
                accessibilityRole="button"
                onPress={requestLeaveEditor}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: palette.borderStrong },
                  pressed && { opacity: 0.62 },
                ]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: palette.text }]}
                >
                  {t("project.file.cancel")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!dirty}
                onPress={saveAndReview}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: palette.text },
                  pressed && { opacity: 0.72 },
                  !dirty && { opacity: 0.34 },
                ]}
              >
                <Ionicons
                  color={palette.background}
                  name="git-compare-outline"
                  size={17}
                />
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: palette.background },
                  ]}
                >
                  {t("project.file.saveAndReview")}
                </Text>
              </Pressable>
            </View>
          </View>
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
        onBack={returnToPrevious}
        palette={palette}
        right={
          readState.status === "ready" &&
          (previewable || editability.editable) ? (
            <View style={styles.headerActions}>
              {previewable ? (
                <IconButton
                  disabled={previewBusy}
                  icon="play-outline"
                  label={t("project.file.preview", { path: resource.path })}
                  onPress={() => void openPreview()}
                  palette={palette}
                />
              ) : null}
              {editability.editable ? (
                <IconButton
                  icon="create-outline"
                  label={t("project.file.edit", { path: resource.path })}
                  onPress={() => {
                    setDraft(resource.content);
                    setEditing(true);
                  }}
                  palette={palette}
                />
              ) : null}
            </View>
          ) : null
        }
        title={fileName(resource.path)}
      />
      <ScrollView
        contentContainerStyle={styles.viewerContent}
        showsVerticalScrollIndicator={false}
      >
        {readState.status === "loading" ? (
          <View accessibilityLiveRegion="polite" style={styles.loading}>
            <LoadingIndicator palette={palette} variant="content" />
          </View>
        ) : null}

        {readState.status === "error" ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.readState,
              {
                backgroundColor: palette.dangerSoft,
                borderColor: palette.danger,
              },
            ]}
          >
            <Ionicons
              color={palette.danger}
              name="alert-circle-outline"
              size={18}
            />
            <Text style={[styles.readStateText, { color: palette.danger }]}>
              {readState.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryRead}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.retryText, { color: palette.danger }]}>
                {t("project.file.retry")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {readState.status !== "ready" ? null : binary ? (
          <View
            style={[
              styles.source,
              {
                backgroundColor: palette.codeSurface,
                borderColor: palette.border,
              },
            ]}
          >
            <Text style={[styles.sourceText, { color: palette.text }]}>
              {resource.storage.kind === "project-workspace" &&
              resource.storage.binary
                ? t("project.file.binaryMeta", {
                    bytes:
                      resource.storage.binary.byteLength.toLocaleString(locale),
                    mimeType: resource.storage.binary.mimeType,
                    packId:
                      resource.storage.binary.source.kind ===
                      "builtin-h5-resource"
                        ? resource.storage.binary.source.packId
                        : resource.storage.binary.source.skillId,
                    path: resource.storage.binary.source.path,
                    sha256: resource.storage.binary.sha256,
                  })
                : t("project.file.binary")}
            </Text>
          </View>
        ) : canRenderMarkdown ? (
          <MarkdownContent>{resource.content}</MarkdownContent>
        ) : (
          <View
            style={[
              styles.source,
              {
                backgroundColor: palette.codeSurface,
                borderColor: palette.border,
              },
            ]}
          >
            <Text
              selectable
              style={[styles.sourceText, { color: palette.text }]}
            >
              {resource.content || t("project.file.empty")}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  headerActions: { alignItems: "center", flexDirection: "row" },
  missingState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  missingTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  viewerContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  loading: { alignItems: "center", justifyContent: "center", minHeight: 160 },
  readState: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  readStateText: { flex: 1, fontSize: 12, lineHeight: 18 },
  retryButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  retryText: { fontSize: 12, fontWeight: "600" },
  source: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  sourceText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 13,
    lineHeight: 20,
  },
  editor: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 14,
    lineHeight: 21,
    marginHorizontal: spacing.md,
    padding: spacing.sm,
  },
  editorFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  editorActions: { flexDirection: "row", gap: spacing.sm },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "600" },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1.35,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: { fontSize: 14, fontWeight: "600" },
});
