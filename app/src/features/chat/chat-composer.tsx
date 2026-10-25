import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { BottomSheet, IconButton } from "@/components/ui";
import type { AppState } from "@/domain/app-state";
import type { UserChatAttachment } from "@/domain/models";
import {
  canCreateBrowserTask,
  useBrowserActions,
  useBrowserState,
} from "@/features/browser/browser-provider";
import {
  browserTaskDetail,
  browserTaskTitle,
} from "@/features/browser/browser-task-presentation";
import { AnimatedSendButton } from "@/features/chat/chat-content";
import { ChatAttachmentPreview } from "@/features/chat/chat-attachment-preview";
import { ConversationModelControl } from "@/features/chat/conversation-model-control";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import { appBrowserControlBridge } from "@/infrastructure/browser/browser-control-bridge";
import {
  DEFAULT_MODEL_THINKING_LEVEL,
  loadModelRuntimeConfig,
  loadModelRuntimeConfigByProfile,
  MODEL_THINKING_LEVELS,
  updateModelThinkingLevel,
  type ModelThinkingLevel,
} from "@/infrastructure/model-config";
import {
  shallowEqualAppStateSelection,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const thinkingLevelLabelKeys: Record<ModelThinkingLevel, MessageKey> = {
  off: "chat.composer.thinkingLevel.off",
  minimal: "chat.composer.thinkingLevel.minimal",
  low: "chat.composer.thinkingLevel.low",
  medium: "chat.composer.thinkingLevel.medium",
  high: "chat.composer.thinkingLevel.high",
  xhigh: "chat.composer.thinkingLevel.xhigh",
  max: "chat.composer.thinkingLevel.max",
};
const COMPOSER_COLLAPSED_HEIGHT = 50;
const COMPOSER_SURFACE_PADDING = spacing.xs;
const COMPOSER_INPUT_MIN_HEIGHT =
  COMPOSER_COLLAPSED_HEIGHT - COMPOSER_SURFACE_PADDING * 2;
const COMPOSER_INPUT_MAX_HEIGHT = 126;

const EMPTY_ATTACHMENTS: readonly UserChatAttachment[] = Object.freeze([]);

function createChatComposerSelector(conversationId: string) {
  return (state: AppState) => ({
    autoApplyingChanges: state.autoApplyingProposalIds.some(
      (proposalId) =>
        state.proposals[proposalId]?.conversationId === conversationId,
    ),
    draft: state.activeConversationId === conversationId ? state.draft : "",
    draftAttachments:
      state.activeConversationId === conversationId
        ? state.draftAttachments
        : EMPTY_ATTACHMENTS,
    isRunning: Boolean(state.activeRunsByConversation[conversationId]),
    modelProfileId: state.conversationModelProfileIds[conversationId],
    projects: state.projects,
  });
}

export function ChatComposer({
  bottomInset = 0,
  conversationId,
  onLayout,
  onOpenAttachments,
}: {
  bottomInset?: number;
  conversationId: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  onOpenAttachments: () => void;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const browserTasks = useBrowserState((browser) => browser.tasks);
  const activeBrowserTaskId = useBrowserState(
    (browser) => browser.activeTaskId,
  );
  const canCreateBrowser = useBrowserState(canCreateBrowserTask);
  const { expandTask, newTask } = useBrowserActions();
  const { dispatch, sendMessage } = useAppActions();
  const composerSelector = useMemo(
    () => createChatComposerSelector(conversationId),
    [conversationId],
  );
  const state = useAppStateSelector(
    composerSelector,
    shallowEqualAppStateSelection,
  );
  const autoApplyingChanges = state.autoApplyingChanges;
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel>(
    DEFAULT_MODEL_THINKING_LEVEL,
  );
  const [thinkingLevelBusy, setThinkingLevelBusy] = useState(false);
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const loadEffectiveModel = useCallback(
    () =>
      state.modelProfileId
        ? loadModelRuntimeConfigByProfile(state.modelProfileId)
        : loadModelRuntimeConfig(),
    [state.modelProfileId],
  );
  const [thinkingSheetVisible, setThinkingSheetVisible] = useState(false);
  const submitFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (submitFrameRef.current !== null) {
        cancelAnimationFrame(submitFrameRef.current);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      void loadEffectiveModel()
        .then((config) => {
          if (focused) {
            setThinkingLevel(config.thinkingLevel);
            const supported = config.capabilities?.reasoning !== false;
            setSupportsReasoning(supported);
            if (!supported) setThinkingSheetVisible(false);
          }
        })
        .catch(() => {
          if (focused) setSupportsReasoning(false);
        });
      return () => {
        focused = false;
      };
    }, [loadEffectiveModel]),
  );

  const submitMessage = () => {
    if (autoApplyingChanges || submitFrameRef.current !== null) return;
    const content = state.draft.trim();
    if (!content && state.draftAttachments.length === 0) return;
    // Guard a double tap for one frame, but begin the synchronous local submit
    // immediately so the outgoing message can render before async preflight.
    const submission = sendMessage(content);
    submitFrameRef.current = requestAnimationFrame(() => {
      submitFrameRef.current = null;
    });
    void submission.catch((error: unknown) => {
      Alert.alert(
        t("runtime.messaging.run.failed"),
        localizedErrorMessage(error, t("chat.common.tryAgainLater")),
      );
    });
  };

  const selectThinkingLevel = async (level: ModelThinkingLevel) => {
    if (
      !supportsReasoning ||
      state.isRunning ||
      autoApplyingChanges ||
      thinkingLevelBusy
    )
      return;
    setThinkingLevelBusy(true);
    try {
      await updateModelThinkingLevel(level);
      const config = await loadEffectiveModel();
      setThinkingLevel(config.thinkingLevel);
      setThinkingSheetVisible(false);
    } catch (error) {
      Alert.alert(
        t("chat.composer.couldNotSwitchThinking"),
        localizedErrorMessage(error, t("chat.common.tryAgainLater")),
      );
    } finally {
      setThinkingLevelBusy(false);
    }
  };

  const browserTask =
    browserTasks.find((task) => task.id === activeBrowserTaskId) ??
    browserTasks.at(-1) ??
    null;
  const browserTaskIndex = browserTask
    ? browserTasks.findIndex((task) => task.id === browserTask.id)
    : -1;
  const browserProjectId = browserTask
    ? browserTask.source.kind === "project-preview"
      ? browserTask.source.snapshot.projectId
      : appBrowserControlBridge.managedProjectId(browserTask.id)
    : null;
  const browserOwner = browserProjectId
    ? state.projects[browserProjectId]?.name
    : undefined;
  const browserTitle = browserTask ? browserTaskTitle(browserTask, t) : "";
  const browserDetail = browserTask
    ? [browserOwner, browserTaskDetail(browserTask, t)]
        .filter(Boolean)
        .join(" · ")
    : "";
  const browserControlDisabled = !browserTask && !canCreateBrowser;

  const openBrowserControl = () => {
    if (browserTask) {
      expandTask(browserTask.id);
      return;
    }
    try {
      newTask();
    } catch (error) {
      Alert.alert(
        t("chat.composer.couldNotCreatePage"),
        localizedErrorMessage(error, t("chat.common.tryAgainLater")),
      );
    }
  };

  return (
    <>
      <View
        onLayout={onLayout}
        style={[
          styles.composerArea,
          { paddingBottom: bottomInset + spacing.xs },
        ]}
      >
        {state.draftAttachments.length ? (
          <View style={styles.attachmentPreview}>
            <ChatAttachmentPreview
              attachments={state.draftAttachments}
              onRemove={(attachmentId) =>
                dispatch({ type: "attachment/remove", attachmentId })
              }
              palette={palette}
            />
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.composerControlsContent}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.composerControls}
        >
          <ConversationModelControl conversationId={conversationId} />
          {supportsReasoning ? (
            <Pressable
              accessibilityLabel={t("chat.composer.thinkingLevel.current", {
                level: t(thinkingLevelLabelKeys[thinkingLevel]),
              })}
              accessibilityRole="button"
              accessibilityState={{
                disabled:
                  state.isRunning || autoApplyingChanges || thinkingLevelBusy,
                expanded: thinkingSheetVisible,
              }}
              disabled={
                state.isRunning || autoApplyingChanges || thinkingLevelBusy
              }
              hitSlop={6}
              onPress={() => setThinkingSheetVisible(true)}
              style={({ pressed }) => [
                styles.thinkingControl,
                { borderColor: palette.border },
                pressed && { backgroundColor: palette.accentSoft },
                (state.isRunning ||
                  autoApplyingChanges ||
                  thinkingLevelBusy) && {
                  opacity: 0.42,
                },
              ]}
            >
              {thinkingLevelBusy ? (
                <LoadingIndicator palette={palette} variant="inline" />
              ) : (
                <Ionicons
                  color={palette.textSecondary}
                  name="sparkles-outline"
                  size={15}
                />
              )}
              <Text
                style={[
                  styles.thinkingControlText,
                  { color: palette.textSecondary },
                ]}
              >
                {t("chat.composer.thinking", {
                  level: t(thinkingLevelLabelKeys[thinkingLevel]),
                })}
              </Text>
              <Ionicons
                color={palette.textTertiary}
                name="chevron-up"
                size={13}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={
              browserTask
                ? t("chat.composer.openPage", {
                    detail: browserDetail,
                    index: browserTaskIndex + 1,
                    title: browserTitle,
                  })
                : t("chat.composer.newBlankPage")
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: browserControlDisabled }}
            disabled={browserControlDisabled}
            onPress={openBrowserControl}
            style={({ pressed }) => [
              styles.browserControl,
              {
                backgroundColor: browserTask
                  ? palette.accentSoft
                  : palette.surface,
                borderColor: browserTask ? palette.accent : palette.border,
              },
              pressed && { backgroundColor: palette.accentSoft },
              browserControlDisabled && { opacity: 0.35 },
            ]}
          >
            <Ionicons
              color={browserTask ? palette.accent : palette.textSecondary}
              name={
                browserTask?.source.kind === "project-preview"
                  ? "code-slash-outline"
                  : browserTask
                    ? "globe-outline"
                    : "add"
              }
              size={17}
            />
          </Pressable>
        </ScrollView>
        <View style={styles.composerRow}>
          <View
            style={[
              styles.addButtonSurface,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <IconButton
              disabled={autoApplyingChanges}
              icon="add"
              label={t("chat.composer.addAttachment")}
              onPress={onOpenAttachments}
              palette={palette}
            />
          </View>
          <View
            style={[
              styles.composer,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <TextInput
              accessibilityLabel={t("chat.composer.message")}
              editable={!autoApplyingChanges}
              maxLength={4000}
              multiline
              onChangeText={(value) =>
                dispatch({ type: "draft/change", value })
              }
              onSubmitEditing={submitMessage}
              placeholder={
                autoApplyingChanges
                  ? t("chat.composer.applyingChanges")
                  : state.isRunning
                    ? t("chat.composer.steerCurrentRun")
                    : t("chat.composer.sendMessage")
              }
              placeholderTextColor={palette.textTertiary}
              returnKeyType="send"
              style={[
                styles.input,
                state.draft.length === 0 ? styles.emptyInput : null,
                { color: palette.text },
              ]}
              textAlignVertical="center"
              value={state.draft}
            />
            {!autoApplyingChanges &&
            (state.draft.trim() || state.draftAttachments.length) ? (
              <AnimatedSendButton
                label={t(
                  state.isRunning
                    ? "chat.composer.steerCurrentRun"
                    : "chat.composer.send",
                )}
                onPress={submitMessage}
                palette={palette}
              />
            ) : null}
          </View>
        </View>
      </View>

      <BottomSheet
        onClose={() => setThinkingSheetVisible(false)}
        palette={palette}
        title={t("chat.composer.thinkingLevel")}
        visible={thinkingSheetVisible}
      >
        <View accessibilityRole="radiogroup">
          {MODEL_THINKING_LEVELS.map((level) => {
            const selected = level === thinkingLevel;
            return (
              <Pressable
                accessibilityLabel={t("chat.composer.thinkingLevel.select", {
                  level: t(thinkingLevelLabelKeys[level]),
                })}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: selected,
                  disabled: thinkingLevelBusy,
                }}
                disabled={thinkingLevelBusy}
                key={level}
                onPress={() => void selectThinkingLevel(level)}
                style={({ pressed }) => [
                  styles.thinkingOption,
                  { borderBottomColor: palette.border },
                  selected && { backgroundColor: palette.accentSoft },
                  pressed && { backgroundColor: palette.codeSurface },
                  thinkingLevelBusy && { opacity: 0.52 },
                ]}
              >
                <Text
                  style={[
                    styles.thinkingOptionTitle,
                    { color: selected ? palette.accent : palette.text },
                  ]}
                >
                  {t(thinkingLevelLabelKeys[level])}
                </Text>
                {selected ? (
                  <Ionicons color={palette.accent} name="checkmark" size={20} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  composerArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  attachmentPreview: { paddingBottom: spacing.xs },
  composerRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
  },
  addButtonSurface: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: COMPOSER_COLLAPSED_HEIGHT,
    justifyContent: "center",
    width: COMPOSER_COLLAPSED_HEIGHT,
  },
  composer: {
    alignItems: "flex-end",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    minHeight: COMPOSER_COLLAPSED_HEIGHT,
    minWidth: 0,
    padding: COMPOSER_SURFACE_PADDING,
  },
  input: {
    alignSelf: "center",
    flex: 1,
    fontSize: 15,
    includeFontPadding: false,
    lineHeight: 20,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  emptyInput: { height: COMPOSER_INPUT_MIN_HEIGHT },
  composerControls: { flexGrow: 0 },
  composerControlsContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 34,
    paddingBottom: spacing.xs,
    paddingRight: spacing.xs,
  },
  browserControl: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  thinkingControl: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  thinkingControlText: { fontSize: 12.5, fontWeight: "600" },
  thinkingOption: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  thinkingOptionTitle: { flex: 1, fontSize: 14, fontWeight: "600" },
});
