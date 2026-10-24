import Ionicons from "@react-native-vector-icons/ionicons";
import { useNavigation, useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton, type IconName } from "@/components/ui";
import { getPinnedProjects, getRecentProjects } from "@/domain/app-state";
import type { Project } from "@/domain/models";
import { useI18n } from "@/i18n/i18n-provider";
import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const HOME_ITEM_LIMIT = 5;
const selectHomeState = createAppStateFieldsSelector(
  "pinnedProjectIds",
  "projects",
  "recentProjectIds",
);

export function HomeScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const router = useRouter();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const state = useAppStateSelector(selectHomeState);
  const pinnedProjects = getPinnedProjects(state);
  const recentProjects = getRecentProjects(state);
  const visibleProjects = recentProjects.slice(0, HOME_ITEM_LIMIT);

  const openDrawer = () =>
    (navigation as unknown as { openDrawer: () => void }).openDrawer();

  const openNewProject = () =>
    router.push({ pathname: "/projects", params: { create: "1" } });

  const openAllProjects = () => router.push("/projects");

  const openProject = (projectId: string) => {
    router.push({
      pathname: "/project/[projectId]",
      params: { projectId },
    });
  };

  return (
    // Keep only the top inset in JS: a native safe-area node inside the retained
    // drawer tree can enter a Fabric layout feedback loop.
    <View
      style={[
        styles.safeArea,
        {
          backgroundColor: palette.background,
          marginTop: insets.top,
        },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <IconButton
          icon="menu"
          label={t("home.screen.openDrawer")}
          onPress={openDrawer}
          palette={palette}
        />
        <Text numberOfLines={1} style={[styles.brand, { color: palette.text }]}>
          {t("common.brand.name")}
        </Text>
        <IconButton
          icon="add"
          label={t("home.screen.newProject")}
          onPress={openNewProject}
          palette={palette}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {pinnedProjects.length ? (
          <View style={styles.section}>
            <SectionTitle
              palette={palette}
              title={t("home.screen.pinnedProjects")}
            />
            <FlatList
              contentContainerStyle={styles.pinnedContent}
              data={pinnedProjects}
              horizontal
              keyExtractor={(project) => project.id}
              renderItem={({ item: project }) => (
                <PinnedProjectCard
                  onPress={() => openProject(project.id)}
                  palette={palette}
                  project={project}
                />
              )}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionTitle
            actionIcon="list-outline"
            actionLabel={t("home.screen.allProjects")}
            onAction={openAllProjects}
            palette={palette}
            title={t("home.screen.recentProjects")}
          />
          <View
            style={[
              styles.listCard,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {visibleProjects.length ? (
              visibleProjects.map((project, index) => (
                <RecentProjectRow
                  isLast={index === visibleProjects.length - 1}
                  key={project.id}
                  onPress={() => openProject(project.id)}
                  palette={palette}
                  project={project}
                />
              ))
            ) : (
              <EmptyRow
                icon="folder-open-outline"
                label={t("home.screen.newProject")}
                onPress={openNewProject}
                palette={palette}
              />
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionTitle({
  actionIcon,
  actionLabel,
  onAction,
  palette,
  title,
}: {
  actionIcon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  palette: ReturnType<typeof useAppPalette>;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <IconButton
          icon={actionIcon ?? "add"}
          label={actionLabel}
          onPress={onAction}
          palette={palette}
        />
      ) : null}
    </View>
  );
}

function PinnedProjectCard({
  onPress,
  palette,
  project,
}: {
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
  project: Project;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityLabel={t("home.screen.openProject", { name: project.name })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.pinnedCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <View style={[styles.symbol, { backgroundColor: palette.accentSoft }]}>
        <Text style={[styles.symbolText, { color: palette.accent }]}>
          {project.symbol}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={[styles.pinnedTitle, { color: palette.text }]}
      >
        {project.name}
      </Text>
      <Ionicons color={palette.textTertiary} name="pin" size={14} />
    </Pressable>
  );
}

function RecentProjectRow({
  isLast,
  onPress,
  palette,
  project,
}: {
  isLast: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
  project: Project;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityLabel={t("home.screen.openProject", { name: project.name })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.projectRow,
        !isLast && { borderBottomColor: palette.border, borderBottomWidth: 1 },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <View style={[styles.symbol, { backgroundColor: palette.codeSurface }]}>
        <Text style={[styles.symbolText, { color: palette.textSecondary }]}>
          {project.symbol}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.projectTitle, { color: palette.text }]}
      >
        {project.name}
      </Text>
      <Ionicons color={palette.textTertiary} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function EmptyRow({
  icon,
  label,
  onPress,
  palette,
}: {
  icon: "folder-open-outline";
  label: string;
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.emptyRow,
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <Ionicons color={palette.textSecondary} name={icon} size={18} />
      <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  brand: { flex: 1, fontSize: 20, fontWeight: "700", textAlign: "center" },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  section: { marginTop: spacing.xl },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  pinnedContent: { gap: spacing.sm, paddingRight: spacing.md },
  pinnedCard: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 76,
    padding: spacing.sm,
    width: 190,
  },
  pinnedTitle: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  listCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  projectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  symbol: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  symbolText: { fontSize: 11, fontWeight: "700" },
  projectTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  emptyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  emptyText: { fontSize: 14, fontWeight: "600" },
});
