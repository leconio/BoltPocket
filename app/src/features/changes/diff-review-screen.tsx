import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  type ListRenderItemInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  VirtualizedList,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { MarkdownContent } from "@/components/markdown-content";
import { ScreenHeader } from "@/components/ui";
import type { DiffHunk, DiffLine } from "@/domain/models";
import {
  getDiffHunkToggleAction,
  isDiffHunkAccepted,
  toggleRejectedDiffHunk,
} from "@/domain/diff-review-selection";
import { getProposalDiffStats } from "@/domain/text-diff";
import {
  createDiffReviewListModel,
  DIFF_EAGER_LINE_LIMIT,
  diffLineSegmentText,
  diffReviewListRowKey,
  type DiffReviewListModel,
  resolveDiffReviewListRow,
} from "@/features/changes/diff-review-list-model";
import { useI18n } from "@/i18n/i18n-provider";
import { resolveMessageReference } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const EMPTY_DIFF_HUNKS: readonly DiffHunk[] = [];

function getDiffListItem(_model: DiffReviewListModel, index: number) {
  return index;
}

function getDiffListItemCount(model: DiffReviewListModel) {
  return model.totalItems;
}

const selectDiffReviewState = createAppStateFieldsSelector(
  "projects",
  "proposals",
  "receipts",
);

