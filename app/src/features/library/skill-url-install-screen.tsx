import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SkillCapability } from "@/application/ports/capability-catalog";
import { assessSkillCapability } from "@/application/skill-assessment";
import { AppIcon } from "@/components/app-icon";
import { LabeledTextField } from "@/components/labeled-text-field";
import { AppSwitch, BottomSheet, ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import type { McpCatalogLocalizedText } from "@/infrastructure/mcp/mcp-catalog-client";
import {
  DIRECT_SKILL_SOURCE_ID,
  DirectSkillUrlError,
  type DirectSkillUrlErrorCode,
} from "@/infrastructure/capabilities/direct-skill-url";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { useAppServices } from "@/providers/runtime-services-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectSkillUrlInstallState = createAppStateFieldsSelector("projects");

const ERROR_MESSAGE_KEYS = {
  "integrity-failed": "library.skillUrl.error.integrityFailed",
  "invalid-document": "library.skillUrl.error.invalidDocument",
  "invalid-url": "library.skillUrl.error.invalidUrl",
  "request-failed": "library.skillUrl.error.requestFailed",
  "unsafe-url": "library.skillUrl.error.unsafeUrl",
} as const satisfies Record<DirectSkillUrlErrorCode, MessageKey>;

export function SkillUrlInstallScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { installDownloadedSkill } = useAppActions();
  const { directSkillUrlResolver } = useAppServices();
  const state = useAppStateSelector(selectSkillUrlInstallState);
  const downloadedSkillItems = useSessionStateSelector(
    (session) => session.downloadedSkillItems,
  );
  const mcpConnectionItems = useSessionStateSelector(
    (session) => session.mcpConnectionItems,
  );
  const project = projectId ? state.projects[projectId] : undefined;
  const request = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string>();
  const [selected, setSelected] = useState<SkillCapability | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  const localized = (value: McpCatalogLocalizedText) =>
    locale === "zh-CN" ? value.zhCN : value.en;
  const assessment = useMemo(
    () =>
      selected
        ? assessSkillCapability({
            capability: selected,
            connectedMcpServerUrls: mcpConnectionItems
              .filter((item) => item.enabled)
              .map((item) => item.serverUrl),
            locale,
          })
        : null,
    [locale, mcpConnectionItems, selected],
  );
  const requiresProjectForCompletePackage = Boolean(
    selected && !project && selected.bundle.files.length > 1,
  );
  const displayedAssessmentStatus = requiresProjectForCompletePackage
    ? "unsupported"
    : (assessment?.status ?? "unsupported");

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: "/skills",
        params: projectId ? { projectId } : {},
      });
  };

  const changeUrl = (value: string) => {
    request.current?.abort();
    request.current = null;
    setResolving(false);
    setUrl(value);
    setUrlError(undefined);
  };

  const resolveUrl = async () => {
    const normalized = url.trim();
    if (!normalized || resolving) {
      if (!normalized) setUrlError(t("library.skillUrl.error.invalidUrl"));
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setResolving(true);
    setUrlError(undefined);
    try {
      const capability = await directSkillUrlResolver.resolve(
        normalized,
        controller.signal,
      );
      if (controller.signal.aborted || request.current !== controller) return;
      if (
        downloadedSkillItems.some(
          (item) =>
            item.projectId === (project?.id ?? null) &&
            item.sourceId === capability.source.id &&
            item.catalogId === capability.source.entryId,
        )
      ) {
        Alert.alert(
          localized(capability.name),
          t("library.capabilities.installed"),
        );
        return;
      }
      setUrl(capability.documentationUrl);
      setAutoUpdate(
        Boolean(project) &&
          capability.bundle.files.length === 1 &&
          capability.source.id !== DIRECT_SKILL_SOURCE_ID,
      );
      setSelected(capability);
    } catch (error) {
      if (controller.signal.aborted || request.current !== controller) return;
      const key =
        error instanceof DirectSkillUrlError
          ? ERROR_MESSAGE_KEYS[error.code]
          : "library.skillUrl.error.requestFailed";
      setUrlError(t(key));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setResolving(false);
      }
    }
  };

  const install = async () => {
    if (
      !selected ||
      assessment?.status === "unsupported" ||
      requiresProjectForCompletePackage
    )
      return;
    setInstalling(true);
    try {
      const result = await installDownloadedSkill({
        autoUpdate,
        capability: selected,
        ...(project ? { projectId: project.id } : {}),
      });
      setSelected(null);
      Alert.alert(
        localized(selected.name),
        t(
          result.updateTracking === "unavailable"
            ? "library.capabilities.installDoneWithoutUpdates"
            : project
              ? "library.capabilities.installDone"
              : "library.capabilities.installDoneInventory",
        ),
      );
    } catch {
      Alert.alert(
        t("library.capabilities.installFailed"),
        t("library.common.retry"),
      );
    } finally {
      setInstalling(false);
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
        subtitle={project?.name}
        title={t("library.capabilities.addTitle")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode={
          process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <AppIcon color={palette.accent} name="link-outline" size={24} />
          <View style={styles.introCopy}>
            <Text style={[styles.introTitle, { color: palette.text }]}>
              {t("library.skillUrl.introTitle")}
            </Text>
            <Text
              style={[styles.introDetail, { color: palette.textSecondary }]}
            >
              {t("library.skillUrl.introDetail")}
            </Text>
          </View>
        </View>

        <LabeledTextField
          autoCapitalize="none"
          autoCorrect={false}
          editable={!resolving}
          error={urlError}
          hint={t("library.skillUrl.urlHint")}
          keyboardType="url"
          label={t("library.skillUrl.urlLabel")}
          onChangeText={changeUrl}
          onSubmitEditing={() => void resolveUrl()}
          placeholder={t("library.skillUrl.urlPlaceholder")}
          returnKeyType="go"
          value={url}
        />

        <View
          style={[
            styles.privacyNotice,
            { backgroundColor: palette.codeSurface },
          ]}
        >
          <AppIcon
            color={palette.textSecondary}
            name="shield-checkmark-outline"
            size={19}
          />
          <Text style={[styles.privacyText, { color: palette.textSecondary }]}>
            {t("library.skillUrl.privacyNotice")}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: resolving || !url.trim() }}
          disabled={resolving || !url.trim()}
          onPress={() => void resolveUrl()}
          style={({ pressed }) => [
            styles.resolveButton,
            { backgroundColor: palette.text },
            (resolving || !url.trim()) && { opacity: 0.35 },
            pressed && { opacity: 0.72 },
          ]}
        >
          <Text
            style={[styles.resolveButtonText, { color: palette.background }]}
          >
            {t(
              resolving
                ? "library.skillUrl.resolving"
                : "library.skillUrl.review",
            )}
          </Text>
        </Pressable>
      </ScrollView>

      <BottomSheet
        onClose={() => !installing && setSelected(null)}
        palette={palette}
        title={
          selected
            ? t("library.capabilities.installTitle", {
                name: localized(selected.name),
              })
            : t("library.capabilities.addTitle")
        }
        visible={Boolean(selected)}
      >
        {selected && assessment ? (
          <View style={styles.sheetContent}>
            <Text style={[styles.meta, { color: palette.textSecondary }]}>
              {t("library.capabilities.publisher", {
                provider: localized(selected.provider),
                revision: selected.revision,
                risk: t(`library.capabilities.risk.${selected.risk}`),
              })}
            </Text>
            <Text style={[styles.meta, { color: palette.textSecondary }]}>
              {t("library.capabilities.packageSummary", {
                bytes: selected.bundle.totalBytes.toLocaleString(locale),
                files: selected.bundle.files.length,
                sha256: selected.bundle.sha256,
              })}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(selected.documentationUrl)}
            >
              <Text style={[styles.originalUrlLink, { color: palette.accent }]}>
                {t("library.skillUrl.originalUrl")}
              </Text>
            </Pressable>
            <Text style={[styles.notice, { color: palette.text }]}>
              {t(
                project
                  ? "library.capabilities.installNotice"
                  : "library.capabilities.installNoticeInventory",
              )}
            </Text>
            <View
              style={[
                styles.assessment,
                {
                  backgroundColor:
                    displayedAssessmentStatus === "unsupported"
                      ? palette.dangerSoft
                      : palette.accentSoft,
                },
              ]}
            >
              <Text
                style={[
                  styles.assessmentTitle,
                  {
                    color:
                      displayedAssessmentStatus === "unsupported"
                        ? palette.danger
                        : palette.accent,
                  },
                ]}
              >
                {t(
                  `library.capabilities.assessment.${displayedAssessmentStatus}`,
                )}
              </Text>
              {assessment.checks.map((check) => (
                <View key={`${check.kind}:${check.id}`} style={styles.checkRow}>
                  <AppIcon
                    color={check.available ? palette.accent : palette.danger}
                    name={check.available ? "checkmark-circle" : "alert-circle"}
                    size={17}
                  />
                  <Text style={[styles.checkLabel, { color: palette.text }]}>
                    {check.label}
                  </Text>
                  <Text
                    style={[
                      styles.checkValue,
                      {
                        color: check.available
                          ? palette.textSecondary
                          : palette.danger,
                      },
                    ]}
                  >
                    {t(
                      check.available
                        ? "library.capabilities.checkReady"
                        : "library.capabilities.checkMissing",
                    )}
                  </Text>
                </View>
              ))}
              {requiresProjectForCompletePackage ? (
                <View style={styles.checkRow}>
                  <AppIcon
                    color={palette.danger}
                    name="alert-circle"
                    size={17}
                  />
                  <Text style={[styles.checkLabel, { color: palette.text }]}>
                    {t("library.capabilities.completePackageProjectOnly")}
                  </Text>
                  <Text style={[styles.checkValue, { color: palette.danger }]}>
                    {t("library.capabilities.checkMissing")}
                  </Text>
                </View>
              ) : null}
            </View>
            {project &&
            selected.bundle.files.length === 1 &&
            selected.source.id !== DIRECT_SKILL_SOURCE_ID ? (
              <View style={styles.autoUpdateRow}>
                <View style={styles.autoUpdateCopy}>
                  <Text
                    style={[styles.autoUpdateTitle, { color: palette.text }]}
                  >
                    {t("library.capabilities.autoUpdate")}
                  </Text>
                  <Text
                    style={[
                      styles.autoUpdateDetail,
                      { color: palette.textSecondary },
                    ]}
                  >
                    {t("library.capabilities.autoUpdateDetail")}
                  </Text>
                </View>
                <AppSwitch
                  accessibilityLabel={t("library.capabilities.autoUpdate")}
                  ios_backgroundColor={palette.borderStrong}
                  onValueChange={setAutoUpdate}
                  thumbColor={autoUpdate ? palette.accentText : palette.surface}
                  trackColor={{
                    false: palette.borderStrong,
                    true: palette.accent,
                  }}
                  value={autoUpdate}
                />
              </View>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={installing}
                onPress={() => setSelected(null)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: palette.border },
                  pressed && { opacity: 0.62 },
                ]}
              >
                <Text style={[styles.secondaryText, { color: palette.text }]}>
                  {t("library.capabilities.cancel")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={
                  installing ||
                  assessment.status === "unsupported" ||
                  requiresProjectForCompletePackage
                }
                onPress={() => void install()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: palette.text },
                  (installing ||
                    assessment.status === "unsupported" ||
                    requiresProjectForCompletePackage) && {
                    opacity: 0.35,
                  },
                  pressed && { opacity: 0.72 },
                ]}
              >
                <Text
                  style={[styles.primaryText, { color: palette.background }]}
                >
                  {t(
                    installing
                      ? "library.capabilities.installing"
                      : "library.capabilities.install",
                  )}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xxl },
  intro: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  introCopy: { flex: 1, gap: spacing.xxs },
  introTitle: { fontSize: 18, fontWeight: "700", lineHeight: 24 },
  introDetail: { fontSize: 14, lineHeight: 21 },
  privacyNotice: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 19 },
  resolveButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 50,
  },
  resolveButtonText: { fontSize: 16, fontWeight: "700" },
  sheetContent: { gap: spacing.md },
  meta: { fontSize: 13, lineHeight: 19 },
  originalUrlLink: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  notice: { fontSize: 15, lineHeight: 22 },
  assessment: { borderRadius: radii.md, gap: spacing.sm, padding: spacing.md },
  assessmentTitle: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  checkRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  checkLabel: { flex: 1, fontSize: 14 },
  checkValue: { fontSize: 12, fontWeight: "600" },
  autoUpdateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  autoUpdateCopy: { flex: 1, gap: spacing.xxs },
  autoUpdateTitle: { fontSize: 16, fontWeight: "600" },
  autoUpdateDetail: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", gap: spacing.sm },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryText: { fontSize: 15, fontWeight: "600" },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  primaryText: { fontSize: 15, fontWeight: "700" },
});
