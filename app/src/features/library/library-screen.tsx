import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LabeledTextField } from "@/components/labeled-text-field";
import { SearchField } from "@/components/search-field";
import {
  BottomSheet,
  IconButton,
  ListRow,
  PageEmptyState,
  Pill,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import { markdownPreviewText } from "@/components/markdown-policy";
import { projectWorkspaceMemoryItems } from "@/application/project-workspace-context";
import { resolveLibraryProject } from "@/application/library-scope";
import { getMemoryCatalog } from "@/domain/app-state";
import { summarizeProjectConnections } from "@/domain/google-workspace-connections";
import { isManualGlobalMemorySource } from "@/domain/library-catalog";
import type { ConnectionItem } from "@/domain/models";
import { isProjectWorkspaceConnectionId } from "@/domain/project-workspace";
import { LibraryProjectsList } from "@/features/library/library-projects-list";
import { LibrarySettingsList } from "@/features/library/library-settings-list";
import { useI18n } from "@/i18n/i18n-provider";
import {
  resolveMessageReference,
  type MessageKey,
  type MessageValues,
} from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

export type LibraryKind = "projects" | "memory" | "connections" | "settings";

const selectLibraryState = createAppStateFieldsSelector(
  "connections",
  "customGlobalMemories",
  "globalMemoryTextById",
  "projects",
  "resources",
  "selectedProjectId",
);

const titleKeys: Record<LibraryKind, MessageKey> = {
  projects: "library.screen.kind.projects",
  memory: "library.screen.kind.memory",
  connections: "library.screen.kind.connections",
  settings: "library.screen.kind.settings",
};

function connectionPresentation(
  connection: ConnectionItem,
  t: (key: MessageKey, values?: MessageValues) => string,
) {
  const google = /^google-(?:docs|sheets|slides)-/u.test(connection.id);
  const notion = connection.id.startsWith("notion-");
  const deviceText = connection.id.startsWith("device-text-");
  const projectSource = connection.id.startsWith("github-source-");
  const projectReports = connection.id.startsWith("project-reports-");
  return {
    name: deviceText
      ? t("library.screen.connection.name.deviceText")
      : projectSource
        ? t("library.screen.connection.name.projectSource")
        : projectReports
          ? t("library.screen.connection.name.projectReports")
          : connection.name,
    account: projectReports
      ? t("library.screen.connection.account.local")
      : connection.account,
    scope: google
      ? t(
          connection.resourceCount === 0
            ? "library.screen.connection.scope.googleServices"
            : "library.screen.connection.scope.googleFiles",
          { count: connection.resourceCount },
        )
      : notion && connection.resourceCount > 1
        ? t("library.screen.connection.scope.notionPages", {
            count: connection.resourceCount,
          })
        : projectReports
          ? t("library.screen.connection.scope.reports")
          : connection.scope,
    verification: projectReports
      ? t("library.screen.connection.verification.recovery")
      : connection.verification,
  };
}

export function LibraryScreen({ kind }: { kind: LibraryKind }) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { create: createProjectParam, projectId: routeProjectId } =
    useLocalSearchParams<{
      create?: string;
      projectId?: string;
    }>();
  const { createProject } = useAppActions();
  const state = useAppStateSelector(selectLibraryState);
  const projectItems = useMemo(
    () => Object.values(state.projects),
    [state.projects],
  );
  const scopedProject = resolveLibraryProject(state.projects, routeProjectId);
  const scopedProjectId = scopedProject?.id ?? null;
  const [query, setQuery] = useState("");
  const [selectedMemoryScope, setMemoryScope] = useState<"global" | "project">(
    scopedProjectId ? "project" : "global",
  );
  const memoryScope = scopedProjectId ? selectedMemoryScope : "global";
  const [projectEditorVisible, setProjectEditorVisible] = useState(
    kind === "projects" && createProjectParam === "1",
  );
  const [projectName, setProjectName] = useState("");
  const memoryCatalog = getMemoryCatalog(state);

  const scopedMemoryItems = scopedProject
    ? projectWorkspaceMemoryItems(
        Object.values(state.resources),
        scopedProject.id,
      )
    : [];
  const visibleMemoryItems = (
    memoryScope === "global"
      ? memoryCatalog.filter((memory) => memory.scope === "global")
      : scopedMemoryItems
  ).filter((memory) => memory.text.toLowerCase().includes(query.toLowerCase()));
  const visibleConnections = summarizeProjectConnections(
    Object.values(state.connections).filter(
      (connection) => !isProjectWorkspaceConnectionId(connection.id),
    ),
    scopedProjectId,
  )
    .map((connection) => ({
      connection,
      presentation: connectionPresentation(connection, t),
    }))
    .filter(({ presentation }) =>
      `${presentation.name} ${presentation.account}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (routeProjectId && scopedProject) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: scopedProject.id },
      });
      return;
    }
    router.replace("/");
  };

  const selectProject = (projectId: string) => {
    router.push({
      pathname: "/project/[projectId]",
      params: { projectId },
    });
  };

  const filteredProjects = useMemo(
    () =>
      projectItems.filter((project) =>
        project.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [projectItems, query],
  );

  const addItem = () => {
    if (kind === "projects") {
      setProjectName("");
      setProjectEditorVisible(true);
      return;
    }
    if (kind === "connections" && scopedProjectId) {
      router.push({
        pathname: "/connections/add",
        params: { projectId: scopedProjectId },
      });
      return;
    }
    if (kind === "memory") {
      router.push({
        pathname: "./library-create",
        params: {
          kind: "memory",
          scope: memoryScope,
          ...(memoryScope === "project" && scopedProjectId
            ? { projectId: scopedProjectId }
            : {}),
        },
      });
    }
  };

  const submitProject = () => {
    try {
      const project = createProject(projectName);
      setProjectEditorVisible(false);
      setProjectName("");
      router.push({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
    } catch (error) {
      Alert.alert(
        t("library.screen.newProjectFailed"),
        localizedErrorMessage(
          error,
          t("library.screen.projectInitializationFailed"),
        ),
      );
    }
  };

  const rightAction =
    kind === "projects" ||
    kind === "memory" ||
    (kind === "connections" && scopedProjectId) ? (
      <IconButton
        icon="add"
        label={t("library.screen.add", { kind: t(titleKeys[kind]) })}
        onPress={addItem}
        palette={palette}
      />
    ) : undefined;
  const searchHeader = (
    <View style={styles.searchWrap}>
      <SearchField
        accessibilityLabel={t("library.screen.search", {
          kind: t(titleKeys[kind]),
        })}
        onChangeText={setQuery}
        palette={palette}
        placeholder={t("library.screen.search", {
          kind: t(titleKeys[kind]),
        })}
        value={query}
      />
    </View>
  );

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        right={rightAction}
        subtitle={kind === "connections" ? scopedProject?.name : undefined}
        title={t(titleKeys[kind])}
      />
      {kind === "projects" ? (
        <LibraryProjectsList
          emptyDescription={t(
            query
              ? "library.screen.project.emptySearch"
              : "library.screen.project.empty",
          )}
          header={searchHeader}
          onSelect={selectProject}
          palette={palette}
          projects={filteredProjects}
          selectedProjectId={state.selectedProjectId}
        />
      ) : kind === "memory" ? (
        <FlatList
          contentContainerStyle={[
            styles.content,
            visibleMemoryItems.length === 0 && styles.emptyContent,
          ]}
          data={visibleMemoryItems}
          keyExtractor={(memory) => memory.id}
          keyboardDismissMode={
            process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <PageEmptyState
              description={t(
                query
                  ? "library.screen.memory.emptySearch"
                  : "library.screen.memory.empty",
              )}
              palette={palette}
            />
          }
          ListHeaderComponent={
            <>
              {searchHeader}
              {scopedProjectId ? (
                <View style={styles.pillRow}>
                  <Pill
                    onPress={() => setMemoryScope("project")}
                    palette={palette}
                    selected={memoryScope === "project"}
                  >
                    {t("library.common.currentProject")}
                  </Pill>
                  <Pill
                    onPress={() => setMemoryScope("global")}
                    palette={palette}
                    selected={memoryScope === "global"}
                  >
                    {t("library.common.global")}
                  </Pill>
                </View>
              ) : null}
              <SectionLabel palette={palette}>
                {memoryScope === "global"
                  ? t("library.common.global")
                  : (scopedProject?.name ?? t("library.common.currentProject"))}
              </SectionLabel>
            </>
          }
          renderItem={({ item: memory }) => (
            <ListRow
              detail={resolveMessageReference(
                memory.sourceMessage,
                memory.scope === "global" &&
                  memory.id.startsWith("global-memory-") &&
                  isManualGlobalMemorySource(memory.source)
                  ? t("library.screen.memory.source.manual")
                  : memory.source,
                t,
              )}
              icon={memory.pinned ? "bookmark" : "sparkles-outline"}
              onPress={() =>
                router.push({
                  pathname: "/library-detail",
                  params: {
                    kind: "memory",
                    itemId: memory.id,
                    ...(memory.scope === "project" && scopedProjectId
                      ? { projectId: scopedProjectId }
                      : {}),
                  },
                })
              }
              palette={palette}
              title={
                markdownPreviewText(memory.text) ||
                t("library.screen.emptyMemory")
              }
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      ) : kind === "connections" ? (
        <FlatList
          contentContainerStyle={[
            styles.content,
            visibleConnections.length === 0 && styles.emptyContent,
          ]}
          data={visibleConnections}
          keyExtractor={({ connection }) => connection.id}
          keyboardDismissMode={
            process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <PageEmptyState
              description={t(
                query
                  ? "library.screen.connection.emptySearch"
                  : "library.screen.connection.empty",
              )}
              palette={palette}
            />
          }
          ListHeaderComponent={
            <>
              {searchHeader}
              <SectionLabel palette={palette}>
                {t("library.screen.connection.connected")}
              </SectionLabel>
            </>
          }
          renderItem={({ item: { connection, presentation } }) => (
            <ListRow
              detail={presentation.account}
              icon="link-outline"
              onPress={() =>
                Alert.alert(
                  presentation.name,
                  t("library.screen.connection.accountDetails", {
                    access: t(
                      connection.access === "persistent"
                        ? "library.screen.connection.access.persistent"
                        : "library.screen.connection.access.session",
                    ),
                    account: presentation.account,
                    permission: t(
                      connection.writeMode === "read-only"
                        ? "library.screen.connection.permission.readOnly"
                        : "library.screen.connection.permission.write",
                    ),
                    scope: presentation.scope,
                    verification: presentation.verification
                      ? t("library.screen.connection.status", {
                          status: presentation.verification,
                        })
                      : "",
                  }),
                )
              }
              palette={palette}
              title={presentation.name}
              value={t(
                connection.status === "connected"
                  ? "library.screen.connection.value.connected"
                  : "library.screen.connection.value.needsAttention",
              )}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <LibrarySettingsList palette={palette} projectId={scopedProjectId} />
        </ScrollView>
      )}
      <BottomSheet
        onClose={() => setProjectEditorVisible(false)}
        palette={palette}
        title={t("library.screen.newProject")}
        visible={projectEditorVisible}
      >
        <LabeledTextField
          autoFocus
          label={t("library.screen.projectName")}
          maxLength={80}
          onChangeText={setProjectName}
          onSubmitEditing={submitProject}
          placeholder={t("library.screen.projectName")}
          returnKeyType="done"
          value={projectName}
        />
        <Pressable
          accessibilityLabel={t("library.screen.createProjectAccessibility")}
          accessibilityRole="button"
          disabled={!projectName.trim()}
          onPress={submitProject}
          style={({ pressed }) => [
            styles.createProjectButton,
            { backgroundColor: palette.text },
            !projectName.trim() && { opacity: 0.35 },
            pressed && { opacity: 0.72 },
          ]}
        >
          <Text
            style={[
              styles.createProjectButtonText,
              { color: palette.background },
            ]}
          >
            {t("library.screen.createProject")}
          </Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  emptyContent: { flexGrow: 1 },
  searchWrap: { marginTop: spacing.md },
  pillRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  createProjectButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 48,
  },
  createProjectButtonText: { fontSize: 15, fontWeight: "600" },
});