export function DiffReviewScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { proposalId, origin } = useLocalSearchParams<{
    proposalId: string;
    origin?: "conversation" | "project";
  }>();
  const { dispatch, applyProposal, createRestoreProposal } = useAppActions();
  const state = useAppStateSelector(selectDiffReviewState);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [rejectedHunkIds, setRejectedHunkIds] = useState<string[]>([]);
  const [expandedLargeHunkIds, setExpandedLargeHunkIds] = useState<string[]>(
    [],
  );
  const changeProposal = state.proposals[proposalId];
  const project = changeProposal
    ? state.projects[changeProposal.projectId]
    : undefined;
  const totalCount = changeProposal?.hunks.length ?? 0;
  const receipt = changeProposal?.appliedReceiptId
    ? state.receipts[changeProposal.appliedReceiptId]
    : undefined;
  const acceptedHunks = useMemo(
    () =>
      changeProposal?.hunks.filter((hunk) =>
        isDiffHunkAccepted(rejectedHunkIds, hunk.id),
      ) ?? [],
    [changeProposal, rejectedHunkIds],
  );
  const acceptedCount = acceptedHunks.length;
  const acceptedStats = useMemo(
    () => getProposalDiffStats(acceptedHunks),
    [acceptedHunks],
  );
  const appliedHunkIds = useMemo(
    () => new Set(receipt?.changes.map((change) => change.hunkId) ?? []),
    [receipt],
  );
  const diffListModel = useMemo(
    () =>
      createDiffReviewListModel(
        changeProposal?.hunks ?? EMPTY_DIFF_HUNKS,
        expandedLargeHunkIds,
      ),
    [changeProposal?.hunks, expandedLargeHunkIds],
  );
  const toggleHunk = useCallback((hunkId: string) => {
    setRejectedHunkIds((current) => toggleRejectedDiffHunk(current, hunkId));
  }, []);
  const expandHunk = useCallback((hunkId: string) => {
    setExpandedLargeHunkIds((current) =>
      current.includes(hunkId) ? current : [...current, hunkId],
    );
  }, []);
  const collapseHunk = useCallback((hunkId: string) => {
    setExpandedLargeHunkIds((current) =>
      current.filter((candidate) => candidate !== hunkId),
    );
  }, []);
  const diffItemKey = useCallback(
    (itemIndex: number) => diffReviewListRowKey(diffListModel, itemIndex),
    [diffListModel],
  );
  const renderDiffItem = useCallback(
    ({ item: itemIndex }: ListRenderItemInfo<number>) => {
      if (!changeProposal) return null;
      const row = resolveDiffReviewListRow(diffListModel, itemIndex);
      const hunk = changeProposal.hunks[row.hunkIndex];
      if (!hunk) return null;
      const accepted =
        changeProposal.status === "applied"
          ? receipt
            ? appliedHunkIds.has(hunk.id)
            : true
          : isDiffHunkAccepted(rejectedHunkIds, hunk.id);
      if (row.kind === "hunk-header") {
        return (
          <DiffHunkHeader
            accepted={accepted}
            hunk={hunk}
            index={row.hunkIndex}
            onToggle={toggleHunk}
            palette={palette}
            status={changeProposal.status}
            total={changeProposal.hunks.length}
          />
        );
      }
      if (row.kind === "line-segment") {
        return (
          <DiffLineView
            continued={row.segmentIndex > 0}
            line={row.line}
            palette={palette}
            rejected={!accepted}
            text={diffLineSegmentText(row.line.text, row.segmentIndex)}
          />
        );
      }
      const expanded =
        hunk.lines.length <= DIFF_EAGER_LINE_LIMIT ||
        expandedLargeHunkIds.includes(hunk.id);
      return (
        <DiffHunkFooter
          expanded={expanded}
          hunk={hunk}
          onCollapse={collapseHunk}
          onExpand={expandHunk}
          palette={palette}
          rejected={!accepted}
        />
      );
    },
    [
      appliedHunkIds,
      changeProposal,
      collapseHunk,
      diffListModel,
      expandHunk,
      expandedLargeHunkIds,
      palette,
      receipt,
      rejectedHunkIds,
      toggleHunk,
    ],
  );

  const returnToPrevious = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (changeProposal?.conversationId) {
      router.replace({
        pathname: "/conversation/[conversationId]",
        params: {
          conversationId: changeProposal.conversationId,
          projectId: changeProposal.projectId,
        },
      });
      return;
    }
    router.replace("/");
  };

  const applyChanges = async () => {
    if (!changeProposal) return;
    setApplyError(null);
    setIsApplying(true);
    try {
      await applyProposal(
        changeProposal.id,
        acceptedHunks.map((hunk) => hunk.id),
      );
    } catch (error) {
      setApplyError(localizedErrorMessage(error, t("changes.apply.failed")));
    } finally {
      setIsApplying(false);
    }
  };

  const restoreConversation = async () => {
    if (!changeProposal) return;
    let restoreProposalId: string | null = null;
    try {
      const restoreProposal = createRestoreProposal(
        receipt?.conversationId ?? changeProposal.conversationId,
      );
      restoreProposalId = restoreProposal.id;
      await applyProposal(restoreProposal.id);
    } catch (error) {
      Alert.alert(
        t("changes.error.restore"),
        localizedErrorMessage(error, t("changes.error.changed")),
      );
    } finally {
      if (!restoreProposalId) return;
      router.push({
        pathname: "/changes/[proposalId]",
        params: {
          proposalId: restoreProposalId,
          ...(origin ? { origin } : {}),
        },
      });
    }
  };

  if (!changeProposal) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={returnToPrevious}
          palette={palette}
          title={t("changes.review.title")}
        />
        <View style={styles.missingState}>
          <Text style={[styles.summaryTitle, { color: palette.text }]}>
            {t("changes.missing.title")}
          </Text>
          <Text
            style={[styles.missingDetail, { color: palette.textSecondary }]}
          >
            {t("changes.missing.detail")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={returnToPrevious}
        palette={palette}
        subtitle={
          changeProposal.kind === "agent"
            ? `${t("chat.content.aiGenerated")} · ${project?.name ?? t("changes.proposal.change")}`
            : (project?.name ?? t("changes.proposal.change"))
        }
        title={t("changes.review.title")}
      />

      <VirtualizedList<number>
        contentContainerStyle={styles.content}
        data={diffListModel}
        extraData={`${changeProposal.status}:${receipt?.id ?? ""}:${rejectedHunkIds.join(",")}`}
        getItem={getDiffListItem}
        getItemCount={getDiffListItemCount}
        initialNumToRender={18}
        keyExtractor={diffItemKey}
        ListHeaderComponent={
          <View style={styles.reviewHeader}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCopy}>
                <Text style={[styles.summaryTitle, { color: palette.text }]}>
                  {changeProposal.status === "applied"
                    ? t("changes.summary.applied", {
                        applied: receipt?.changes.length ?? totalCount,
                        total: totalCount,
                      })
                    : t("changes.summary.accepted", {
                        accepted: acceptedCount,
                        total: totalCount,
                      })}
                </Text>
                <Text
                  style={[
                    styles.summaryDetail,
                    { color: palette.textSecondary },
                  ]}
                >
                  +
                  {changeProposal.status === "applied"
                    ? (receipt?.additions ?? acceptedStats.additions)
                    : acceptedStats.additions}{" "}
                  / -
                  {changeProposal.status === "applied"
                    ? (receipt?.deletions ?? acceptedStats.deletions)
                    : acceptedStats.deletions}{" "}
                  ·{" "}
                  {t(
                    changeProposal.status === "applied"
                      ? "changes.status.applied"
                      : "changes.status.notApplied",
                  )}
                </Text>
              </View>
              <View
                style={[
                  styles.safetyBadge,
                  { backgroundColor: palette.accentSoft },
                ]}
              >
                <Ionicons
                  color={palette.accent}
                  name="shield-checkmark-outline"
                  size={15}
                />
                <Text style={[styles.safetyText, { color: palette.accent }]}>
                  {t(
                    changeProposal.kind === "restore"
                      ? "changes.proposal.restore"
                      : "changes.proposal.safe",
                  )}
                </Text>
              </View>
            </View>

            <MarkdownContent containerStyle={styles.proposalTitle}>
              {resolveMessageReference(
                changeProposal.titleMessage,
                changeProposal.title,
                t,
              )}
            </MarkdownContent>

            {changeProposal.status === "applied" ? (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.resultCard,
                  {
                    backgroundColor: palette.successSoft,
                    borderColor: palette.success,
                  },
                ]}
              >
                <View
                  style={[
                    styles.resultIcon,
                    { backgroundColor: palette.background },
                  ]}
                >
                  <Ionicons
                    color={palette.success}
                    name="checkmark"
                    size={19}
                  />
                </View>
                <View style={styles.resultCopy}>
                  <Text style={[styles.resultTitle, { color: palette.text }]}>
                    {changeProposal.kind === "restore"
                      ? t("changes.result.restoreComplete")
                      : t("changes.result.changeComplete")}
                  </Text>
                  <Text
                    style={[
                      styles.resultDetail,
                      { color: palette.textSecondary },
                    ]}
                  >
                    {receipt
                      ? t("changes.result.verified", {
                          additions: receipt.additions,
                          count: receipt.changes.length,
                          deletions: receipt.deletions,
                          versions: formatVersions(
                            receipt.changes.map(
                              (change) => change.afterVersion,
                            ),
                            t,
                          ),
                        })
                      : t("changes.result.recorded")}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View style={styles.reviewFooter}>
            {applyError ? (
              <Text style={[styles.applyError, { color: palette.danger }]}>
                {applyError}
              </Text>
            ) : null}

            {changeProposal.status === "pending" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  dispatch({
                    type: "draft/change",
                    value: t("changes.regenerate.prompt"),
                  });
                  if (origin === "project" && changeProposal.conversationId) {
                    dispatch({
                      type: "chat/open-conversation",
                      projectId: changeProposal.projectId,
                      conversationId: changeProposal.conversationId,
                    });
                    router.replace({
                      pathname: "/conversation/[conversationId]",
                      params: {
                        conversationId: changeProposal.conversationId,
                        projectId: changeProposal.projectId,
                      },
                    });
                  } else {
                    returnToPrevious();
                  }
                }}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  { borderColor: palette.borderStrong },
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <Ionicons
                  color={palette.text}
                  name="refresh-outline"
                  size={18}
                />
                <Text
                  style={[styles.secondaryActionText, { color: palette.text }]}
                >
                  {t("changes.regenerate.action")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        maxToRenderPerBatch={12}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={renderDiffItem}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        updateCellsBatchingPeriod={60}
        windowSize={7}
      />

      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: palette.background,
            borderTopColor: palette.border,
            paddingBottom: Math.max(spacing.sm, insets.bottom),
          },
        ]}
      >
        {changeProposal.status === "applied" ? (
          <>
            <View style={styles.bottomBarCopy}>
              <Text style={[styles.selectionTitle, { color: palette.text }]}>
                {changeProposal.kind === "restore"
                  ? t("changes.applied.restoreTitle")
                  : t("changes.applied.changeTitle")}
              </Text>
              <Text
                style={[
                  styles.selectionDetail,
                  { color: palette.textSecondary },
                ]}
              >
                {changeProposal.kind === "restore"
                  ? t("changes.applied.restoreDetail")
                  : t("changes.applied.changeDetail")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={false}
              key={`applied-action-${changeProposal.id}`}
              onPress={
                changeProposal.kind === "restore"
                  ? returnToPrevious
                  : () => void restoreConversation()
              }
              style={({ pressed }) => [
                styles.primaryAction,
                { backgroundColor: palette.text },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text
                style={[
                  styles.primaryActionText,
                  { color: palette.background },
                ]}
              >
                {changeProposal.kind === "restore"
                  ? t("changes.applied.back")
                  : t("changes.review.undo")}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.bottomBarCopy}>
              <Text style={[styles.selectionTitle, { color: palette.text }]}>
                {acceptedCount === totalCount
                  ? t("changes.selection.all", { total: totalCount })
                  : t("changes.selection.some", {
                      accepted: acceptedCount,
                      total: totalCount,
                    })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={isApplying || acceptedCount === 0}
              onPress={() => void applyChanges()}
              style={({ pressed }) => [
                styles.primaryAction,
                { backgroundColor: palette.text },
                (isApplying || acceptedCount === 0) && { opacity: 0.45 },
                pressed && { opacity: 0.75 },
              ]}
            >
              {isApplying ? (
                <LoadingIndicator
                  color={palette.background}
                  palette={palette}
                  variant="inline"
                />
              ) : null}
              <Text
                style={[
                  styles.primaryActionText,
                  { color: palette.background },
                ]}
              >
                {isApplying
                  ? t("changes.apply.progress")
                  : acceptedCount === 0
                    ? t("changes.apply.none")
                    : changeProposal.kind === "restore"
                      ? t("changes.apply.restore", { count: acceptedCount })
                      : t("changes.apply.submit", { count: acceptedCount })}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function formatVersions(
  versions: string[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const labels = [...new Set(versions)].map((version) =>
    /^\d+$/u.test(version) ? `v${version}` : `#${version.slice(0, 8)}`,
  );
  return t("changes.review.versions", { versions: labels.join(" / ") });
}

function DiffHunkHeader({
  accepted,
  hunk,
  index,
  onToggle,
  palette,
  status,
  total,
}: {
  accepted: boolean;
  hunk: DiffHunk;
  index: number;
  onToggle: (hunkId: string) => void;
  palette: ReturnType<typeof useAppPalette>;
  status: "applied" | "pending";
  total: number;
}) {
  const { t } = useI18n();
  return (
    <View
      style={[
        styles.hunkHeader,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        !accepted && styles.rejectedHunk,
      ]}
    >
      <View style={styles.hunkCopy}>
        <Text style={[styles.hunkEyebrow, { color: palette.textSecondary }]}>
          {t("changes.hunk.summary", {
            index: index + 1,
            status: t(
              accepted ? "changes.hunk.accepted" : "changes.hunk.rejected",
            ),
            total,
          })}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.target, { color: palette.text }]}
        >
          {hunk.target}
        </Text>
      </View>
      {status === "applied" ? (
        <Text
          style={[
            styles.defaultPolicy,
            { color: accepted ? palette.accent : palette.danger },
          ]}
        >
          {t(accepted ? "changes.hunk.applied" : "changes.hunk.notApplied")}
        </Text>
      ) : (
        <Pressable
          accessibilityLabel={t("changes.hunk.toggle", {
            action: t(
              getDiffHunkToggleAction(accepted) === "reject"
                ? "changes.hunk.reject"
                : "changes.hunk.accept",
            ),
            index: index + 1,
          })}
          accessibilityRole="button"
          onPress={() => onToggle(hunk.id)}
          style={({ pressed }) => [
            styles.hunkToggle,
            { borderColor: accepted ? palette.danger : palette.accent },
            pressed && { opacity: 0.55 },
          ]}
        >
          <Text
            style={[
              styles.hunkToggleText,
              { color: accepted ? palette.danger : palette.accent },
            ]}
          >
            {t(
              getDiffHunkToggleAction(accepted) === "reject"
                ? "changes.hunk.reject"
                : "changes.hunk.accept",
            )}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function DiffHunkFooter({
  expanded,
  hunk,
  onCollapse,
  onExpand,
  palette,
  rejected,
}: {
  expanded: boolean;
  hunk: DiffHunk;
  onCollapse: (hunkId: string) => void;
  onExpand: (hunkId: string) => void;
  palette: ReturnType<typeof useAppPalette>;
  rejected: boolean;
}) {
  const { t } = useI18n();
  const largeHunk = hunk.lines.length > DIFF_EAGER_LINE_LIMIT;
  return (
    <View
      style={[
        styles.hunkFooter,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        rejected && styles.rejectedHunk,
      ]}
    >
      {!expanded ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onExpand(hunk.id)}
          style={({ pressed }) => [
            styles.collapsedDiff,
            { backgroundColor: palette.codeSurface },
            pressed && { opacity: 0.68 },
          ]}
        >
          <Ionicons
            color={palette.textSecondary}
            name="code-slash-outline"
            size={18}
          />
          <Text style={{ color: palette.textSecondary }}>
            {t("changes.hunk.showLines", { count: hunk.lines.length })}
          </Text>
        </Pressable>
      ) : largeHunk ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onCollapse(hunk.id)}
          style={({ pressed }) => [
            styles.largeHunkToggle,
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <Text style={{ color: palette.textSecondary }}>
            {t("changes.hunk.hideLines")}
          </Text>
        </Pressable>
      ) : null}
      <View style={[styles.reason, { borderTopColor: palette.border }]}>
        <Ionicons
          color={palette.textSecondary}
          name="information-circle-outline"
          size={17}
        />
        <MarkdownContent
          containerStyle={styles.reasonMarkdown}
          variant="compact"
        >
          {resolveMessageReference(hunk.summaryMessage, hunk.summary, t)}
        </MarkdownContent>
      </View>
    </View>
  );
}

function DiffLineView({
  continued,
  line,
  palette,
  rejected,
  text,
}: {
  continued: boolean;
  line: DiffLine;
  palette: ReturnType<typeof useAppPalette>;
  rejected: boolean;
  text: string;
}) {
  const backgroundColor =
    line.kind === "addition"
      ? palette.additionSoft
      : line.kind === "deletion"
        ? palette.deletionSoft
        : palette.codeSurface;
  const color =
    line.kind === "addition"
      ? palette.addition
      : line.kind === "deletion"
        ? palette.deletion
        : line.kind === "meta"
          ? palette.textSecondary
          : palette.text;

  return (
    <View
      style={[
        styles.diffLine,
        continued && styles.diffLineContinuation,
        { backgroundColor, borderColor: palette.border },
        rejected && styles.rejectedHunk,
      ]}
    >
      <Text selectable style={[styles.diffText, { color }]}>
        {text || " "}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
  missingState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  missingDetail: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  content: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  reviewHeader: { gap: spacing.md },
  reviewFooter: { gap: spacing.md, paddingTop: spacing.md },
  proposalTitle: { minWidth: 0 },
  summaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.lg,
  },
  summaryCopy: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  summaryTitle: { fontSize: 17, fontWeight: "600" },
  summaryDetail: { fontSize: 13, marginTop: 3 },
  safetyBadge: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  safetyText: { fontSize: 12, fontWeight: "600" },
  resultCard: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  resultIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 14, fontWeight: "600" },
  resultDetail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  rejectedHunk: { opacity: 0.58 },
  hunkHeader: {
    alignItems: "center",
    borderTopLeftRadius: radii.md,
    borderTopRightRadius: radii.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  hunkCopy: { flex: 1, minWidth: 0 },
  hunkEyebrow: { fontSize: 11 },
  defaultPolicy: { fontSize: 12, fontWeight: "600" },
  hunkToggle: {
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  hunkToggleText: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  target: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12.5,
    marginTop: 3,
  },
  diffLine: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    minHeight: 25,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  diffLineContinuation: { paddingTop: 0 },
  diffText: {
    flexShrink: 1,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12.5,
    lineHeight: 18,
    minWidth: 0,
  },
  hunkFooter: {
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
    borderTopWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  collapsedDiff: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 56,
    padding: spacing.sm,
  },
  largeHunkToggle: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  reason: {
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  reasonMarkdown: { flex: 1, minWidth: 0 },
  secondaryAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryActionText: { fontSize: 14, fontWeight: "500" },
  bottomBar: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bottomBarCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: spacing.xs,
  },
  selectionTitle: { fontSize: 14, fontWeight: "600" },
  selectionDetail: { fontSize: 11, marginTop: 2 },
  primaryAction: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: { fontSize: 14, fontWeight: "600" },
  applyError: { fontSize: 13, lineHeight: 20, marginTop: spacing.md },
});
