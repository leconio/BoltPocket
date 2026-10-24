import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SkillMarketDetail } from "@/application/ports/skill-market";
import { AppIcon, type IconName } from "@/components/app-icon";
import { LoadingIndicator } from "@/components/loading-indicator";
import { MarkdownContent } from "@/components/markdown-content";
import { ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  useAppActions,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { BOLTPOCKET_MARKET_SOURCE } from "@/infrastructure/capabilities/skill-market-client";
import { useAppServices } from "@/providers/runtime-services-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

export function SkillMarketDetailScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    capabilityCatalogRegion,
    skillMarket,
    skillMarketPublisherBlocklist,
  } = useAppServices();
  const params = useLocalSearchParams<{ entryId?: string | string[] }>();
  const entryId = Array.isArray(params.entryId)
    ? params.entryId[0]
    : params.entryId;
  const { installDownloadedSkill } = useAppActions();
  const downloadedSkillItems = useSessionStateSelector(
    (session) => session.downloadedSkillItems,
  );
  const downloadedSkillsLoading = useSessionStateSelector(
    (session) => session.downloadedSkillsLoading,
  );
  const [loadState, setLoadState] = useState<
    Readonly<{
      detail?: SkillMarketDetail;
      failed: boolean;
      requestKey: string;
    }>
  >({ failed: false, requestKey: "" });
  const [installing, setInstalling] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [publisherBlockState, setPublisherBlockState] = useState<Readonly<{
    blocked: boolean;
    publisherId: string;
  }> | null>(null);
  const requestKey = `${entryId ?? "missing"}:${requestVersion}`;
  const detail =
    loadState.requestKey === requestKey ? (loadState.detail ?? null) : null;
  const error =
    !entryId ||
    (loadState.requestKey === requestKey && loadState.failed === true);
  const publisherBlocked =
    detail && publisherBlockState?.publisherId === detail.summary.publisherId
      ? publisherBlockState.blocked
      : null;

  useEffect(() => {
    if (!entryId) return;
    const controller = new AbortController();
    void skillMarket
      .loadDetail(entryId, capabilityCatalogRegion, controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) {
            setLoadState({ detail: value, failed: false, requestKey });
          }
        },
        () => {
          if (!controller.signal.aborted) {
            setLoadState({ failed: true, requestKey });
          }
        },
      );
    return () => controller.abort();
  }, [capabilityCatalogRegion, entryId, requestKey, skillMarket]);

  useEffect(() => {
    if (!detail) return;
    let active = true;
    void skillMarketPublisherBlocklist
      .isBlocked(detail.summary.publisherId)
      .then((blocked) => {
        if (active) {
          setPublisherBlockState({
            blocked,
            publisherId: detail.summary.publisherId,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detail, skillMarketPublisherBlocklist]);

  const localized = (value: Readonly<{ en: string; zhCN: string }>) =>
    locale === "zh-CN" ? value.zhCN : value.en;
  const installed = Boolean(
    detail &&
    downloadedSkillItems.some(
      (item) =>
        item.projectId === null &&
        item.sourceId === BOLTPOCKET_MARKET_SOURCE.id &&
        item.catalogId === detail.summary.id,
    ),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/", params: { market: "1" } });
  };

  const download = async () => {
    if (
      !detail ||
      publisherBlocked !== false ||
      installing ||
      installed ||
      downloadedSkillsLoading
    )
      return;
    setInstalling(true);
    try {
      const capability = await skillMarket.downloadSkill(
        detail.summary.id,
        capabilityCatalogRegion,
      );
      if (
        capability.revision !== detail.summary.revision ||
        capability.risk !== detail.summary.risk ||
        capability.sha256 !== detail.summary.sha256
      ) {
        throw new Error("The Skill changed while its details were open.");
      }
      const result = await installDownloadedSkill({
        autoUpdate: false,
        capability,
      });
      Alert.alert(
        localized(detail.summary.name),
        t(
          result.updateTracking === "unavailable"
            ? "market.detail.downloadTrackingUnavailable"
            : "market.detail.downloadSuccess",
        ),
      );
    } catch (caught) {
      Alert.alert(
        t("market.detail.downloadFailed"),
        localizedErrorMessage(caught, t("market.detail.retry")),
      );
    } finally {
      setInstalling(false);
    }
  };

  const report = () => {
    if (!detail) return;
    router.push({
      pathname: "/conversation/report" as never,
      params: {
        excerpt: detail.readmeDocument.slice(0, 4_000),
        targetId: detail.summary.id,
        targetLabel: localized(detail.summary.name),
        targetType: "capability_entry",
      },
    } as never);
  };

  const togglePublisherBlock = () => {
    if (!detail) return;
    if (publisherBlocked === null) return;
    const next = !publisherBlocked;
    Alert.alert(
      t(next ? "market.safety.blockTitle" : "market.safety.unblockTitle"),
      t(next ? "market.safety.blockDetail" : "market.safety.unblockDetail", {
        provider: localized(detail.summary.provider),
      }),
      [
        { text: t("market.safety.cancel"), style: "cancel" },
        {
          text: t(next ? "market.safety.block" : "market.safety.unblock"),
          style: next ? "destructive" : "default",
          onPress: () => {
            void skillMarketPublisherBlocklist
              .setBlocked(detail.summary.publisherId, next)
              .then(() =>
                setPublisherBlockState({
                  blocked: next,
                  publisherId: detail.summary.publisherId,
                }),
              )
              .catch((error) =>
                Alert.alert(
                  t("market.safety.failed"),
                  localizedErrorMessage(error, t("market.detail.retry")),
                ),
              );
          },
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.safeArea,
        { backgroundColor: palette.background, marginTop: insets.top },
      ]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        title={detail ? localized(detail.summary.name) : t("market.list.title")}
      />

      {error ? (
        <View style={styles.centerState}>
          <View
            style={[styles.stateIcon, { backgroundColor: palette.codeSurface }]}
          >
            <AppIcon
              color={palette.textSecondary}
              name="cloud-offline-outline"
              size={25}
            />
          </View>
          <Text style={[styles.stateTitle, { color: palette.text }]}>
            {t("market.error.title")}
          </Text>
          <Text style={[styles.stateDetail, { color: palette.textSecondary }]}>
            {t("market.error.detail")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRequestVersion((value) => value + 1)}
            style={({ pressed }) => [
              styles.retry,
              { borderColor: palette.borderStrong },
              pressed && { backgroundColor: palette.codeSurface },
            ]}
          >
            <Text style={[styles.retryText, { color: palette.text }]}>
              {t("market.error.retry")}
            </Text>
          </Pressable>
        </View>
      ) : detail === null ? (
        <LoadingIndicator
          accessibilityLabel={t("market.list.loading")}
          palette={palette}
          style={styles.loading}
          variant="screen"
        />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 92 + Math.max(insets.bottom, spacing.sm) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summary}>
              <View
                style={[
                  styles.skillIcon,
                  { backgroundColor: palette.accentSoft },
                ]}
              >
                <AppIcon
                  color={palette.accent}
                  name="extension-puzzle-outline"
                  size={28}
                />
              </View>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: palette.text }]}
              >
                {localized(detail.summary.name)}
              </Text>
              <Text
                style={[styles.description, { color: palette.textSecondary }]}
              >
                {localized(detail.summary.description)}
              </Text>
              <View style={styles.providerLine}>
                {detail.summary.verified ? (
                  <AppIcon
                    color={palette.accent}
                    name="checkmark-circle"
                    size={16}
                  />
                ) : null}
                <Text
                  style={[
                    styles.provider,
                    {
                      color: detail.summary.verified
                        ? palette.accent
                        : palette.textSecondary,
                    },
                  ]}
                >
                  {localized(detail.summary.provider)}
                </Text>
              </View>
              <View style={styles.tags}>
                {detail.summary.tags.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tag,
                      { backgroundColor: palette.codeSurface },
                    ]}
                  >
                    <Text
                      style={[styles.tagText, { color: palette.textSecondary }]}
                    >
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <SectionTitle title={t("market.detail.info")} />
            <View
              style={[
                styles.infoGroup,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <InfoRow
                icon="person-outline"
                label={t("market.detail.provider")}
                value={localized(detail.summary.provider)}
              />
              <InfoRow
                icon="apps-outline"
                label={t("market.detail.category")}
                value={t(`market.category.${detail.summary.category}`)}
              />
              <InfoRow
                icon="shield-checkmark-outline"
                label={t("market.detail.risk")}
                value={t(
                  detail.summary.risk === "read"
                    ? "market.risk.read"
                    : "market.risk.propose",
                )}
              />
              <InfoRow
                icon="document-text-outline"
                label={t("market.detail.license")}
                value={detail.summary.license}
              />
              <InfoRow
                icon="git-commit-outline"
                label={t("market.detail.revision")}
                value={detail.summary.revision}
              />
              <InfoRow
                icon="people-outline"
                label={t("market.detail.ageRating")}
                last
                value={detail.summary.ageRating}
              />
            </View>

            <SectionTitle title={t("market.safety.title")} />
            <View
              style={[
                styles.safetyActions,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <SafetyAction
                icon="flag-outline"
                label={t("market.safety.report")}
                onPress={report}
              />
              <SafetyAction
                icon={publisherBlocked ? "eye-outline" : "ban-outline"}
                label={t(
                  publisherBlocked
                    ? "market.safety.unblock"
                    : "market.safety.block",
                )}
                onPress={togglePublisherBlock}
              />
            </View>

            <SectionTitle title={t("market.detail.preview")} />
            <View
              style={[
                styles.preview,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View
                style={[
                  styles.fileLabel,
                  { borderBottomColor: palette.border },
                ]}
              >
                <AppIcon
                  color={palette.textSecondary}
                  name="document-text-outline"
                  size={16}
                />
                <Text
                  style={[
                    styles.fileLabelText,
                    { color: palette.textSecondary },
                  ]}
                >
                  README.md
                </Text>
              </View>
              <MarkdownContent
                containerStyle={styles.markdown}
                variant="detail"
              >
                {detail.readmeDocument}
              </MarkdownContent>
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                backgroundColor: palette.surface,
                borderTopColor: palette.border,
                paddingBottom: Math.max(insets.bottom, spacing.sm),
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                busy: installing,
                disabled:
                  publisherBlocked !== false ||
                  installed ||
                  downloadedSkillsLoading,
              }}
              disabled={
                publisherBlocked !== false ||
                installed ||
                installing ||
                downloadedSkillsLoading
              }
              onPress={() => void download()}
              style={({ pressed }) => [
                styles.download,
                {
                  backgroundColor: installed
                    ? palette.codeSurface
                    : palette.accent,
                },
                pressed &&
                  !installed && { backgroundColor: palette.accentPressed },
                (installing || downloadedSkillsLoading) && { opacity: 0.65 },
              ]}
            >
              <AppIcon
                color={installed ? palette.textSecondary : palette.accentText}
                name={installed ? "checkmark-circle" : "cloud-download-outline"}
                size={20}
              />
              <Text
                style={[
                  styles.downloadText,
                  {
                    color: installed
                      ? palette.textSecondary
                      : palette.accentText,
                  },
                ]}
              >
                {installed
                  ? t("market.detail.downloaded")
                  : publisherBlocked === true
                    ? t("market.safety.blocked")
                    : publisherBlocked === null
                      ? t("market.detail.checking")
                      : installing
                        ? t("market.detail.downloading")
                        : downloadedSkillsLoading
                          ? t("market.detail.checking")
                          : t("market.detail.download")}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function SafetyAction({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.safetyAction,
        { borderBottomColor: palette.border },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <AppIcon color={palette.textSecondary} name={icon} size={18} />
      <Text style={[styles.safetyActionText, { color: palette.text }]}>
        {label}
      </Text>
      <AppIcon color={palette.textTertiary} name="chevron-forward" size={16} />
    </Pressable>
  );
}

function SectionTitle({ title }: { title: string }) {
  const palette = useAppPalette();
  return (
    <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
  );
}

function InfoRow({
  icon,
  label,
  last = false,
  value,
}: {
  icon: IconName;
  label: string;
  last?: boolean;
  value: string;
}) {
  const palette = useAppPalette();
  return (
    <View
      style={[
        styles.infoRow,
        !last && {
          borderBottomColor: palette.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <AppIcon color={palette.textSecondary} name={icon} size={18} />
      <Text style={[styles.infoLabel, { color: palette.textSecondary }]}>
        {label}
      </Text>
      <Text
        numberOfLines={2}
        selectable
        style={[styles.infoValue, { color: palette.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { flex: 1 },
  centerState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  stateIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  stateTitle: { fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  stateDetail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
    maxWidth: 300,
    textAlign: "center",
  },
  retry: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  retryText: { fontSize: 14, fontWeight: "600" },
  content: { paddingHorizontal: spacing.md },
  summary: { alignItems: "flex-start", paddingVertical: spacing.xl },
  skillIcon: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 54,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: 54,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  description: { fontSize: 15, lineHeight: 23, marginTop: spacing.xs },
  providerLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    marginTop: spacing.sm,
  },
  provider: { fontSize: 13, fontWeight: "600" },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  tagText: { fontSize: 12, fontWeight: "600" },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  infoGroup: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  infoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  infoLabel: { fontSize: 13, width: 78 },
  infoValue: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "right",
  },
  safetyActions: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  safetyAction: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  safetyActionText: { flex: 1, fontSize: 14, fontWeight: "600" },
  preview: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  fileLabel: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  fileLabelText: {
    fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    fontWeight: "600",
  },
  markdown: { paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    position: "absolute",
    right: 0,
  },
  download: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  downloadText: { fontSize: 15, fontWeight: "700" },
});
