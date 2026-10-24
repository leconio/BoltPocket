import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, FlatList, Platform, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { markdownPreviewText } from "@/components/markdown-policy";
import { ScreenHeader } from "@/components/ui";
import {
  getConversationPreview,
  getConversationTitle,
  getProjectConversationIds,
  getRecentConversationIds,
} from "@/domain/app-state";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

import { RecentConversationRow } from "./recent-conversation-row";

const selectConversationsState = createAppStateFieldsSelector(
  "activeRunsByConversation",
  "conversationIdsByProject",
  "conversationProjectIds",
  "messagesByConversation",
  "projects",
  "recentConversationIds",
);

export function ConversationsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { projectId: routeProjectId } = useLocalSearchParams<{
    projectId?: string;
  }>();
  const palette = useAppPalette();
  const { deleteConversation, dispatch } = useAppActions();
  const state = useAppStateSelector(selectConversationsState);
  const project = routeProjectId ? state.projects[routeProjectId] : undefined;
  const conversationIds = project
    ? getProjectConversationIds(state, project.id)
    : getRecentConversationIds(state);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (project) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId: project.id },
      });
    } else router.replace("/");
  };

  const openConversation = (conversationId: string) => {
    const projectId = state.conversationProjectIds[conversationId] ?? null;
    dispatch({ type: "chat/open-conversation", projectId, conversationId });
    router.push({
      pathname: "/conversation/[conversationId]",
      params: { conversationId, ...(projectId ? { projectId } : {}) },
    });
  };

  const requestDelete = (conversationId: string, title: string) => {
    const running = Boolean(state.activeRunsByConversation[conversationId]);
    Alert.alert(
      t("home.conversations.delete.title"),
      running
        ? t("home.conversations.delete.confirmRunning", { title })
        : t("home.conversations.delete.confirmIdle", { title }),
      [
        { text: t("home.conversations.delete.cancel"), style: "cancel" },
        {
          text: t("home.conversations.delete.delete"),
          style: "destructive",
          onPress: () => {
            void deleteConversation(conversationId).catch((error: unknown) => {
              Alert.alert(
                t("home.conversations.delete.couldNot"),
                localizedErrorMessage(
                  error,
                  t("home.conversations.delete.retry"),
                ),
              );
            });
          },
        },
      ],
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
        title={
          project
            ? t("home.conversations.project", { project: project.name })
            : t("home.conversations.all")
        }
      />
      {conversationIds.length ? (
        <FlatList
          data={conversationIds}
          initialNumToRender={12}
          keyExtractor={(conversationId) => conversationId}
          maxToRenderPerBatch={8}
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={({ item: conversationId, index }) => {
            const projectId =
              state.conversationProjectIds[conversationId] ?? null;
            const projectName = projectId
              ? state.projects[projectId]?.name
              : t("home.conversations.quick");
            const title =
              markdownPreviewText(
                getConversationTitle(state, conversationId),
              ) || t("home.conversations.new");
            return (
              <RecentConversationRow
                detail={[
                  projectName,
                  markdownPreviewText(
                    getConversationPreview(state, conversationId),
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                isLast={index === conversationIds.length - 1}
                onPress={() => openConversation(conversationId)}
                onDelete={() => requestDelete(conversationId, title)}
                palette={palette}
                running={Boolean(
                  state.activeRunsByConversation[conversationId],
                )}
                title={title}
              />
            );
          }}
          showsVerticalScrollIndicator={false}
          style={[
            styles.list,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
          updateCellsBatchingPeriod={16}
          windowSize={7}
        />
      ) : (
        <Text style={[styles.empty, { color: palette.textSecondary }]}>
          {t("home.conversations.empty")}
        </Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    margin: spacing.md,
    overflow: "hidden",
  },
  empty: { fontSize: 14, paddingTop: spacing.xxl, textAlign: "center" },
});
