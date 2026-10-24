import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  listProjectResourceDirectory,
  parentProjectResourceDirectory,
  type ProjectResourceExplorerEntry,
} from "@/application/project-resource-file-manager";
import { ListRow, ScreenHeader, type IconName } from "@/components/ui";
import {
  builtInProjectResourcePack,
  isBuiltInProjectResourcePackId,
} from "@/domain/builtin-project-resources";
import { useI18n } from "@/i18n/i18n-provider";
import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectProjectResourcePackState = createAppStateFieldsSelector("projects");

function fileIcon(path: string): IconName {
  if (/\.(?:png|jpe?g|gif|webp)$/iu.test(path)) return "image-outline";
  if (/\.(?:woff2?|ttf|otf)$/iu.test(path)) return "text-outline";
  if (/\.(?:css|json|xml|tmx|tsx)$/iu.test(path)) return "code-slash-outline";
  return "document-outline";
}

export function ProjectResourcePackScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId, packId } = useLocalSearchParams<{
    projectId: string;
    packId: string;
  }>();
  const state = useAppStateSelector(selectProjectResourcePackState);
  const project = state.projects[projectId];
  const pack = isBuiltInProjectResourcePackId(packId)
    ? builtInProjectResourcePack(packId)
    : undefined;
  const [directory, setDirectory] = useState("");
  const entries = useMemo(
    () => (pack ? listProjectResourceDirectory(pack, directory) : []),
    [directory, pack],
  );
  const breadcrumbs = directory
    ? directory.split("/").map((name, index, segments) => ({
        name,
        path: segments.slice(0, index + 1).join("/"),
      }))
    : [];
  const goBack = () => {
    if (directory) {
      setDirectory(parentProjectResourceDirectory(directory));
      return;
    }
    if (router.canGoBack()) router.back();
    else {
      router.replace({
        pathname: "/project-resources/[projectId]" as never,
        params: { projectId },
      });
    }
  };

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!directory) return false;
          setDirectory(parentProjectResourceDirectory(directory));
          return true;
        },
      );
      return () => subscription.remove();
    }, [directory]),
  );

  const renderEntry = ({ item }: { item: ProjectResourceExplorerEntry }) => (
    <ListRow
      detail={
        item.kind === "file" && "width" in item.file && "height" in item.file
          ? `${item.file.width} × ${item.file.height}`
          : undefined
      }
      icon={item.kind === "directory" ? "folder-outline" : fileIcon(item.path)}
      onPress={() => {
        if (item.kind === "directory") setDirectory(item.path);
        else {
          router.push({
            pathname:
              "/project-resources/[projectId]/[packId]/[fileIndex]" as never,
            params: {
              projectId,
              packId,
              fileIndex: String(item.fileIndex),
            },
          });
        }
      }}
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
        onBack={goBack}
        palette={palette}
        subtitle={project?.name}
        title={pack?.name ?? t("project.resourcePack.title")}
      />
      <FlatList
        contentContainerStyle={styles.content}
        data={project && pack ? entries : []}
        keyExtractor={(item) => `${item.kind}:${item.path}`}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              {t(
                project && pack
                  ? "project.resourcePack.empty"
                  : "project.resourcePack.missing",
              )}
            </Text>
          </View>
        }
        ListHeaderComponent={
          project && pack ? (
            <ScrollView
              contentContainerStyle={styles.breadcrumbs}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <Pressable
                accessibilityLabel={t("project.resourcePack.openRoot")}
                accessibilityRole="button"
                onPress={() => setDirectory("")}
                style={styles.breadcrumb}
              >
                <Ionicons
                  color={palette.textSecondary}
                  name="folder-open-outline"
                  size={15}
                />
                <Text style={[styles.breadcrumbText, { color: palette.text }]}>
                  {t("project.resourcePack.root")}
                </Text>
              </Pressable>
              {breadcrumbs.map((segment) => (
                <View key={segment.path} style={styles.breadcrumbGroup}>
                  <Ionicons
                    color={palette.textTertiary}
                    name="chevron-forward"
                    size={14}
                  />
                  <Pressable
                    accessibilityLabel={t(
                      "project.resourcePack.openDirectory",
                      { path: segment.path },
                    )}
                    accessibilityRole="button"
                    onPress={() => setDirectory(segment.path)}
                    style={styles.breadcrumb}
                  >
                    <Text
                      style={[styles.breadcrumbText, { color: palette.text }]}
                    >
                      {segment.name}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null
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
  empty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 180,
  },
  emptyText: { fontSize: 14 },
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
});
