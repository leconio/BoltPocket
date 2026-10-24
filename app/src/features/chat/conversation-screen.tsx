import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ui";
import { LoadingIndicator } from "@/components/loading-indicator";
import { isUntouchedConversation } from "@/domain/app-state";
import { useI18n } from "@/i18n/i18n-provider";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
  useAppStateSnapshot,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

import { ChatScreen } from "./chat-screen";

const selectConversationRouteState = createAppStateFieldsSelector(
  "activeConversationId",
  "activeRunsByConversation",
  "conversationProjectIds",
  "messagesByConversation",
  "projects",
);

export function ConversationScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const {
    conversationId,
    discardIfEmpty,
    projectId: routeProjectId,
  } = useLocalSearchParams<{
    conversationId: string;
    discardIfEmpty?: string;
    projectId?: string;
  }>();
  const { deleteConversation, dispatch } = useAppActions();
  const state = useAppStateSelector(selectConversationRouteState);
  const getAppStateSnapshot = useAppStateSnapshot();
  const wakeLockLeaseRef = useRef(0);
  const discardUntouchedRef = useRef(discardIfEmpty === "1");
  const hasConversation =
    Object.hasOwn(state.conversationProjectIds, conversationId) &&
    Object.hasOwn(state.messagesByConversation, conversationId);
  const projectId = hasConversation
    ? (state.conversationProjectIds[conversationId] ?? null)
    : null;
  const project = projectId ? state.projects[projectId] : undefined;
  const isValid = Boolean(
    hasConversation &&
    (!projectId || project) &&
    (routeProjectId === undefined || routeProjectId === projectId),
  );
  const conversationRunning = Boolean(
    state.activeRunsByConversation[conversationId],
  );

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (projectId) {
      router.replace({
        pathname: "/project/[projectId]",
        params: { projectId },
      });
      return;
    }
    router.replace("/");
  };

  useFocusEffect(
    useCallback(() => {
      if (!isValid || state.activeConversationId === conversationId) return;
      dispatch({ type: "chat/open-conversation", projectId, conversationId });
    }, [
      conversationId,
      dispatch,
      isValid,
      projectId,
      state.activeConversationId,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      if (discardIfEmpty !== "1") return;
      return () => {
        if (!discardUntouchedRef.current) return;
        discardUntouchedRef.current = false;
        if (!isUntouchedConversation(getAppStateSnapshot(), conversationId)) {
          return;
        }
        void deleteConversation(conversationId).catch(() => undefined);
      };
    }, [
      conversationId,
      deleteConversation,
      discardIfEmpty,
      getAppStateSnapshot,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!isValid || !conversationRunning) return;
      const tag = `boltpocket-conversation-${conversationId}-${++wakeLockLeaseRef.current}`;
      const activation = activateKeepAwakeAsync(tag).then(
        () => true,
        () => false,
      );

      return () => {
        void activation
          .then((activated) =>
            activated ? deactivateKeepAwake(tag) : undefined,
          )
          .catch(() => undefined);
      };
    }, [conversationId, conversationRunning, isValid]),
  );

  if (!isValid) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={goBack}
          palette={palette}
          title={t("chat.conversation.notFound")}
        />
        <View style={styles.stateBox}>
          <Text style={[styles.stateTitle, { color: palette.text }]}>
            {t("chat.conversation.couldNotOpen")}
          </Text>
          <Text style={[styles.stateDetail, { color: palette.textSecondary }]}>
            {t("chat.conversation.invalidDetail")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.activeConversationId !== conversationId) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.loading, { backgroundColor: palette.background }]}
      >
        <LoadingIndicator
          palette={palette}
          style={styles.loading}
          variant="screen"
        />
      </SafeAreaView>
    );
  }

  return <ChatScreen conversationId={conversationId} onBack={goBack} />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  stateBox: { alignItems: "center", flex: 1, padding: spacing.xl },
  stateTitle: { fontSize: 18, fontWeight: "600", marginTop: spacing.xxl },
  stateDetail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
