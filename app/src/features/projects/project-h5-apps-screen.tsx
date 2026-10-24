import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListRow, ScreenHeader } from "@/components/ui";
import { getProjectH5Apps, type ProjectH5App } from "@/domain/project-h5-apps";
import {
  projectH5NetworkDeclarations,
  projectH5PermissionDeclarations,
} from "@/domain/project-h5-manifest";
import { ProjectH5PermissionDetailsSheet } from "@/features/browser/project-h5-permission-sheet";
import { useBrowserActions } from "@/features/browser/browser-provider";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectProjectH5AppsState = createAppStateFieldsSelector(
  "projects",
  "resources",
);

export function ProjectH5AppsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { newPreviewTask } = useBrowserActions();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { createProjectPreview } = useAppActions();
  const state = useAppStateSelector(selectProjectH5AppsState);
  const project = state.projects[projectId];
  const apps = useMemo(
    () =>
      project
        ? getProjectH5Apps(Object.values(state.resources), project.id)
        : [],
    [project, state.resources],
  );
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(
    null,
  );
  const [detailsApp, setDetailsApp] = useState<ProjectH5App | null>(null);

  const disclosureSummary = (app: ProjectH5App) => {
    if (!app.manifest) return t("browser.host.miniApp.invalidManifest");
    const permissionCount = projectH5PermissionDeclarations(
      app.manifest,
    ).length;
    const networkCount = projectH5NetworkDeclarations(app.manifest).length;
    return [
      permissionCount === 0
        ? t("browser.host.miniApp.noDevicePermissions")
        : t("browser.host.miniApp.permissionCount", {
            count: permissionCount,
          }),
      networkCount === 0
        ? t("browser.host.miniApp.noNetwork")
        : t("browser.host.miniApp.networkCount", { count: networkCount }),
    ].join(" · ");
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (project) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
    } else router.replace("/projects");
  };

  const openApp = async (app: ProjectH5App) => {
    if (!project || openingResourceId) return;
    setOpeningResourceId(app.resourceId);
    let snapshot;
    try {
      snapshot = await createProjectPreview({
        projectId: project.id,
        resourceId: app.resourceId,
      });
      newPreviewTask(snapshot, true);
    } catch (error) {
      if (snapshot) {
        await Promise.resolve(
          projectPreviewSnapshots.release(snapshot.id),
        ).catch(() => undefined);
      }
      Alert.alert(
        t("project.h5.openFailed"),
        localizedErrorMessage(error, t("project.common.retry")),
      );
    } finally {
      setOpeningResourceId(null);
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
        subtitle={project?.name}
        title={t("project.h5.title")}
      />
      <FlatList
        contentContainerStyle={styles.content}
        data={apps}
        keyExtractor={(app) => app.resourceId}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              {t(project ? "project.h5.empty" : "project.h5.notFound")}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListRow
            detail={`${item.address}\n${disclosureSummary(item)}`}
            icon="apps-outline"
            onPress={() => void openApp(item)}
            palette={palette}
            secondaryAction={{
              icon: "information-circle-outline",
              label: t("browser.chrome.miniAppPermissions"),
              onPress: () => {
                if (item.manifest) setDetailsApp(item);
                else {
                  Alert.alert(
                    t("browser.chrome.miniAppPermissions"),
                    t("browser.host.miniApp.invalidManifest"),
                  );
                }
              },
            }}
            title={item.title}
            value={
              openingResourceId === item.resourceId
                ? t("project.h5.opening")
                : undefined
            }
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {detailsApp?.manifest ? (
        <ProjectH5PermissionDetailsSheet
          manifest={detailsApp.manifest}
          onClose={() => setDetailsApp(null)}
          palette={palette}
          title={detailsApp.title}
          visible
        />
      ) : null}
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
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { fontSize: 14 },
});
