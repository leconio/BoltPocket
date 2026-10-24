import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppSwitch, ScreenHeader, type IconName } from "@/components/ui";
import {
  BUILT_IN_PROJECT_RESOURCE_PACKS,
  isProjectResourcePackEnabled,
  type BuiltInProjectResourcePack,
} from "@/domain/builtin-project-resources";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette, type AppPalette } from "@/theme/tokens";

const selectProjectResourcesState = createAppStateFieldsSelector(
  "projectResourcePackEnabledByProjectId",
  "projects",
);

function packIcon(packId: BuiltInProjectResourcePack["id"]): IconName {
  if (packId === "bootstrap-icons") return "shapes-outline";
  if (packId === "kenney-ui") return "grid-outline";
  return "game-controller-outline";
}

const packDescriptionKeys: Record<
  BuiltInProjectResourcePack["id"],
  MessageKey
> = {
  "bootstrap-icons": "project.resources.description.bootstrapIcons",
  "kenney-1bit": "project.resources.description.kenney1Bit",
  "kenney-ui": "project.resources.description.kenneyUi",
};

function ResourcePackRow({
  enabled,
  onChange,
  onOpen,
  pack,
  palette,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  onOpen: () => void;
  pack: BuiltInProjectResourcePack;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Pressable
        accessibilityLabel={t("project.resources.viewPack", {
          name: pack.name,
        })}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.62 }]}
      >
        <View style={[styles.icon, { backgroundColor: palette.codeSurface }]}>
          <Ionicons
            color={palette.textSecondary}
            name={packIcon(pack.id)}
            size={18}
          />
        </View>
        <View style={styles.copy}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: palette.text }]}
          >
            {pack.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.detail, { color: palette.textSecondary }]}
          >
            {t(packDescriptionKeys[pack.id])} · {pack.license}
          </Text>
        </View>
        <Ionicons
          color={palette.textTertiary}
          name="chevron-forward"
          size={17}
        />
      </Pressable>
      <AppSwitch
        accessibilityLabel={t(
          enabled ? "project.resources.disable" : "project.resources.enable",
          { name: pack.name },
        )}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        ios_backgroundColor={palette.borderStrong}
        onValueChange={onChange}
        style={styles.switch}
        thumbColor={Platform.OS === "android" ? palette.surface : undefined}
        trackColor={{ false: palette.borderStrong, true: palette.accent }}
        value={enabled}
      />
    </View>
  );
}

export function ProjectResourcesScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { dispatch } = useAppActions();
  const state = useAppStateSelector(selectProjectResourcesState);
  const project = state.projects[projectId];
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (project) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
    } else router.replace("/projects");
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
        title={t("project.resources.title")}
      />
      {project ? (
        <View style={styles.content}>
          {BUILT_IN_PROJECT_RESOURCE_PACKS.map((pack) => (
            <ResourcePackRow
              enabled={isProjectResourcePackEnabled(
                state.projectResourcePackEnabledByProjectId,
                project.id,
                pack.id,
              )}
              key={pack.id}
              onChange={(enabled) =>
                dispatch({
                  type: "project-resource/set-enabled",
                  projectId: project.id,
                  packId: pack.id,
                  enabled,
                })
              }
              onOpen={() =>
                router.push({
                  pathname: "/project-resources/[projectId]/[packId]" as never,
                  params: { projectId: project.id, packId: pack.id },
                })
              }
              pack={pack}
              palette={palette}
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("project.resources.missing")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 70,
  },
  rowMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0,
    paddingVertical: spacing.sm,
  },
  icon: {
    alignItems: "center",
    borderRadius: 10,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, lineHeight: 17 },
  switch: { alignSelf: "center", flexShrink: 0, marginLeft: spacing.sm },
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { fontSize: 14 },
});
