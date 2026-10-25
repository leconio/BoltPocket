import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  type ListRenderItem,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import type { AppState } from "@/domain/app-state";
import type { UserChatAttachment } from "@/domain/models";
import type { AgentContextUsage } from "@/application/ports/agent-runtime";
import {
  contextUsageProgress,
  formatCompactTokenCount,
} from "@/application/conversation-context-usage";
import {
  shallowEqualAppStateSelection,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";
import { BottomSheet, IconButton, ListRow } from "@/components/ui";
import { ProgressRing } from "@/components/progress-ring";
import { markdownPreviewText } from "@/components/markdown-policy";
import { ChatComposer } from "@/features/chat/chat-composer";
import {
  EmptyChat,
  LiveRunActivity,
  RunningState,
} from "@/features/chat/chat-content";
import {
  ChatMessageRow,
  type ChatMessageRowCallbacks,
} from "@/features/chat/chat-message-row";
import {
  conversationMessages,
  transcriptIndex,
} from "@/features/chat/chat-transcript-index";
import {
  assertChatAttachmentCapacity,
  ChatFileAttachmentError,
} from "@/application/chat-file-attachment";
import {
  expoImageSelectionService,
  type ImageSelectionSource,
} from "@/infrastructure/media/expo-image-selection-service";
import { toChatImageAttachment } from "@/infrastructure/media/image-attachment";
import { imageAttachmentErrorKey } from "@/features/chat/image-attachment-picker";
import { useI18n } from "@/i18n/i18n-provider";
import { isMessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import { expoChatFileSelectionService } from "@/infrastructure/media/expo-chat-file-selection-service";

type ActiveSheet = "context" | "conversation" | "attachments" | null;
type AttachmentAction = "image" | "camera" | "file" | null;
type ContextUsageSnapshot = {
  key: string;
  usage: AgentContextUsage;
};

type FollowMode = "following" | "detached" | "settling";

const EMPTY_DRAFT_ATTACHMENTS: readonly UserChatAttachment[] = Object.freeze(
  [],
);

function createChatScreenSelector(conversationId: string) {
  return (state: AppState) => {
    const transcript = transcriptIndex(
      conversationMessages(state, conversationId),
    );
    const projectId = state.conversationProjectIds[conversationId] ?? null;
    return {
      activeModelProfileId:
        state.conversationModelProfileIds[conversationId] ?? null,
      draftAttachments:
        state.activeConversationId === conversationId
          ? state.draftAttachments
          : EMPTY_DRAFT_ATTACHMENTS,
      isRunning: Boolean(state.activeRunsByConversation[conversationId]),
      messageIds: transcript.ids,
      project: projectId ? (state.projects[projectId] ?? null) : null,
      title: transcript.title,
    };
  };
}

function createChatFooterSelector(conversationId: string) {
  return (state: AppState) => ({
    autoApplyingChanges: state.autoApplyingProposalIds.some(
      (proposalId) =>
        state.proposals[proposalId]?.conversationId === conversationId,
    ),
    isRunning: Boolean(state.activeRunsByConversation[conversationId]),
    retryableRun: state.retryableRunsByConversation[conversationId],
    runError: state.runErrorsByConversation[conversationId] ?? null,
    storageError: state.storageError,
  });
}

function ChatListFooter({
  conversationId,
  hasMessages,
}: {
  conversationId: string;
  hasMessages: boolean;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const { cancelRun, retryRun } = useAppActions();
  const selector = useMemo(
    () => createChatFooterSelector(conversationId),
    [conversationId],
  );
  const state = useAppStateSelector(selector, shallowEqualAppStateSelection);
  if (
    !state.isRunning &&
    !state.autoApplyingChanges &&
    !state.runError &&
    !state.storageError
  ) {
    return null;
  }
  return (
    <View
      style={[styles.messageFooter, hasMessages ? styles.messageGap : null]}
    >
      {state.isRunning ? (
        <LiveRunActivity
          conversationId={conversationId}
          onStop={cancelRun}
          palette={palette}
        />
      ) : state.autoApplyingChanges ? (
        <RunningState
          palette={palette}
          status={t("chat.screen.applyChanges")}
        />
      ) : null}
      {state.runError ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.runErrorRow}
        >
          <Text selectable style={[styles.runError, { color: palette.danger }]}>
            {isMessageKey(state.runError) ? t(state.runError) : state.runError}
          </Text>
          {state.retryableRun ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void retryRun()}
              style={styles.retryButton}
            >
              <Text style={[styles.retryText, { color: palette.accent }]}>
                {t(
                  state.retryableRun.requiresAttachmentReselection
                    ? "chat.screen.restoreText"
                    : state.retryableRun.retryReason === "interrupted"
                      ? "chat.screen.resend"
                      : "chat.common.retry",
                )}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {state.storageError ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          selectable
          style={[styles.storageError, { color: palette.danger }]}
        >
          {state.storageError}
        </Text>
      ) : null}
    </View>
  );
}

function ChatListEmpty() {
  const palette = useAppPalette();
  const { dispatch } = useAppActions();
  const handlePrompt = useCallback(
    (prompt: string) => dispatch({ type: "draft/change", value: prompt }),
    [dispatch],
  );
  return <EmptyChat onPrompt={handlePrompt} palette={palette} />;
}

const messageIdKey = (messageId: string) => messageId;

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

export function ChatScreen({
  conversationId,
  onBack,
  headerAccessory,
}: {
  conversationId: string;
  onBack: () => void;
  headerAccessory?: ReactNode;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deleteConversation, dispatch, getConversationContextUsage } =
    useAppActions();
  const chatSelector = useMemo(
    () => createChatScreenSelector(conversationId),
    [conversationId],
  );
  const state = useAppStateSelector(
    chatSelector,
    shallowEqualAppStateSelection,
  );
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [contextUsageSnapshot, setContextUsageSnapshot] =
    useState<ContextUsageSnapshot | null>(null);
  const contextRequestSequence = useRef(0);
  const [attachmentAction, setAttachmentAction] =
    useState<AttachmentAction>(null);
  const pendingAttachmentActionRef = useRef<AttachmentAction>(null);
  const [disclosureScrollActive, setDisclosureScrollActive] = useState(false);
  const scrollRef = useRef<FlatList<string>>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const lastContentHeightRef = useRef(0);
  const lastViewportHeightRef = useRef(0);
  const followModeRef = useRef<FollowMode>("following");
  const activeModelProfileId = state.activeModelProfileId;
  const contextUsageKey = `${conversationId}:${activeModelProfileId ?? "default"}`;
  const contextUsage =
    contextUsageSnapshot?.key === contextUsageKey
      ? contextUsageSnapshot.usage
      : null;
  const contextProgress = contextUsage
    ? contextUsageProgress(contextUsage.usedTokens, contextUsage.contextWindow)
    : 0;
  const contextPercent = Math.round(contextProgress * 100);

  const refreshContextUsage = useCallback(
    async (showError: boolean) => {
      const request = (contextRequestSequence.current += 1);
      await Promise.resolve();
      if (contextRequestSequence.current !== request) return;
      try {
        const usage = await getConversationContextUsage(conversationId);
        if (contextRequestSequence.current === request) {
          setContextUsageSnapshot({ key: contextUsageKey, usage });
        }
      } catch (error) {
        if (showError && contextRequestSequence.current === request) {
          Alert.alert(
            t("chat.context.couldNotLoad"),
            localizedErrorMessage(error, t("chat.common.tryAgainLater")),
          );
        }
      }
    },
    [contextUsageKey, conversationId, getConversationContextUsage, t],
  );

  const scheduleScrollToEnd = useCallback(() => {
    if (
      followModeRef.current !== "following" ||
      scrollFrameRef.current !== null
    ) {
      return;
    }
    followModeRef.current = "settling";
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (followModeRef.current === "settling") {
        scrollRef.current?.scrollToEnd({ animated: false });
        followModeRef.current = "following";
      }
    });
  }, []);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (height <= lastContentHeightRef.current + 0.5) return;
      lastContentHeightRef.current = height;
      scheduleScrollToEnd();
    },
    [scheduleScrollToEnd],
  );

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (lastViewportHeightRef.current > 0) return;
      lastViewportHeightRef.current = height;
      scheduleScrollToEnd();
    },
    [scheduleScrollToEnd],
  );

  useEffect(() => {
    followModeRef.current = "following";
    lastContentHeightRef.current = 0;
    lastViewportHeightRef.current = 0;
    scheduleScrollToEnd();
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [conversationId, scheduleScrollToEnd]);

  useEffect(() => {
    if (state.isRunning) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      void refreshContextUsage(false);
    });
    return () => {
      task.cancel();
      contextRequestSequence.current += 1;
    };
  }, [
    refreshContextUsage,
    activeModelProfileId,
    state.isRunning,
    state.messageIds.length,
  ]);
  const project = state.project;
  const conversationTitle =
    markdownPreviewText(state.title) || t("chat.screen.newConversation");
  const addAttachment = (attachment: UserChatAttachment) =>
    dispatch({ type: "attachment/add", attachment });

  const showAttachmentError = (error: unknown) => {
    Alert.alert(
      t("chat.attachment.couldNotAdd"),
      error instanceof ChatFileAttachmentError
        ? localizedErrorMessage(error, t("chat.common.tryAgainLater"))
        : t(imageAttachmentErrorKey(error)),
    );
  };

  const pickImage = async (source: ImageSelectionSource) => {
    if (attachmentAction) return;
    try {
      assertChatAttachmentCapacity(state.draftAttachments);
      setActiveSheet(null);
      setAttachmentAction(source === "camera" ? "camera" : "image");
      const selected = await expoImageSelectionService.selectImage(source);
      if (!selected) return;
      const attachment = toChatImageAttachment(selected);
      assertChatAttachmentCapacity(state.draftAttachments, attachment);
      addAttachment(attachment);
    } catch (error) {
      showAttachmentError(error);
    } finally {
      setAttachmentAction(null);
    }
  };

  const pickFile = async () => {
    if (attachmentAction) return;
    try {
      assertChatAttachmentCapacity(state.draftAttachments);
      setActiveSheet(null);
      setAttachmentAction("file");
      const selected = await expoChatFileSelectionService.selectTextFile();
      if (!selected) return;
      assertChatAttachmentCapacity(state.draftAttachments, selected);
      addAttachment(selected);
    } catch (error) {
      Alert.alert(
        t("chat.attachment.couldNotAdd"),
        localizedErrorMessage(error, t("chat.attachment.couldNotReadFile")),
      );
    } finally {
      setAttachmentAction(null);
    }
  };

  const performAttachmentAction = (action: Exclude<AttachmentAction, null>) => {
    if (action === "file") {
      void pickFile();
      return;
    }
    void pickImage(action === "camera" ? "camera" : "library");
  };

  const requestAttachmentAction = (action: Exclude<AttachmentAction, null>) => {
    if (attachmentAction || pendingAttachmentActionRef.current) return;
    if (Platform.OS !== "ios") {
      performAttachmentAction(action);
      return;
    }

    // iOS cannot reliably present a photo, camera, or document controller
    // while the React Native Modal that owns this sheet is still dismissing.
    pendingAttachmentActionRef.current = action;
    setActiveSheet(null);
  };

  const performPendingAttachmentAction = () => {
    const action = pendingAttachmentActionRef.current;
    pendingAttachmentActionRef.current = null;
    if (action) performAttachmentAction(action);
  };

  const handleDisclosureInteraction = useCallback((active: boolean) => {
    if (active) followModeRef.current = "detached";
    setDisclosureScrollActive(active);
  }, []);
  const openFullContent = useCallback(
    (messageId: string) =>
      router.push({
        pathname: "./message",
        params: {
          conversationId,
          messageId,
        },
      }),
    [conversationId, router],
  );
  const openGeneratedMedia = useCallback(
    (messageId: string, attachmentId: string) =>
      router.push({
        pathname: "/conversation/media" as never,
        params: {
          conversationId,
          messageId,
          attachmentId,
        },
      }),
    [conversationId, router],
  );
  const openDiff = useCallback(
    (proposalId: string) =>
      router.push({
        pathname: "/changes/[proposalId]",
        params: { proposalId, origin: "conversation" },
      }),
    [router],
  );
  const openAttachments = useCallback(() => setActiveSheet("attachments"), []);

  const requestConversationDelete = () => {
    const running = state.isRunning;
    Alert.alert(
      t("chat.screen.delete.title"),
      running
        ? t("chat.screen.delete.confirmRunning")
        : t("chat.screen.delete.confirmIdle"),
      [
        { text: t("chat.common.cancel"), style: "cancel" },
        {
          text: t("chat.common.delete"),
          style: "destructive",
          onPress: () => {
            setActiveSheet(null);
            void deleteConversation(conversationId).then(
              () => {
                if (project) {
                  router.replace({
                    pathname: "/project/[projectId]",
                    params: { projectId: project.id },
                  });
                } else {
                  router.replace("/");
                }
              },
              (error: unknown) => {
                Alert.alert(
                  t("chat.screen.delete.couldNot"),
                  localizedErrorMessage(error, t("chat.common.tryAgainLater")),
                );
              },
            );
          },
        },
      ],
    );
  };
  const messageRowCallbacks = useMemo<ChatMessageRowCallbacks>(
    () => ({
      onDisclosureInteractionChange: handleDisclosureInteraction,
      onOpenDiff: openDiff,
      onOpenFullContent: openFullContent,
      onOpenGeneratedMedia: openGeneratedMedia,
    }),
    [
      handleDisclosureInteraction,
      openDiff,
      openFullContent,
      openGeneratedMedia,
    ],
  );
  const renderMessage = useCallback<ListRenderItem<string>>(
    ({ index, item: messageId }) => (
      <ChatMessageRow
        callbacks={messageRowCallbacks}
        conversationId={conversationId}
        first={index === 0}
        messageId={messageId}
      />
    ),
    [conversationId, messageRowCallbacks],
  );
  const footer = useMemo(
    () => (
      <ChatListFooter
        conversationId={conversationId}
        hasMessages={state.messageIds.length > 0}
      />
    ),
    [conversationId, state.messageIds.length],
  );
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { nativeEvent } = event;
      const distanceFromEnd =
        nativeEvent.contentSize.height -
        nativeEvent.layoutMeasurement.height -
        nativeEvent.contentOffset.y;
      followModeRef.current = distanceFromEnd < 96 ? "following" : "detached";
    },
    [],
  );
  const handleScrollBeginDrag = useCallback(() => {
    followModeRef.current = "detached";
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <View
          pointerEvents="box-none"
          style={[
            styles.topBarSurface,
            {
              backgroundColor: palette.background,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View style={styles.topBar}>
            <View style={styles.headerSide}>
              <IconButton
                icon="arrow-back"
                label={t("chat.screen.back")}
                onPress={onBack}
                palette={palette}
              />
            </View>
            <Pressable
              accessibilityLabel={
                project
                  ? t("chat.screen.openProject", { name: project.name })
                  : undefined
              }
              accessibilityRole="button"
              disabled={!project}
              onPress={() => {
                if (!project) return;
                router.push({
                  pathname: "/project/[projectId]",
                  params: { projectId: project.id },
                });
              }}
              style={({ pressed }) => [
                styles.titleButton,
                pressed && { backgroundColor: palette.codeSurface },
              ]}
            >
              <View style={styles.titleLine}>
                <Text
                  numberOfLines={1}
                  style={[styles.topTitle, { color: palette.text }]}
                >
                  {conversationTitle}
                </Text>
                {project ? (
                  <Ionicons
                    color={palette.textSecondary}
                    name="chevron-forward"
                    size={14}
                  />
                ) : null}
              </View>
              <View style={styles.chatSubtitleLine}>
                <Ionicons
                  color={palette.textSecondary}
                  name="folder-outline"
                  size={14}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.chatTitle, { color: palette.textSecondary }]}
                >
                  {project?.name ?? t("chat.screen.quickConversation")}
                </Text>
              </View>
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityLabel={
                  contextUsage
                    ? t("chat.context.openAccessibility", {
                        percent: contextPercent,
                        size: formatCompactTokenCount(
                          contextUsage.contextWindow,
                        ),
                      })
                    : t("chat.context.open")
                }
                accessibilityRole="button"
                accessibilityValue={{
                  max: 100,
                  min: 0,
                  now: contextPercent,
                }}
                onPress={() => {
                  setActiveSheet("context");
                  void refreshContextUsage(true);
                }}
                style={({ pressed }) => [
                  styles.contextButton,
                  pressed && { opacity: 0.62 },
                ]}
              >
                <ProgressRing
                  activeColor={
                    contextUsage &&
                    contextUsage.usedTokens >=
                      contextUsage.compactionThresholdTokens
                      ? palette.danger
                      : palette.accent
                  }
                  progress={contextProgress}
                  size={20}
                  strokeWidth={2.5}
                  trackColor={palette.borderStrong}
                />
              </Pressable>
              <IconButton
                icon="ellipsis-vertical"
                label={t("chat.screen.conversationOptions")}
                onPress={() => setActiveSheet("conversation")}
                palette={palette}
              />
            </View>
          </View>
        </View>

        {headerAccessory}
        <FlatList
          contentContainerStyle={[
            styles.messages,
            { paddingBottom: spacing.md },
            state.messageIds.length === 0 && styles.emptyMessages,
          ]}
          data={state.messageIds}
          initialNumToRender={6}
          keyExtractor={messageIdKey}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={ChatListEmpty}
          ListFooterComponent={footer}
          maxToRenderPerBatch={4}
          nestedScrollEnabled
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleListLayout}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          ref={scrollRef}
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={renderMessage}
          scrollEventThrottle={32}
          scrollEnabled={!disclosureScrollActive}
          showsVerticalScrollIndicator={false}
          style={styles.flex}
          windowSize={7}
        />

        <View pointerEvents="box-none">
          <ChatComposer
            bottomInset={insets.bottom / 2}
            conversationId={conversationId}
            onOpenAttachments={openAttachments}
          />
        </View>
      </KeyboardAvoidingView>

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("chat.context.title")}
        visible={activeSheet === "context"}
      >
        {contextUsage ? (
          <View
            style={[
              styles.contextCard,
              { backgroundColor: palette.codeSurface },
            ]}
          >
            <Text
              style={[styles.contextEyebrow, { color: palette.textSecondary }]}
            >
              {t("chat.context.remaining")}
            </Text>
            <Text style={[styles.contextRemaining, { color: palette.text }]}>
              {formatCompactTokenCount(contextUsage.remainingTokens)}
            </Text>
            <Text
              style={[
                styles.contextUsageLine,
                { color: palette.textSecondary },
              ]}
            >
              {t("chat.context.usedOfTotal", {
                total: formatCompactTokenCount(contextUsage.contextWindow),
                used: formatCompactTokenCount(contextUsage.usedTokens),
              })}
            </Text>
            <View
              style={[
                styles.contextProgress,
                { backgroundColor: palette.borderStrong },
              ]}
            >
              <View
                style={[
                  styles.contextProgressFill,
                  {
                    backgroundColor:
                      contextUsage.usedTokens >=
                      contextUsage.compactionThresholdTokens
                        ? palette.danger
                        : palette.accent,
                    width: `${Math.min(
                      100,
                      (contextUsage.usedTokens /
                        Math.max(1, contextUsage.contextWindow)) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>
            <Text
              style={[styles.contextNote, { color: palette.textSecondary }]}
            >
              {t("chat.context.autoCompact", {
                threshold: formatCompactTokenCount(
                  contextUsage.compactionThresholdTokens,
                ),
              })}
            </Text>
            {contextUsage.estimated ? (
              <Text
                style={[
                  styles.contextEstimate,
                  { color: palette.textTertiary },
                ]}
              >
                {t("chat.context.estimated")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("chat.screen.conversation")}
        visible={activeSheet === "conversation"}
      >
        <ListRow
          destructive
          icon="trash-outline"
          onPress={requestConversationDelete}
          palette={palette}
          title={t("chat.screen.deleteConversation")}
        />
      </BottomSheet>

      <BottomSheet
        onDismiss={performPendingAttachmentAction}
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("chat.attachment.add")}
        visible={activeSheet === "attachments"}
      >
        <ListRow
          icon="images-outline"
          onPress={() => requestAttachmentAction("image")}
          palette={palette}
          title={t("chat.attachment.chooseImage")}
        />
        <ListRow
          icon="camera-outline"
          onPress={() => requestAttachmentAction("camera")}
          palette={palette}
          title={t("chat.attachment.camera")}
        />
        <ListRow
          icon="document-attach-outline"
          onPress={() => requestAttachmentAction("file")}
          palette={palette}
          title={t("chat.attachment.chooseFile")}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  topBarSurface: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.xs,
  },
  headerSide: {
    alignItems: "center",
    justifyContent: "center",
    width: 48,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "flex-end",
    minHeight: 48,
    minWidth: 100,
  },
  contextButton: {
    alignItems: "flex-end",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  titleButton: {
    alignItems: "flex-start",
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  titleLine: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.xxs,
    minWidth: 0,
  },
  topTitle: { flexShrink: 1, fontSize: 15.5, fontWeight: "600" },
  chatSubtitleLine: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing.xxs,
    marginTop: 2,
    minWidth: 0,
  },
  chatTitle: { flexShrink: 1, fontSize: 12 },
  messages: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: spacing.md,
  },
  emptyMessages: { justifyContent: "center" },
  messageFooter: { gap: spacing.md },
  messageGap: { marginTop: spacing.md },
  runErrorRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  runError: { flex: 1, fontSize: 13, lineHeight: 20 },
  retryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  retryText: { fontSize: 13, fontWeight: "600", lineHeight: 20 },
  storageError: { fontSize: 11.5, lineHeight: 18 },
  contextCard: {
    borderRadius: radii.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  contextEyebrow: { fontSize: 12, fontWeight: "600" },
  contextRemaining: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: spacing.xxs,
  },
  contextUsageLine: { fontSize: 13, marginTop: spacing.xxs },
  contextProgress: {
    borderRadius: radii.pill,
    height: 7,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  contextProgressFill: { borderRadius: radii.pill, height: 7 },
  contextNote: { fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  contextEstimate: { fontSize: 11, lineHeight: 17, marginTop: spacing.xs },
});
