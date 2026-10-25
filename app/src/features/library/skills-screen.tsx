import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Alert, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { projectWorkspaceSkills } from "@/application/project-workspace-context";
import { CapabilityRow } from "@/components/capability-row";
import { SwipeToUpdate } from "@/components/swipe-to-update";
import { IconButton, PageEmptyState, ScreenHeader } from "@/components/ui";
import { getSkillCatalog } from "@/domain/app-state";
import type { SkillItem } from "@/domain/models";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { DIRECT_SKILL_SOURCE_ID } from "@/infrastructure/capabilities/direct-skill-url";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectSkillsState = createAppStateFieldsSelector(
  "customGlobalSkills",
  "globalSkillContentById",
  "projectSkillEnabledByProjectId",
  "projects",
  "resources",
  "skillEnabledById",
);

export function SkillsScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId: routeProjectId } = useLocalSearchParams<{
    projectId?: string;
  }>();
  const { dispatch, updateDownloadedSkill } = useAppActions();
  const state = useAppStateSelector(selectSkillsState);
  const downloadedSkillItems = useSessionStateSelector(
    (session) => session.downloadedSkillItems,
  );
  const project = routeProjectId ? state.projects[routeProjectId] : undefined;
  const projectId = project?.id;
  const skillItems = useMemo(() => {
    const catalog = getSkillCatalog(state, locale);
    return projectId
      ? projectWorkspaceSkills({
          catalog,
          resources: Object.values(state.resources),
          enabledById: state.skillEnabledById,
          projectEnabledById: state.projectSkillEnabledByProjectId[projectId],
          projectId,
        })
      : catalog.filter((skill) => skill.scope === "global");
  }, [locale, projectId, state]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (projectId) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId },
      });
    } else {
      router.replace("/");
    }
  };

  const addSkill = () => {
    router.push({
      pathname: "/skills/add",
      params: projectId ? { projectId } : {},
    });
  };

  const openSkill = (skill: SkillItem) => {
    router.push({
      pathname: "/library-detail",
      params: {
        kind: "skill",
        itemId: skill.id,
        ...(projectId ? { projectId } : {}),
      },
    });
  };

  const updateDownloaded = (
    skill: SkillItem,
    downloadedProjectId: string | null,
  ) => {
    void updateDownloadedSkill(downloadedProjectId, skill.id)
      .then((result) =>
        Alert.alert(
          result === "updated"
            ? t("library.screen.skill.updateDone")
            : t("library.screen.skill.updateCurrent"),
        ),
      )
      .catch((error: unknown) =>
        Alert.alert(
          t("library.screen.skill.updateFailed"),
          localizedErrorMessage(error, t("library.common.retry")),
        ),
      );
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
        right={
          <IconButton
            icon="add"
            label={t("library.screen.skill.add")}
            onPress={addSkill}
            palette={palette}
          />
        }
        subtitle={project?.name}
        title={t(
          projectId
            ? "library.screen.kind.skills"
            : "library.screen.skill.globalTitle",
        )}
      />
      <FlatList
        contentContainerStyle={[
          styles.content,
          skillItems.length === 0 && styles.emptyContent,
        ]}
        data={skillItems}
        keyExtractor={(skill) => skill.id}
        ListEmptyComponent={
          <PageEmptyState
            description={t(
              projectId
                ? "library.screen.skill.emptyProject"
                : "library.screen.skill.emptyGlobal",
            )}
            palette={palette}
          />
        }
        renderItem={({ item: skill }) => {
          const enabled = projectId
            ? skill.enabled
            : Boolean(state.skillEnabledById[skill.id] ?? skill.enabled);
          const downloadedProjectId =
            skill.scope === "global" ? null : (projectId ?? null);
          const downloaded = downloadedSkillItems.find(
            (download) =>
              download.projectId === downloadedProjectId &&
              download.skillId === skill.id,
          );
          const row = (
            <CapabilityRow
              badge={t(`library.capabilities.risk.${skill.risk}`)}
              detail={skill.description}
              enabled={enabled}
              icon="extension-puzzle-outline"
              onPress={() => openSkill(skill)}
              onToggle={(value) =>
                dispatch(
                  projectId
                    ? {
                        type: "skill/set-enabled",
                        scope: "project",
                        projectId,
                        skillId: skill.id,
                        enabled: value,
                      }
                    : {
                        type: "skill/set-enabled",
                        scope: "global",
                        skillId: skill.id,
                        enabled: value,
                      },
                )
              }
              palette={palette}
              title={skill.name}
              toggleLabel={t(
                enabled
                  ? "library.screen.skill.enabled"
                  : "library.screen.skill.disabled",
                { name: skill.name },
              )}
            />
          );
          return downloaded &&
            downloaded.sourceId !== DIRECT_SKILL_SOURCE_ID ? (
            <SwipeToUpdate
              label={skill.name}
              onUpdate={() => updateDownloaded(skill, downloadedProjectId)}
              palette={palette}
            >
              {row}
            </SwipeToUpdate>
          ) : (
            row
          );
        }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  emptyContent: { flexGrow: 1 },
});
