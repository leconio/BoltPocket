import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListRow, ScreenHeader } from "@/components/ui";
import { getProjectH5Apps, type ProjectH5App } from "@/domain/project-h5-apps";
import {
  projectH5NetworkDeclarations,
  projectH5PermissionDeclarations,
} from "@/domain/project-h5-manifest";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

import { useBrowserActions } from "./browser-provider";
import { ProjectH5PermissionDetailsSheet } from "./project-h5-permission-sheet";

const selectH5AppHistoryState = createAppStateFieldsSelector(
  "projects",
  "recentProjectIds",
  "resources",
);

type H5AppHistoryItem = Readonly<{
  app: ProjectH5App;
  projectId: string;
  projectName: string;
}>;

export function H5AppHistoryScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { newPreviewTask } = useBrowserActions();
  const { createProjectPreview } = useAppActions();
  const state = useAppStateSelector(selectH5AppHistoryState);
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(
    null,
  );
  const [detailsItem, setDetailsItem] = useState<H5AppHistoryItem | null>(null);

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
  const items = useMemo(() => {
    const seen = new Set<string>();
    const orderedProjectIds = [
      ...state.recentProjectIds,
      ...Object.keys(state.projects).sort((left, right) =>
        state.projects[left]!.name.localeCompare(
          state.projects[right]!.name,
          "zh-CN",
        ),
      ),
    ].filter((projectId) => {
      if (seen.has(projectId) || !state.projects[projectId]) return false;
      seen.add(projectId);
      return true;
    });
    const resources = Object.values(state.resources);
    return orderedProjectIds.flatMap<H5AppHistoryItem>((projectId) => {
      const project = state.projects[projectId]!;
      return getProjectH5Apps(resources, projectId).map((app) => ({
        app,
        projectId,
        projectName: project.name,
      }));
    });
  }, [state.projects, state.recentProjectIds, state.resources]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const openApp = async (item: H5AppHistoryItem) => {
    if (openingResourceId) return;
    setOpeningResourceId(item.app.resourceId);
    let snapshot;
    try {
      snapshot = await createProjectPreview({
        projectId: item.projectId,
        resourceId: item.app.resourceId,
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
        title={t("browser.chrome.h5History")}
      />
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.app.resourceId}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              {t("project.h5.empty")}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListRow
            detail={`${item.projectName}\n${disclosureSummary(item.app)}`}
            icon="apps-outline"
            onPress={() => void openApp(item)}
            palette={palette}
            secondaryAction={{
              icon: "information-circle-outline",
              label: t("browser.chrome.miniAppPermissions"),
              onPress: () => {
                if (item.app.manifest) setDetailsItem(item);
                else {
                  Alert.alert(
                    t("browser.chrome.miniAppPermissions"),
                    t("browser.host.miniApp.invalidManifest"),
                  );
                }
              },
            }}
            title={item.app.title}
            value={
              openingResourceId === item.app.resourceId
                ? t("project.h5.opening")
                : undefined
            }
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {detailsItem?.app.manifest ? (
        <ProjectH5PermissionDetailsSheet
          manifest={detailsItem.app.manifest}
          onClose={() => setDetailsItem(null)}
          palette={palette}
          title={detailsItem.app.title}
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
