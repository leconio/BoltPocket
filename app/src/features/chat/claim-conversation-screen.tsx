import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListRow, ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectClaimConversationState = createAppStateFieldsSelector(
  "conversationProjectIds",
  "projects",
);

export function ClaimConversationScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{
    conversationId?: string;
  }>();
  const { claimConversation } = useAppActions();
  const state = useAppStateSelector(selectClaimConversationState);
  const resolvedConversationId =
    typeof conversationId === "string" ? conversationId : null;
  const conversationExists = Boolean(
    resolvedConversationId &&
    Object.hasOwn(state.conversationProjectIds, resolvedConversationId),
  );
  const canClaim =
    resolvedConversationId &&
    state.conversationProjectIds[resolvedConversationId] === null;
  const projects = Object.values(state.projects);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const claim = (projectId: string) => {
    if (!resolvedConversationId) return;
    try {
      claimConversation(resolvedConversationId, projectId);
      router.replace({
        pathname: "/conversation/[conversationId]",
        params: { conversationId: resolvedConversationId, projectId },
      });
    } catch (error) {
      Alert.alert(
        t("chat.claim.couldNot"),
        localizedErrorMessage(error, t("chat.common.tryAgainLater")),
      );
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
        title={t("chat.claim.title")}
      />
      {conversationExists && canClaim ? (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {projects.length ? (
            projects.map((project) => (
              <ListRow
                icon="folder-outline"
                key={project.id}
                onPress={() => claim(project.id)}
                palette={palette}
                title={project.name}
              />
            ))
          ) : (
            <View style={styles.empty}>
              <Text
                style={[styles.emptyText, { color: palette.textSecondary }]}
              >
                {t("chat.claim.noProjects")}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("chat.claim.unavailable")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { fontSize: 14 },
});
