import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markdownPreviewText } from "@/components/markdown-policy";
import { resolveProjectWorkspaceContext } from "@/application/project-workspace-context";
import {
  IconButton,
  ListRow,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import { RecentConversationRow } from "@/features/home/recent-conversation-row";
import {
  getConversationTitle,
  getLatestProposalForProject,
  getMemoryCatalog,
  getProjectConversationIds,
  getSkillCatalog,
} from "@/domain/app-state";
import { summarizeProjectConnections } from "@/domain/google-workspace-connections";
import { getProjectH5Apps } from "@/domain/project-h5-apps";
import { enabledProjectResourcePacks } from "@/domain/builtin-project-resources";
import { isProjectWorkspaceConnectionId } from "@/domain/project-workspace";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectProjectDetailState = createAppStateFieldsSelector(
  "activeRunsByConversation",
  "connections",
  "conversationIdsByProject",
  "conversationProjectIds",
  "customGlobalMemories",
  "customGlobalSkills",
  "globalMemoryTextById",
  "globalSkillContentById",
  "messagesByConversation",
  "pinnedProjectIds",
  "projectResourcePackEnabledByProjectId",
  "projectSkillEnabledByProjectId",
  "projects",
  "proposals",
  "recentConversationIds",
  "resources",
  "skillEnabledById",
);

function createProjectConversationId(projectId: string) {
  return `conversation-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProjectDetailScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { deleteConversation, dispatch } = useAppActions();
  const state = useAppStateSelector(selectProjectDetailState);
  const mcpConnectionItems = useSessionStateSelector(
    (session) => session.mcpConnectionItems,
  );
  const project = state.projects[projectId];
  const isPinned = state.pinnedProjectIds.includes(projectId);
  const memoryCatalog = getMemoryCatalog(state);
  const skillCatalog = getSkillCatalog(state, locale);
  const workspaceContext = project
    ? resolveProjectWorkspaceContext({
        project,
        resources: Object.values(state.resources),
        memories: memoryCatalog,
        skills: skillCatalog,
        enabledById: state.skillEnabledById,
        projectEnabledById: state.projectSkillEnabledByProjectId[project.id],
      })
    : null;
  const conversationIds = project
    ? getProjectConversationIds(state, project.id)
    : [];
  const latestProposal = project
    ? getLatestProposalForProject(state, project.id)
    : undefined;
  const resolvedProjectId = project?.id;
  const projectH5Apps = useMemo(
    () =>
      project
        ? getProjectH5Apps(Object.values(state.resources), project.id)
        : [],
    [project, state.resources],
  );
  const visibleConversationIds = conversationIds.slice(0, 5);
  const enabledResourcePackCount = project
    ? enabledProjectResourcePacks(
        state.projectResourcePackEnabledByProjectId,
        project.id,
      ).length
    : 0;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  useFocusEffect(
    useCallback(() => {
      if (!resolvedProjectId) return;
      dispatch({ type: "project/opened", projectId: resolvedProjectId });
    }, [dispatch, resolvedProjectId]),
  );

  if (!project) {
    return (
      <View
        style={[
          styles.safeArea,
          {
            backgroundColor: palette.background,
            marginTop: insets.top,
          },
        ]}
      >
        <ScreenHeader
          onBack={goBack}
          palette={palette}
          title={t("project.detail.notFound")}
        />
        <View style={styles.notFound}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {t("project.detail.couldNotOpen")}
          </Text>
          <Text style={[styles.emptyDetail, { color: palette.textSecondary }]}>
            {t("project.detail.invalidLink")}
          </Text>
        </View>
      </View>
    );
  }

  const startChat = () => {
    const conversationId = createProjectConversationId(project.id);
    dispatch({
      type: "chat/new-project",
      projectId: project.id,
      conversationId,
    });
    router.push({
      pathname: "/conversation/[conversationId]",
      params: {
        projectId: project.id,
        conversationId,
        discardIfEmpty: "1",
      },
    });
  };

  const openConversation = (conversationId: string) => {
    dispatch({
      type: "chat/open-conversation",
      projectId: project.id,
      conversationId,
    });
    router.push({
      pathname: "/conversation/[conversationId]",
      params: { projectId: project.id, conversationId },
    });
  };

  const requestConversationDelete = (conversationId: string, title: string) => {
    const running = Boolean(state.activeRunsByConversation[conversationId]);
    Alert.alert(
      t("project.detail.delete.title"),
      running
        ? t("project.detail.delete.confirmRunning", { title })
        : t("project.detail.delete.confirmIdle", { title }),
      [
        { text: t("project.common.cancel"), style: "cancel" },
        {
          text: t("project.common.delete"),
          style: "destructive",
          onPress: () => {
            void deleteConversation(conversationId).catch((error: unknown) => {
              Alert.alert(
                t("project.detail.delete.couldNot"),
                localizedErrorMessage(error, t("project.common.retry")),
              );
            });
          },
        },
      ],
    );
  };

  const openFiles = () => {
    router.push({
      pathname: "/project-files/[projectId]",
      params: { projectId: project.id },
    });
  };

  const sharedConnectionCount = summarizeProjectConnections(
    Object.values(state.connections).filter(
      (connection) => !isProjectWorkspaceConnectionId(connection.id),
    ),
    project.id,
  ).length;
  const projectMemoryCount =
    workspaceContext?.memories.filter((memory) => memory.scope === "project")
      .length ?? 0;
  const projectMcpCount = mcpConnectionItems.filter(
    (connection) => connection.enabled,
  ).length;

  return (
    // This route is retained by the drawer. Applying the top inset directly
    // avoids a native SafeAreaView/layout feedback loop under Fabric.
    <View
      style={[
        styles.safeArea,
        {
          backgroundColor: palette.background,
          marginTop: insets.top,
        },
      ]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        right={
          <View style={styles.headerActions}>
            <IconButton
              icon={isPinned ? "pin" : "pin-outline"}
              label={t(
                isPinned ? "project.detail.unpin" : "project.detail.pin",
                { name: project.name },
              )}
              onPress={() =>
                dispatch({
                  type: "project/set-pinned",
                  projectId: project.id,
                  pinned: !isPinned,
                })
              }
              palette={palette}
            />
            <IconButton
              icon="folder-open-outline"
              label={t("project.detail.viewFiles", { name: project.name })}
              onPress={openFiles}
              palette={palette}
            />
          </View>
        }
        title={project.name}
      />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustKeyboardInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 112 + insets.bottom },
        ]}
        removeClippedSubviews={Platform.OS === "android"}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel palette={palette}>
          {t("project.detail.conversations.recent")}
        </SectionLabel>
        {conversationIds.length ? (
          <View
            style={[
              styles.conversationGroup,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            {visibleConversationIds.map((conversationId, index) => {
              const pendingProposals = Object.values(state.proposals).filter(
                (item) =>
                  item.conversationId === conversationId &&
                  item.status === "pending",
              ).length;
              const running = Boolean(
                state.activeRunsByConversation[conversationId],
              );
              const title =
                markdownPreviewText(
                  getConversationTitle(state, conversationId),
                ) || t("project.detail.conversations.new");
              return (
                <RecentConversationRow
                  detail={
                    pendingProposals
                      ? t("project.detail.conversations.reviewPending")
                      : undefined
                  }
                  isLast={
                    index === visibleConversationIds.length - 1 &&
                    conversationIds.length <= 5
                  }
                  key={conversationId}
                  onPress={() => openConversation(conversationId)}
                  onDelete={() =>
                    requestConversationDelete(conversationId, title)
                  }
                  palette={palette}
                  running={running}
                  title={title}
                />
              );
            })}
            {conversationIds.length > 5 ? (
              <ListRow
                horizontalInset
                icon="ellipsis-horizontal"
                onPress={() =>
                  router.push({
                    pathname: "/conversations",
                    params: { projectId: project.id },
                  })
                }
                palette={palette}
                title={t("project.detail.conversations.viewAll")}
                value={`${conversationIds.length}`}
              />
            ) : null}
          </View>
        ) : (
          <View
            style={[styles.emptyConversations, { borderColor: palette.border }]}
          >
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {t("project.detail.conversations.empty")}
            </Text>
          </View>
        )}

        <SectionLabel palette={palette}>
          {t("project.detail.project")}
        </SectionLabel>
        {projectH5Apps.length ? (
          <ListRow
            detail={
              projectH5Apps.length === 1 ? projectH5Apps[0]!.title : undefined
            }
            icon="apps-outline"
            onPress={() =>
              router.push({
                pathname: "/project-h5/[projectId]",
                params: { projectId: project.id },
              })
            }
            palette={palette}
            title={t("project.detail.h5Apps")}
            value={`${projectH5Apps.length}`}
          />
        ) : null}
        <ListRow
          icon="images-outline"
          onPress={() =>
            router.push({
              pathname: "/project-resources/[projectId]" as never,
              params: { projectId: project.id },
            })
          }
          palette={palette}
          title={t("project.detail.resources")}
          value={`${enabledResourcePackCount}`}
        />
        <ListRow
          icon="options-outline"
          onPress={() =>
            router.push({
              pathname: "/library-detail",
              params: {
                kind: "instructions",
                itemId: project.id,
                projectId: project.id,
              },
            })
          }
          palette={palette}
          title={t("project.detail.instructions")}
        />
        <ListRow
          icon="sparkles-outline"
          onPress={() =>
            router.push({
              pathname: "/memory",
              params: { projectId: project.id },
            })
          }
          palette={palette}
          title={t("project.detail.memory")}
          value={`${projectMemoryCount}`}
        />
        <ListRow
          icon="extension-puzzle-outline"
          onPress={() =>
            router.push({
              pathname: "/skills",
              params: { projectId: project.id },
            })
          }
          palette={palette}
          title={t("project.detail.skills")}
          value={`${workspaceContext?.skills.filter((skill) => skill.enabled).length ?? 0}`}
        />
        <ListRow
          icon="git-network-outline"
          onPress={() => router.push("/mcp")}
          palette={palette}
          title={t("project.detail.mcp")}
          value={`${projectMcpCount}`}
        />
        <ListRow
          icon="link-outline"
          onPress={() =>
            router.push({
              pathname: "/connections",
              params: { projectId: project.id },
            })
          }
          palette={palette}
          title={t("project.detail.connections")}
          value={`${sharedConnectionCount}`}
        />
        {latestProposal ? (
          <>
            <SectionLabel palette={palette}>
              {t("project.detail.changes")}
            </SectionLabel>
            <ListRow
              icon="git-compare-outline"
              onPress={() =>
                router.push({
                  pathname: "/changes/[proposalId]",
                  params: {
                    proposalId: latestProposal.id,
                    origin: "project",
                  },
                })
              }
              palette={palette}
              title={
                markdownPreviewText(latestProposal.title) ||
                t(
                  latestProposal.kind === "restore"
                    ? "project.detail.proposal.restore"
                    : "project.detail.proposal.change",
                )
              }
              value={t(
                latestProposal.status === "applied"
                  ? "project.detail.proposal.applied"
                  : "project.detail.proposal.review",
              )}
            />
          </>
        ) : null}
      </ScrollView>
      <Pressable
        accessibilityLabel={t("project.detail.conversations.newInProject", {
          name: project.name,
        })}
        accessibilityRole="button"
        hitSlop={8}
        onPress={startChat}
        style={({ pressed }) => [
          styles.newConversationFab,
          {
            backgroundColor: palette.text,
            bottom: Math.max(spacing.lg, insets.bottom + spacing.sm),
            shadowColor: palette.text,
          },
          pressed && styles.newConversationFabPressed,
        ]}
      >
        <Ionicons color={palette.background} name="add" size={28} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: 112, paddingHorizontal: spacing.md },
  headerActions: { flexDirection: "row" },
  newConversationFab: {
    alignItems: "center",
    borderRadius: radii.pill,
    bottom: spacing.lg,
    elevation: 6,
    height: 56,
    justifyContent: "center",
    position: "absolute",
    right: spacing.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    width: 56,
  },
  newConversationFabPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  conversationGroup: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  emptyConversations: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  emptyTitle: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  emptyDetail: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  notFound: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
});
