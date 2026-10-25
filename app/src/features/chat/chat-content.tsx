import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { memo, type ComponentProps, useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import boltpocketMark from "@/assets/boltpocket/foreground.png";
import { BoundedFlex, shrinkableTextStyle } from "@/components/bounded-layout";
import { LoadingIndicator } from "@/components/loading-indicator";
import { AGENT_TEXT_LIMITS, boundText } from "@/application/bounded-text";
import { formatCompactTokenCount } from "@/application/conversation-context-usage";
import { MarkdownContent } from "@/components/markdown-content";
import { markdownPreviewText } from "@/components/markdown-policy";
import { IconButton } from "@/components/ui";
import type {
  AgentActivityItem,
  AgentExecution,
  ChangeProposal,
  ChatMessage,
  CollaborationTask,
} from "@/domain/models";
import { AiGeneratedFooter } from "@/features/chat/ai-generated-footer";
import { ChatAttachmentPreview } from "@/features/chat/chat-attachment-preview";
import { LiveElapsedText } from "@/features/chat/live-elapsed-text";
import { useLocalInferenceProgress } from "@/features/chat/use-local-inference-progress";
import type { NativeInferenceProgress } from "@/infrastructure/agent/native-inference-progress";
import {
  useLiveAgentActivity,
  useLiveAgentCollaboration,
  useLiveAgentStartedAt,
  useLiveAgentStatus,
} from "@/features/chat/use-live-agent-output";
import { useI18n } from "@/i18n/i18n-provider";
import { resolveMessageReference, type MessageKey } from "@/i18n/messages";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const quickPromptKeys = [
  "chat.content.prompt.organizeIdea",
  "chat.content.prompt.inspectAndImprove",
  "chat.content.prompt.analyzeExisting",
  "chat.content.prompt.continueRecent",
] as const satisfies readonly MessageKey[];
const MAX_INLINE_ACTIVITY_ROWS = 24;

export function AnimatedSendButton({
  label,
  onPress,
  palette,
}: {
  label: string;
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(170)}
      style={{
        alignSelf: "flex-end",
        flexShrink: 0,
        height: 44,
        width: 44,
        zIndex: 1,
      }}
    >
      <IconButton
        filled
        icon="arrow-up"
        label={label}
        onPress={onPress}
        palette={palette}
      />
    </Animated.View>
  );
}

