import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";

import { chunkMarkdown } from "@/application/markdown-chunks";
import { MarkdownContent } from "@/components/markdown-content";
import { IconButton, ScreenHeader } from "@/components/ui";
import { AiGeneratedFooter } from "@/features/chat/ai-generated-footer";
import { ChatAttachmentPreview } from "@/features/chat/chat-attachment-preview";
import { labeledAiGeneratedText } from "@/domain/ai-content-label";
import { useI18n } from "@/i18n/i18n-provider";
import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectMessageDetailState = createAppStateFieldsSelector(
  "messagesByConversation",
);

export function MessageDetailScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { t } = useI18n();
  const { conversationId, messageId } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
  }>();
  const state = useAppStateSelector(selectMessageDetailState);
  const message =
    typeof conversationId === "string" && typeof messageId === "string"
      ? state.messagesByConversation[conversationId]?.find(
          (candidate) => candidate.id === messageId,
        )
      : undefined;
  const chunks = useMemo(
    () => (message ? chunkMarkdown(message.content) : []),
    [message],
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
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
          message ? (
            <View style={styles.headerActions}>
              <IconButton
                icon="copy-outline"
                label={
                  message.role === "assistant"
                    ? t("chat.detail.copyFullAnswerWithLabel")
                    : t("chat.detail.copyFullMessage")
                }
                onPress={() => {
                  void Clipboard.setStringAsync(
                    message.role === "assistant"
                      ? labeledAiGeneratedText(
                          message.content,
                          t("chat.detail.aiGeneratedContent"),
                        )
                      : message.content,
                  ).then(
                    () =>
                      Alert.alert(
                        t("chat.detail.copied"),
                        message.role === "assistant"
                          ? t("chat.detail.aiLabelCopied")
                          : t("chat.detail.fullMessageCopied"),
                      ),
                    () =>
                      Alert.alert(
                        t("chat.detail.copyFailed"),
                        t("chat.common.tryAgainLater"),
                      ),
                  );
                }}
                palette={palette}
              />
            </View>
          ) : null
        }
        title={t("chat.detail.fullAnswer")}
      />
      {message ? (
        <View style={styles.body}>
          <FlatList
            contentContainerStyle={styles.content}
            data={chunks}
            initialNumToRender={2}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyExtractor={(_, index) => `${message.id}:${index}`}
            ListFooterComponent={
              message.attachments?.length || message.role === "assistant" ? (
                <View style={styles.footer}>
                  {message.attachments?.length ? (
                    <ChatAttachmentPreview
                      attachments={message.attachments}
                      disabled
                      onOpenGeneratedMedia={(attachmentId) =>
                        router.push({
                          pathname: "/conversation/media" as never,
                          params: {
                            conversationId,
                            messageId,
                            attachmentId,
                          },
                        })
                      }
                      onRemove={() => undefined}
                      palette={palette}
                    />
                  ) : null}
                  {message.role === "assistant" ? (
                    <AiGeneratedFooter palette={palette} />
                  ) : null}
                </View>
              ) : null
            }
            maxToRenderPerBatch={2}
            removeClippedSubviews={Platform.OS === "android"}
            renderItem={({ item }) => (
              <MarkdownContent variant="detail">{item}</MarkdownContent>
            )}
            showsVerticalScrollIndicator={false}
            updateCellsBatchingPeriod={80}
            windowSize={5}
          />
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("chat.detail.answerMissing")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  body: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  footer: { gap: spacing.md, marginTop: spacing.lg },
  separator: { height: spacing.sm },
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { fontSize: 14 },
  headerActions: { alignItems: "center", flexDirection: "row" },
});
