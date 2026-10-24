import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  listProjectDirectory,
  parentProjectDirectory,
  type ProjectFileEntry,
  type ProjectExplorerEntry,
} from "@/application/project-file-manager";
import {
  BottomSheet,
  IconButton,
  ListRow,
  ScreenHeader,
} from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectProjectFileExplorerState = createAppStateFieldsSelector(
  "projects",
  "resources",
);

function projectFileIcon(path: string) {
  const normalized = path.toLowerCase();
  if (/\.(md|markdown)$/u.test(normalized)) return "document-text-outline";
  if (
    /\.(json|js|jsx|ts|tsx|css|html|xml|yaml|yml|sh|py|swift|kt|java|c|h|cpp|hpp|rs|go)$/u.test(
      normalized,
    )
  ) {
    return "code-slash-outline";
  }
  return "document-outline";
}

export function ProjectFileExplorerScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const state = useAppStateSelector(selectProjectFileExplorerState);
  const {
    applyProposal,
    createProjectEntry,
    deleteProjectEntry,
    renameProjectEntry,
  } = useAppActions();
  const [directory, setDirectory] = useState("");
  const [sheet, setSheet] = useState<
    | { kind: "create" }
    | { kind: "entry"; entry: ProjectExplorerEntry }
    | {
        kind: "name";
        operation: "create-file" | "create-directory" | "rename";
        entry?: ProjectExplorerEntry;
      }
    | null
  >(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const project = state.projects[projectId];
  const resources = useMemo(
    () => Object.values(state.resources),
    [state.resources],
  );
  const entries = useMemo<ProjectExplorerEntry[]>(
    () => listProjectDirectory(resources, projectId, directory),
    [directory, projectId, resources],
  );
  const breadcrumbSegments = directory
    ? directory.split("/").map((name, index, segments) => ({
        name,
        path: segments.slice(0, index + 1).join("/"),
      }))
    : [];

  const returnToPrevious = () => {
    if (directory) {
      setDirectory(parentProjectDirectory(directory));
      return;
    }
    if (router.canGoBack()) router.back();
    else if (project) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
    } else router.replace("/projects");
  };

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!directory) return false;
          setDirectory(parentProjectDirectory(directory));
          return true;
        },
      );
      return () => subscription.remove();
    }, [directory]),
  );

  const openFile = (file: ProjectFileEntry) => {
    router.push({
      pathname: "/project-files/[projectId]/[resourceId]",
      params: { projectId, resourceId: file.resource.id },
    });
  };

  const openNameSheet = (
    operation: "create-file" | "create-directory" | "rename",
    entry?: ProjectExplorerEntry,
  ) => {
    setName(operation === "rename" && entry ? entry.name : "");
    setSheet({ kind: "name", operation, ...(entry ? { entry } : {}) });
  };

  const reviewProposal = async (proposalId: string) => {
    await applyProposal(proposalId);
    setSheet(null);
    router.push({
      pathname: "/changes/[proposalId]",
      params: { proposalId, origin: "project" },
    });
  };

  const submitName = async () => {
    if (!sheet || sheet.kind !== "name" || busy) return;
    setBusy(true);
    try {
      const proposal =
        sheet.operation === "rename" && sheet.entry
          ? renameProjectEntry({ projectId, entry: sheet.entry, name })
          : createProjectEntry({
              projectId,
              directory,
              name,
              kind:
                sheet.operation === "create-directory" ? "directory" : "file",
            });
      await reviewProposal(proposal.id);
    } catch (error) {
      Alert.alert(
        t("project.explorer.operationFailed"),
        localizedErrorMessage(error, t("project.explorer.tryAgain")),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (entry: ProjectExplorerEntry) => {
    setSheet(null);
    Alert.alert(
      t("project.explorer.deleteTitle", { name: entry.name }),
      t(
        entry.kind === "directory"
          ? "project.explorer.deleteDirectoryDetail"
          : "project.explorer.deleteFileDetail",
      ),
      [
        { text: t("project.explorer.cancel"), style: "cancel" },
        {
          text: t("project.explorer.delete"),
          style: "destructive",
          onPress: () => {
            if (busy) return;
            setBusy(true);
            try {
              const proposal = deleteProjectEntry({ projectId, entry });
              void reviewProposal(proposal.id)
                .catch((error: unknown) => {
                  Alert.alert(
                    t("project.explorer.operationFailed"),
                    localizedErrorMessage(
                      error,
                      t("project.explorer.tryAgain"),
                    ),
                  );
                })
                .finally(() => setBusy(false));
            } catch (error) {
              setBusy(false);
              Alert.alert(
                t("project.explorer.operationFailed"),
                localizedErrorMessage(error, t("project.explorer.tryAgain")),
              );
            }
          },
        },
      ],
    );
  };

  if (!project) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={returnToPrevious}
          palette={palette}
          title={t("project.explorer.files")}
        />
        <View style={styles.centeredState}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {t("project.explorer.notFound")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderEntry = ({ item }: { item: ProjectExplorerEntry }) => (
    <ListRow
      icon={
        item.kind === "directory"
          ? "folder-outline"
          : projectFileIcon(item.path)
      }
      onPress={() => {
        if (item.kind === "directory") {
          setDirectory(item.path);
        } else {
          openFile(item);
        }
      }}
      onLongPress={() => setSheet({ kind: "entry", entry: item })}
      palette={palette}
      title={item.name}
    />
  );

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={returnToPrevious}
        palette={palette}
        title={t("project.explorer.files")}
        right={
          <IconButton
            disabled={busy}
            icon="add"
            label={t("project.explorer.create")}
            onPress={() => setSheet({ kind: "create" })}
            palette={palette}
          />
        }
      />
      <BottomSheet
        onClose={() => setSheet(null)}
        palette={palette}
        title={
          sheet?.kind === "entry"
            ? sheet.entry.name
            : sheet?.kind === "name"
              ? t(
                  sheet.operation === "rename"
                    ? "project.explorer.rename"
                    : sheet.operation === "create-directory"
                      ? "project.explorer.newDirectory"
                      : "project.explorer.newFile",
                )
              : t("project.explorer.create")
        }
        visible={sheet !== null}
      >
        {sheet?.kind === "create" ? (
          <View>
            <ListRow
              icon="document-outline"
              onPress={() => openNameSheet("create-file")}
              palette={palette}
              title={t("project.explorer.newFile")}
            />
            <ListRow
              icon="folder-outline"
              onPress={() => openNameSheet("create-directory")}
              palette={palette}
              title={t("project.explorer.newDirectory")}
            />
          </View>
        ) : null}
        {sheet?.kind === "entry" ? (
          <View>
            <ListRow
              icon="create-outline"
              onPress={() => openNameSheet("rename", sheet.entry)}
              palette={palette}
              title={t("project.explorer.rename")}
            />
            <ListRow
              destructive
              icon="trash-outline"
              onPress={() => confirmDelete(sheet.entry)}
              palette={palette}
              title={t("project.explorer.delete")}
            />
          </View>
        ) : null}
        {sheet?.kind === "name" ? (
          <View style={styles.form}>
            <TextInput
              accessibilityLabel={t("project.explorer.name")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setName}
              onSubmitEditing={() => void submitName()}
              placeholder={t("project.explorer.namePlaceholder")}
              placeholderTextColor={palette.textTertiary}
              returnKeyType="done"
              selectTextOnFocus={sheet.operation === "rename"}
              style={[
                styles.input,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
              value={name}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !name.trim()}
              onPress={() => void submitName()}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: palette.text },
                (busy || !name.trim()) && { opacity: 0.35 },
                pressed && { opacity: 0.65 },
              ]}
            >
              <Text style={[styles.submitText, { color: palette.background }]}>
                {busy
                  ? t("project.explorer.applying")
                  : t("project.explorer.save")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheet>
      <FlatList
        contentContainerStyle={styles.content}
        data={entries}
        keyExtractor={(item) => {
          if (item.kind === "directory") return `directory:${item.path}`;
          return `file:${item.resource.id}`;
        }}
        ListEmptyComponent={
          <View style={styles.centeredState}>
            <Ionicons
              color={palette.textTertiary}
              name="folder-open-outline"
              size={26}
            />
            <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>
              {t("project.explorer.noFiles")}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <ScrollView
            contentContainerStyle={styles.breadcrumbs}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <Pressable
              accessibilityLabel={t("project.explorer.openRoot")}
              accessibilityRole="button"
              onPress={() => setDirectory("")}
              style={({ pressed }) => [
                styles.breadcrumb,
                pressed && { opacity: 0.55 },
              ]}
            >
              <Ionicons
                color={palette.textSecondary}
                name="folder-open-outline"
                size={15}
              />
              <Text
                style={[
                  styles.breadcrumbText,
                  { color: directory ? palette.textSecondary : palette.text },
                ]}
              >
                {t("project.explorer.root")}
              </Text>
            </Pressable>
            {breadcrumbSegments.map((segment) => (
              <View key={segment.path} style={styles.breadcrumbGroup}>
                <Ionicons
                  color={palette.textTertiary}
                  name="chevron-forward"
                  size={14}
                />
                <Pressable
                  accessibilityLabel={t("project.explorer.openDirectory", {
                    path: segment.path,
                  })}
                  accessibilityRole="button"
                  onPress={() => setDirectory(segment.path)}
                  style={({ pressed }) => [
                    styles.breadcrumb,
                    pressed && { opacity: 0.55 },
                  ]}
                >
                  <Text
                    style={[
                      styles.breadcrumbText,
                      {
                        color:
                          segment.path === directory
                            ? palette.text
                            : palette.textSecondary,
                      },
                    ]}
                  >
                    {segment.name}
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        }
        renderItem={renderEntry}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 180,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { fontSize: 14, fontWeight: "500", textAlign: "center" },
  breadcrumbs: {
    alignItems: "center",
    minHeight: 48,
    paddingRight: spacing.md,
  },
  breadcrumbGroup: { alignItems: "center", flexDirection: "row" },
  breadcrumb: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 44,
    paddingHorizontal: spacing.xxs,
  },
  breadcrumbText: { fontSize: 13, fontWeight: "500" },
  form: { gap: spacing.md },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  submit: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  submitText: { fontSize: 15, fontWeight: "700" },
});