export function EmptyChat({
  palette,
  onPrompt,
}: {
  palette: ReturnType<typeof useAppPalette>;
  onPrompt: (prompt: string) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.emptyState}>
      <Image
        contentFit="contain"
        source={boltpocketMark}
        style={styles.emptyMark}
      />
      <Text style={[styles.emptyTitle, { color: palette.text }]}>
        {t("chat.content.emptyTitle")}
      </Text>
      <View style={styles.promptGrid}>
        {quickPromptKeys.map((promptKey) => {
          const prompt = t(promptKey);
          return (
            <Pressable
              accessibilityRole="button"
              key={prompt}
              onPress={() => onPrompt(prompt)}
              style={({ pressed }) => [
                styles.prompt,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                },
                pressed && { backgroundColor: palette.surfaceRaised },
              ]}
            >
              <Text style={[styles.promptText, { color: palette.text }]}>
                {prompt}
              </Text>
              <Ionicons
                color={palette.textTertiary}
                name="arrow-forward"
                size={15}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function executionForMessage(message: ChatMessage): AgentExecution | null {
  if (message.execution) {
    const activity = message.execution.activity.filter(
      (item) => item.kind !== "thinking",
    );
    return activity.length ? { ...message.execution, activity } : null;
  }
  const activity: AgentActivityItem[] = [];
  for (const [index, label] of (message.toolActivity ?? []).entries()) {
    activity.push({
      id: `${message.id}-legacy-tool-${index}`,
      kind: "tool",
      label,
      status: "completed",
    });
  }
  return activity.length
    ? { status: "completed", durationMs: 0, activity }
    : null;
}

export const Message = memo(function Message({
  onDisclosureInteractionChange,
  message,
  onOpenFullContent,
  onOpenGeneratedMedia,
  palette,
  onOpenDiff,
  proposal,
}: {
  onDisclosureInteractionChange?: (active: boolean) => void;
  message: ChatMessage;
  onOpenFullContent: (messageId: string) => void;
  onOpenGeneratedMedia: (messageId: string, attachmentId: string) => void;
  palette: ReturnType<typeof useAppPalette>;
  onOpenDiff: (proposalId: string) => void;
  proposal?: ChangeProposal;
}) {
  const { t } = useI18n();
  const execution = executionForMessage(message);
  const usesLongPreview =
    message.role === "assistant" &&
    message.content.length > AGENT_TEXT_LIMITS.inlineConversationCharacters;
  const renderedContent = boundText(
    message.content,
    usesLongPreview
      ? AGENT_TEXT_LIMITS.renderedConversationPreviewCharacters
      : AGENT_TEXT_LIMITS.renderedConversationCharacters,
  );

  const openGeneratedMedia = useCallback(
    (attachmentId: string) => onOpenGeneratedMedia(message.id, attachmentId),
    [message.id, onOpenGeneratedMedia],
  );
  const openFullContent = useCallback(
    () => onOpenFullContent(message.id),
    [message.id, onOpenFullContent],
  );
  const openDiff = useCallback(() => {
    if (proposal) onOpenDiff(proposal.id);
  }, [onOpenDiff, proposal]);

  if (message.role === "user") {
    return (
      <View style={styles.userMessageRow}>
        <View
          style={[styles.userBubble, { backgroundColor: palette.codeSurface }]}
        >
          <MarkdownContent variant="user">{renderedContent}</MarkdownContent>
          {message.attachments?.length ? (
            <View style={styles.messageAttachments}>
              <ChatAttachmentPreview
                attachments={message.attachments}
                disabled
                onOpenGeneratedMedia={openGeneratedMedia}
                onRemove={() => undefined}
                palette={palette}
              />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantMessage}>
      {execution ? (
        <ExecutionTimeline execution={execution} palette={palette} />
      ) : null}
      {message.collaboration?.length ? (
        <CollaborationDisclosure
          collaboration={message.collaboration}
          onInteractionChange={onDisclosureInteractionChange}
          palette={palette}
        />
      ) : null}
      {renderedContent ? (
        <MarkdownContent variant="conversation">
          {renderedContent}
        </MarkdownContent>
      ) : null}
      {message.attachments?.length ? (
        <View style={styles.messageAttachments}>
          <ChatAttachmentPreview
            attachments={message.attachments}
            disabled
            onOpenGeneratedMedia={openGeneratedMedia}
            onRemove={() => undefined}
            palette={palette}
          />
        </View>
      ) : null}
      {usesLongPreview ? (
        <Pressable
          accessibilityRole="button"
          onPress={openFullContent}
          style={({ pressed }) => [
            styles.fullContentButton,
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <Text style={[styles.fullContentText, { color: palette.accent }]}>
            {t("chat.content.viewFullAnswer")}
          </Text>
          <Ionicons color={palette.accent} name="arrow-forward" size={15} />
        </Pressable>
      ) : null}
      {proposal ? (
        <View style={styles.proposalRow}>
          <Pressable
            accessibilityLabel={
              proposal.status === "applied"
                ? t("chat.content.proposal.reviewChanges")
                : t("chat.content.proposal.viewPending")
            }
            accessibilityRole="button"
            onPress={openDiff}
            style={({ pressed }) => [
              styles.proposalButton,
              pressed && { backgroundColor: palette.codeSurface },
            ]}
          >
            <View
              style={[
                styles.proposalIcon,
                { backgroundColor: palette.accentSoft },
              ]}
            >
              <Ionicons
                color={palette.accent}
                name="git-compare-outline"
                size={18}
              />
            </View>
            <BoundedFlex>
              <Text
                numberOfLines={2}
                style={[
                  styles.proposalTitle,
                  shrinkableTextStyle,
                  { color: palette.text },
                ]}
              >
                {markdownPreviewText(
                  resolveMessageReference(
                    proposal.titleMessage,
                    proposal.title,
                    t,
                  ),
                ) || t("chat.content.changeProposal")}
              </Text>
            </BoundedFlex>
            <Text style={[styles.proposalAction, { color: palette.accent }]}>
              {proposal.status === "applied"
                ? t("chat.content.proposal.review")
                : t("chat.content.proposal.view")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <AiGeneratedFooter palette={palette} />
    </View>
  );
});

export function RunningState({
  palette,
  onStop,
  status,
}: {
  palette: ReturnType<typeof useAppPalette>;
  onStop?: () => void;
  status: string;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.runningState}>
      <View style={styles.runningLine}>
        <LoadingIndicator palette={palette} variant="inline" />
        <Text
          numberOfLines={2}
          style={[
            styles.runningText,
            shrinkableTextStyle,
            { color: palette.textSecondary },
          ]}
        >
          {status}
        </Text>
        {onStop ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onStop}>
            <Text style={[styles.stopText, { color: palette.textSecondary }]}>
              {t("chat.content.stop")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function LiveRunningState({
  conversationId,
  onStop,
  palette,
}: {
  conversationId: string;
  onStop: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const status = useLiveAgentStatus(conversationId);
  const progress = useLocalInferenceProgress(conversationId);
  const title = progress
    ? t(
        progress.phase === "loading"
          ? "chat.content.execution.loading"
          : progress.phase === "restoring"
            ? "chat.content.execution.restoring"
            : progress.phase === "prefill"
              ? "chat.content.execution.prefill"
              : progress.phase === "decoding"
                ? "chat.content.execution.generating"
                : "chat.content.execution.queued",
      )
    : status || t("chat.content.processing");
  const startedAt = useLiveAgentStartedAt(conversationId);
  return (
    <View style={styles.executionHeader}>
      <LoadingIndicator palette={palette} variant="inline" />
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={2}
        style={[
          styles.executionTitle,
          shrinkableTextStyle,
          { color: palette.textSecondary },
        ]}
      >
        {title}
      </Text>
      <LiveElapsedText color={palette.textSecondary} startedAt={startedAt} />
      <Pressable
        accessibilityRole="button"
        onPress={onStop}
        style={styles.stopButton}
      >
        <Text style={[styles.stopText, { color: palette.textSecondary }]}>
          {t("chat.content.stop")}
        </Text>
      </Pressable>
    </View>
  );
}

function NativeInferenceStatus({
  progress,
  palette,
}: {
  progress: NativeInferenceProgress;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const percent =
    progress.totalTokens > 0
      ? Math.floor((progress.processedTokens / progress.totalTokens) * 100)
      : 0;
  return (
    <View style={styles.nativeProgress}>
      {progress.phase === "prefill" ? (
        <>
          <View
            accessibilityLabel={t("chat.content.execution.prefill")}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={[styles.prefillTrack, { backgroundColor: palette.border }]}
          >
            <View
              style={[
                styles.prefillFill,
                { backgroundColor: palette.accent, width: `${percent}%` },
              ]}
            />
          </View>
          <Text style={[styles.activityMeta, { color: palette.textSecondary }]}>
            {t("chat.content.execution.prefillTokens", {
              processed: progress.processedTokens,
              total: progress.totalTokens,
              percent,
            })}
          </Text>
          {progress.reusedTokens > 0 ? (
            <Text
              style={[styles.activityMeta, { color: palette.textTertiary }]}
            >
              {t(
                progress.cacheOrigin === "disk"
                  ? "chat.content.execution.restoredTokens"
                  : "chat.content.execution.cachedTokens",
                {
                  count: progress.reusedTokens,
                },
              )}
            </Text>
          ) : null}
          <Text style={[styles.activityMeta, { color: palette.textTertiary }]}>
            {t("chat.content.execution.prefillDescription")}
          </Text>
        </>
      ) : (
        <Text
          style={[styles.activityNarration, { color: palette.textSecondary }]}
        >
          {progress.phase === "decoding"
            ? t("chat.content.execution.generatedTokens", {
                count: progress.outputTokens,
              })
            : t(
                progress.phase === "restoring"
                  ? "chat.content.execution.restoringDescription"
                  : progress.phase === "loading"
                    ? "chat.content.execution.loadingDescription"
                    : "chat.content.execution.queued",
              )}
        </Text>
      )}
    </View>
  );
}

export function LiveRunActivity({
  conversationId,
  onStop,
  palette,
}: {
  conversationId: string;
  onStop: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const activity = useLiveAgentActivity(conversationId);
  const collaboration = useLiveAgentCollaboration(conversationId);
  const progress = useLocalInferenceProgress(conversationId);
  return (
    <View style={styles.liveRunActivity}>
      {activity.length ? (
        <ActivityTimelineRows activity={activity} palette={palette} />
      ) : null}
      {collaboration.length ? (
        <LiveCollaboration collaboration={collaboration} palette={palette} />
      ) : null}
      {progress ? (
        <NativeInferenceStatus progress={progress} palette={palette} />
      ) : null}
      <LiveRunningState
        conversationId={conversationId}
        onStop={onStop}
        palette={palette}
      />
    </View>
  );
}

function durationLabel(durationMs: number, t: TranslateMessage) {
  if (durationMs < 1_000) {
    return durationMs > 0 ? t("chat.content.execution.lessThanSecond") : "";
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds >= 60) {
    return t("chat.content.execution.minutesSeconds", {
      minutes: Math.floor(totalSeconds / 60),
      seconds: totalSeconds % 60,
    });
  }
  return t("chat.content.execution.seconds", {
    count: totalSeconds,
  });
}

function executionStatusMeta(status: AgentExecution["status"]): {
  color: "accent" | "danger" | "secondary";
  icon: ComponentProps<typeof Ionicons>["name"];
  labelKey: MessageKey;
} {
  if (status === "failed") {
    return {
      color: "danger",
      icon: "alert-circle-outline",
      labelKey: "chat.content.execution.failed",
    };
  }
  if (status === "cancelled" || status === "interrupted") {
    return {
      color: "secondary",
      icon: "stop-circle-outline",
      labelKey:
        status === "interrupted"
          ? "chat.content.execution.interrupted"
          : "chat.content.execution.cancelled",
    };
  }
  return {
    color: "accent",
    icon: "checkmark-circle-outline",
    labelKey: "chat.content.execution.completed",
  };
}

function toolStatusMeta(
  status: Extract<AgentActivityItem, { kind: "tool" }>["status"],
): {
  icon: ComponentProps<typeof Ionicons>["name"];
  labelKey: MessageKey;
} {
  if (status === "failed") {
    return {
      icon: "alert-circle-outline",
      labelKey: "chat.content.execution.tool.failed",
    };
  }
  if (status === "cancelled") {
    return {
      icon: "stop-circle-outline",
      labelKey: "chat.content.execution.tool.cancelled",
    };
  }
  if (status === "staged") {
    return {
      icon: "git-compare-outline",
      labelKey: "chat.content.execution.tool.staged",
    };
  }
  return {
    icon:
      status === "running" ? "ellipsis-horizontal-circle" : "checkmark-circle",
    labelKey:
      status === "running"
        ? "chat.content.execution.tool.running"
        : "chat.content.execution.tool.completed",
  };
}

function ActivityTimelineRows({
  activity,
  palette,
}: {
  activity: readonly AgentActivityItem[];
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const allVisibleActivity = activity.filter(
    (item): item is Exclude<AgentActivityItem, { kind: "thinking" }> =>
      item.kind !== "thinking",
  );
  const omittedCount = Math.max(
    0,
    allVisibleActivity.length - MAX_INLINE_ACTIVITY_ROWS,
  );
  const visibleActivity = omittedCount
    ? allVisibleActivity.slice(-MAX_INLINE_ACTIVITY_ROWS)
    : allVisibleActivity;
  if (visibleActivity.length === 0) return null;
  return (
    <View style={styles.activityTimeline}>
      {omittedCount ? (
        <View
          accessible
          accessibilityLabel={t("chat.content.execution.earlierSteps", {
            count: omittedCount,
          })}
          style={styles.activityRow}
        >
          <View style={styles.activityMarkerColumn}>
            <Ionicons
              color={palette.textTertiary}
              name="ellipsis-horizontal-circle-outline"
              size={17}
            />
            <View
              style={[styles.activityRail, { backgroundColor: palette.border }]}
            />
          </View>
          <BoundedFlex style={styles.activityToolCopy}>
            <Text
              numberOfLines={1}
              style={[
                styles.activityMeta,
                shrinkableTextStyle,
                { color: palette.textTertiary },
              ]}
            >
              {t("chat.content.execution.earlierSteps", {
                count: omittedCount,
              })}
            </Text>
          </BoundedFlex>
        </View>
      ) : null}
      {visibleActivity.map((item, index) => {
        const last = index === visibleActivity.length - 1;
        if (item.kind === "text") {
          const content = boundText(
            item.content,
            AGENT_TEXT_LIMITS.renderedLiveDisclosureCharacters,
          );
          return (
            <View
              accessible
              accessibilityLabel={t(
                "chat.content.execution.update.accessibility",
                { content },
              )}
              key={item.id}
              style={styles.activityRow}
            >
              <View style={styles.activityMarkerColumn}>
                <Ionicons
                  color={palette.textTertiary}
                  name="chatbubble-ellipses-outline"
                  size={17}
                />
                {!last ? (
                  <View
                    style={[
                      styles.activityRail,
                      { backgroundColor: palette.border },
                    ]}
                  />
                ) : null}
              </View>
              <BoundedFlex style={styles.activityToolCopy}>
                <Text
                  selectable
                  style={[
                    styles.activityNarration,
                    shrinkableTextStyle,
                    { color: palette.textSecondary },
                  ]}
                >
                  {content}
                </Text>
              </BoundedFlex>
            </View>
          );
        }
        if (item.kind === "context") {
          const title = t(
            item.operation === "automatic_compaction"
              ? "chat.content.execution.context.compaction"
              : "chat.content.execution.context.recovery",
          );
          const statusKey =
            item.status === "running"
              ? "chat.content.execution.context.running"
              : item.status === "completed"
                ? "chat.content.execution.context.completed"
                : item.status === "failed"
                  ? "chat.content.execution.context.failed"
                  : "chat.content.execution.context.cancelled";
          const status = t(statusKey);
          const tokenChange =
            item.tokensBefore === undefined || item.tokensAfter === undefined
              ? ""
              : `${formatCompactTokenCount(item.tokensBefore)} → ${formatCompactTokenCount(item.tokensAfter)}`;
          const duration = item.durationMs
            ? durationLabel(item.durationMs, t)
            : "";
          const color =
            item.status === "failed"
              ? palette.danger
              : item.status === "running"
                ? palette.accent
                : palette.textTertiary;
          const icon =
            item.status === "failed"
              ? "alert-circle-outline"
              : item.status === "cancelled"
                ? "close-circle-outline"
                : "contract-outline";
          return (
            <View
              accessible
              accessibilityLabel={t(
                "chat.content.execution.context.accessibility",
                {
                  change: tokenChange ? ` · ${tokenChange}` : "",
                  duration: duration ? ` · ${duration}` : "",
                  label: title,
                  status,
                },
              )}
              key={item.id}
              style={styles.activityRow}
            >
              <View style={styles.activityMarkerColumn}>
                <Ionicons color={color} name={icon} size={17} />
                {!last ? (
                  <View
                    style={[
                      styles.activityRail,
                      { backgroundColor: palette.border },
                    ]}
                  />
                ) : null}
              </View>
              <BoundedFlex style={styles.activityToolCopy}>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.activityToolLabel,
                    shrinkableTextStyle,
                    { color: palette.textSecondary },
                  ]}
                >
                  {title}
                </Text>
                <Text
                  style={[styles.activityMeta, { color: palette.textTertiary }]}
                >
                  {status}
                  {tokenChange ? ` · ${tokenChange}` : ""}
                  {duration ? ` · ${duration}` : ""}
                </Text>
              </BoundedFlex>
            </View>
          );
        }
        const meta = toolStatusMeta(item.status);
        const duration = item.durationMs
          ? durationLabel(item.durationMs, t)
          : "";
        const failureReason =
          item.status === "failed" && item.failureReason
            ? boundText(
                item.failureReason,
                AGENT_TEXT_LIMITS.toolFailureReasonCharacters,
              )
            : "";
        const color =
          item.status === "failed"
            ? palette.danger
            : item.status === "running"
              ? palette.accent
              : palette.textTertiary;
        return (
          <View
            accessible
            accessibilityLabel={t("chat.content.execution.tool.accessibility", {
              label: item.label,
              status: t(meta.labelKey),
              duration: duration ? ` · ${duration}` : "",
              reason: failureReason ? ` · ${failureReason}` : "",
            })}
            key={item.id}
            style={styles.activityRow}
          >
            <View style={styles.activityMarkerColumn}>
              <Ionicons color={color} name={meta.icon} size={17} />
              {!last ? (
                <View
                  style={[
                    styles.activityRail,
                    { backgroundColor: palette.border },
                  ]}
                />
              ) : null}
            </View>
            <BoundedFlex style={styles.activityToolCopy}>
              <Text
                numberOfLines={2}
                style={[
                  styles.activityToolLabel,
                  shrinkableTextStyle,
                  { color: palette.textSecondary },
                ]}
              >
                {boundText(
                  item.label,
                  AGENT_TEXT_LIMITS.toolActivityCharacters,
                )}
              </Text>
              <Text
                style={[styles.activityMeta, { color: palette.textTertiary }]}
              >
                {t(meta.labelKey)}
                {duration ? ` · ${duration}` : ""}
              </Text>
              {failureReason ? (
                <Text
                  numberOfLines={3}
                  style={[
                    styles.activityFailureReason,
                    shrinkableTextStyle,
                    { color: palette.danger },
                  ]}
                >
                  {t("chat.content.execution.tool.failureReason", {
                    reason: failureReason,
                  })}
                </Text>
              ) : null}
            </BoundedFlex>
          </View>
        );
      })}
    </View>
  );
}

function ExecutionTimeline({
  execution,
  palette,
}: {
  execution: AgentExecution;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const meta = executionStatusMeta(execution.status);
  const color =
    meta.color === "danger"
      ? palette.danger
      : meta.color === "accent"
        ? palette.accent
        : palette.textTertiary;
  const duration = durationLabel(execution.durationMs, t);
  const label = `${t(meta.labelKey)}${duration ? ` · ${duration}` : ""}`;
  return (
    <View style={styles.executionTimeline}>
      <Pressable
        accessibilityLabel={`${t(
          expanded ? "chat.content.collapse" : "chat.content.expand",
        )} ${label}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={4}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          styles.executionHeader,
          pressed && [
            styles.executionHeaderPressed,
            { backgroundColor: palette.codeSurface },
          ],
        ]}
      >
        <Ionicons color={color} name={meta.icon} size={18} />
        <Text
          numberOfLines={1}
          style={[
            styles.executionTitle,
            shrinkableTextStyle,
            { color: palette.textSecondary },
          ]}
        >
          {label}
        </Text>
        <Ionicons
          color={palette.textTertiary}
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={17}
        />
      </Pressable>
      {expanded ? (
        <ActivityTimelineRows activity={execution.activity} palette={palette} />
      ) : null}
    </View>
  );
}

function collaborationRoleMeta(role: CollaborationTask["role"]): {
  icon: ComponentProps<typeof Ionicons>["name"];
  labelKey: MessageKey;
} {
  if (role === "scout") {
    return {
      icon: "search-outline",
      labelKey: "chat.content.collaboration.role.scout",
    };
  }
  if (role === "planner") {
    return {
      icon: "list-outline",
      labelKey: "chat.content.collaboration.role.planner",
    };
  }
  return {
    icon: "shield-checkmark-outline",
    labelKey: "chat.content.collaboration.role.reviewer",
  };
}

type TranslateMessage = ReturnType<typeof useI18n>["t"];

function collaborationDuration(task: CollaborationTask, t: TranslateMessage) {
  if (task.status === "running") {
    return t("chat.content.collaboration.running");
  }
  const duration = task.durationMs ?? 0;
  if (duration < 1_000) {
    return t("chat.content.collaboration.lessThanSecond");
  }
  return t("chat.content.collaboration.seconds", {
    count: Math.floor(duration / 1_000),
  });
}

function CollaborationTaskRows({
  collaboration,
  palette,
}: {
  collaboration: readonly CollaborationTask[];
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  return (
    <View style={styles.collaborationList}>
      {collaboration.map((task) => {
        const roleMeta = collaborationRoleMeta(task.role);
        const role = t(roleMeta.labelKey);
        const status = t(
          task.status === "running"
            ? "chat.content.collaboration.running"
            : task.status === "failed"
              ? "chat.content.collaboration.failed"
              : "chat.content.collaboration.completed",
        );
        const expanded = expandedTaskId === task.id;
        const inspectable = Boolean(task.summary || task.toolActivity?.length);
        return (
          <View key={task.id} style={styles.collaborationItem}>
            <Pressable
              accessibilityLabel={t("chat.content.collaboration.task", {
                description: task.description,
                role,
                status,
              })}
              accessibilityRole={inspectable ? "button" : undefined}
              disabled={!inspectable}
              onPress={() =>
                setExpandedTaskId((current) =>
                  current === task.id ? null : task.id,
                )
              }
              style={({ pressed }) => [
                styles.collaborationRow,
                pressed && { backgroundColor: palette.surfaceRaised },
              ]}
            >
              <View
                style={[
                  styles.collaborationRoleIcon,
                  { backgroundColor: palette.background },
                ]}
              >
                <Ionicons
                  color={palette.textSecondary}
                  name={roleMeta.icon}
                  size={16}
                />
              </View>
              <BoundedFlex>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.collaborationDescription,
                    { color: palette.text },
                  ]}
                >
                  {task.description}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.collaborationMeta,
                    { color: palette.textTertiary },
                  ]}
                >
                  {role} · {collaborationDuration(task, t)}
                </Text>
              </BoundedFlex>
              {task.status === "running" ? (
                <Ionicons
                  color={palette.accent}
                  name="ellipsis-horizontal-circle"
                  size={18}
                />
              ) : (
                <Ionicons
                  color={
                    task.status === "failed" ? palette.danger : palette.accent
                  }
                  name={
                    task.status === "failed"
                      ? "alert-circle-outline"
                      : "checkmark-circle-outline"
                  }
                  size={18}
                />
              )}
              {inspectable ? (
                <Ionicons
                  color={palette.textTertiary}
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={14}
                />
              ) : null}
            </Pressable>
            {expanded ? (
              <View style={styles.collaborationResult}>
                {task.summary ? (
                  <MarkdownContent variant="secondary">
                    {boundText(
                      task.summary,
                      AGENT_TEXT_LIMITS.renderedDisclosureCharacters,
                    )}
                  </MarkdownContent>
                ) : null}
                {task.toolActivity?.length ? (
                  <Text
                    style={[
                      styles.collaborationTools,
                      { color: palette.textTertiary },
                    ]}
                  >
                    {t("chat.content.collaboration.usedTools", {
                      tools: task.toolActivity.join(" · "),
                    })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function CollaborationDisclosure({
  collaboration,
  onInteractionChange,
  palette,
}: {
  collaboration: readonly CollaborationTask[];
  onInteractionChange?: (active: boolean) => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const completed = collaboration.filter(
    (task) => task.status !== "running",
  ).length;
  return (
    <View
      style={[
        styles.collaborationPanel,
        { backgroundColor: palette.codeSurface },
      ]}
    >
      <Pressable
        accessibilityLabel={t("chat.content.collaboration.toggle", {
          action: t(expanded ? "chat.content.collapse" : "chat.content.expand"),
          completed,
          total: collaboration.length,
        })}
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
        style={styles.collaborationHeader}
      >
        <Ionicons
          color={palette.textSecondary}
          name="people-outline"
          size={17}
        />
        <Text style={[styles.collaborationTitle, { color: palette.text }]}>
          {t("chat.content.collaboration.title")}
        </Text>
        <Text
          style={[styles.collaborationCount, { color: palette.textTertiary }]}
        >
          {completed}/{collaboration.length}
        </Text>
        <Ionicons
          color={palette.textTertiary}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={15}
        />
      </Pressable>
      {expanded ? (
        <ScrollView
          nestedScrollEnabled
          onMomentumScrollEnd={() => onInteractionChange?.(false)}
          onScrollEndDrag={() => onInteractionChange?.(false)}
          onTouchCancel={() => onInteractionChange?.(false)}
          onTouchEnd={() => onInteractionChange?.(false)}
          onTouchStart={() => onInteractionChange?.(true)}
          showsVerticalScrollIndicator
          style={styles.collaborationViewport}
        >
          <CollaborationTaskRows
            collaboration={collaboration}
            palette={palette}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

function LiveCollaboration({
  collaboration,
  palette,
}: {
  collaboration: readonly CollaborationTask[];
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  if (collaboration.length === 0) return null;
  const completed = collaboration.filter(
    (task) => task.status !== "running",
  ).length;
  return (
    <View
      style={[
        styles.collaborationPanel,
        { backgroundColor: palette.codeSurface },
      ]}
    >
      <View style={styles.collaborationHeader}>
        <Ionicons
          color={palette.textSecondary}
          name="people-outline"
          size={17}
        />
        <Text style={[styles.collaborationTitle, { color: palette.text }]}>
          {t("chat.content.collaboration.title")}
        </Text>
        <Text
          style={[styles.collaborationCount, { color: palette.textTertiary }]}
        >
          {completed}/{collaboration.length}
        </Text>
      </View>
      <CollaborationTaskRows collaboration={collaboration} palette={palette} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: { alignItems: "center", paddingVertical: spacing.xxl },
  emptyMark: {
    height: 56,
    width: 56,
  },
  emptyTitle: { fontSize: 24, fontWeight: "600", marginTop: spacing.lg },
  promptGrid: { gap: spacing.xs, marginTop: spacing.xl, width: "100%" },
  prompt: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  promptText: { fontSize: 14 },
  userMessageRow: { alignItems: "flex-end" },
  userBubble: {
    borderRadius: radii.lg,
    borderTopRightRadius: radii.sm,
    gap: spacing.sm,
    maxWidth: "92%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageAttachments: { minWidth: 152 },
  assistantMessage: { gap: spacing.md },
  proposalRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  proposalButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 0,
    flexDirection: "row",
    gap: spacing.sm,
    flex: 1,
    minHeight: 58,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  proposalIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  proposalTitle: { fontSize: 14, fontWeight: "600" },
  proposalAction: { flexShrink: 0, fontSize: 12, fontWeight: "600" },
  fullContentButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  fullContentText: { fontSize: 13, fontWeight: "600" },
  runningState: { gap: spacing.md },
  liveRunActivity: { gap: spacing.xs },
  nativeProgress: { gap: spacing.xxs, paddingBottom: spacing.sm },
  prefillTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  prefillFill: { height: 4 },
  executionTimeline: { gap: spacing.sm },
  executionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    minWidth: 0,
  },
  executionHeaderPressed: {
    borderRadius: radii.sm,
  },
  executionTitle: {
    flex: 1,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    lineHeight: 18,
  },
  activityTimeline: { paddingTop: spacing.xxs },
  activityRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 34,
  },
  activityMarkerColumn: {
    alignItems: "center",
    flexShrink: 0,
    width: 22,
  },
  activityRail: {
    flex: 1,
    marginVertical: spacing.xxs,
    width: StyleSheet.hairlineWidth,
  },
  activityToolCopy: { paddingBottom: spacing.xs },
  activityNarration: { fontSize: 14, lineHeight: 21 },
  activityToolLabel: { fontSize: 14, lineHeight: 20 },
  activityMeta: { fontSize: 11, lineHeight: 16 },
  activityFailureReason: { fontSize: 12, lineHeight: 18, paddingTop: 1 },
  collaborationPanel: {
    borderRadius: radii.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
  },
  collaborationHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
  },
  collaborationTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    minWidth: 0,
  },
  collaborationCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  collaborationViewport: { maxHeight: 280 },
  collaborationList: { paddingBottom: spacing.xs },
  collaborationItem: { overflow: "hidden" },
  collaborationRow: {
    alignItems: "center",
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xs,
  },
  collaborationRoleIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  collaborationDescription: { fontSize: 14, fontWeight: "500" },
  collaborationMeta: { fontSize: 12, marginTop: 2 },
  collaborationResult: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  collaborationTools: { fontSize: 12, lineHeight: 18 },
  runningLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  runningText: { flex: 1, fontSize: 13, minWidth: 0 },
  stopButton: {
    alignItems: "center",
    alignSelf: "center",
    height: 44,
    justifyContent: "center",
    minWidth: 44,
  },
  stopText: {
    fontSize: 13,
    fontWeight: "600",
    height: 18,
    includeFontPadding: false,
    lineHeight: 18,
    paddingVertical: 0,
    textAlign: "center",
    textAlignVertical: "center",
  },
});
