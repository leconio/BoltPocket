import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/app-icon";
import { LoadingIndicator } from "@/components/loading-indicator";
import { loadComplianceConfig } from "@/config/compliance";
import {
  complianceDocument,
  type ComplianceDocumentId,
} from "@/domain/compliance-documents";
import { useI18n } from "@/i18n/i18n-provider";
import {
  MAINLAND_PRIVACY_POLICY_VERSION,
  PrivacyConsentRepository,
  type PrivacyConsentDecision,
  type PrivacyConsentRecord,
} from "@/infrastructure/privacy/privacy-consent-repository";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type PrivacyConsentStatus =
  "loading" | "required" | "accepted" | "declined" | "not-required" | "error";

type PrivacyConsentContextValue = Readonly<{
  status: PrivacyConsentStatus;
  record: PrivacyConsentRecord | null;
  policyVersion: string;
  reconsider(): void;
  withdrawGeneralConsent(): Promise<void>;
}>;

const PrivacyConsentContext = createContext<PrivacyConsentContextValue | null>(
  null,
);

const privacyPointKeys = [
  "privacy.consent.point.local",
  "privacy.consent.point.network",
  "privacy.consent.point.permissions",
  "privacy.consent.point.tracking",
] as const;

export function PrivacyConsentBoundary({ children }: PropsWithChildren) {
  const { ready, t } = useI18n();
  const palette = useAppPalette();
  const [config] = useState(loadComplianceConfig);
  const mainland = config.distributionRegion === "china-mainland";
  const [repository] = useState(() =>
    mainland ? new PrivacyConsentRepository(config) : null,
  );
  const [status, setStatus] = useState<PrivacyConsentStatus>(
    mainland ? "loading" : "not-required",
  );
  const [record, setRecord] = useState<PrivacyConsentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    void repository.loadCurrent().then(
      (stored) => {
        if (!active) return;
        setRecord(stored);
        setStatus(
          stored?.decision === "accepted"
            ? "accepted"
            : stored?.decision === "declined"
              ? "declined"
              : "required",
        );
      },
      () => {
        if (!active) return;
        setStatus("error");
        setErrorMessage(t("privacy.consent.storageError"));
      },
    );
    return () => {
      active = false;
    };
  }, [repository, retryVersion, t]);

  const decide = useCallback(
    async (
      decision: PrivacyConsentDecision,
      adultEligibilityConfirmed = false,
    ) => {
      if (!repository || busy) return;
      setBusy(true);
      setErrorMessage(null);
      try {
        const next = await repository.decide(
          decision,
          adultEligibilityConfirmed,
        );
        setRecord(next);
        setStatus(decision === "accepted" ? "accepted" : "declined");
      } catch {
        setErrorMessage(t("privacy.consent.saveError"));
      } finally {
        setBusy(false);
      }
    },
    [busy, repository, t],
  );

  const reconsider = useCallback(() => {
    setErrorMessage(null);
    setStatus("required");
  }, []);

  const retry = useCallback(() => {
    setErrorMessage(null);
    setStatus("loading");
    setRetryVersion((version) => version + 1);
  }, []);

  const withdrawGeneralConsent = useCallback(async () => {
    if (!repository) return;
    const next = await repository.decide("declined");
    setRecord(next);
    setStatus("declined");
  }, [repository]);

  const context = useMemo<PrivacyConsentContextValue>(
    () => ({
      status,
      record,
      policyVersion: MAINLAND_PRIVACY_POLICY_VERSION,
      reconsider,
      withdrawGeneralConsent,
    }),
    [record, reconsider, status, withdrawGeneralConsent],
  );

  let content;
  if (status === "accepted" || status === "not-required") {
    content = children;
  } else if (!ready || status === "loading") {
    content = (
      <PrivacyLoadingScreen
        label={t("privacy.consent.reading")}
        palette={palette}
      />
    );
  } else if (status === "declined") {
    content = (
      <PrivacyDeclinedScreen onReconsider={reconsider} palette={palette} />
    );
  } else if (status === "error") {
    content = (
      <PrivacyErrorScreen
        message={errorMessage ?? t("privacy.consent.storageError")}
        onRetry={retry}
        palette={palette}
      />
    );
  } else {
    content = (
      <PrivacyDecisionScreen
        busy={busy}
        config={config}
        errorMessage={errorMessage}
        onAccept={(adultEligibilityConfirmed) =>
          void decide("accepted", adultEligibilityConfirmed)
        }
        onDecline={() => void decide("declined")}
        palette={palette}
      />
    );
  }

  return (
    <PrivacyConsentContext.Provider value={context}>
      {content}
    </PrivacyConsentContext.Provider>
  );
}

export function usePrivacyConsent() {
  const value = useContext(PrivacyConsentContext);
  if (!value) {
    throw new Error(
      "usePrivacyConsent must be used inside PrivacyConsentBoundary.",
    );
  }
  return value;
}

function PrivacyLoadingScreen({
  label,
  palette,
}: {
  label: string;
  palette: ReturnType<typeof useAppPalette>;
}) {
  return (
    <View style={[styles.centered, { backgroundColor: palette.background }]}>
      <LoadingIndicator
        accessibilityLabel={label}
        palette={palette}
        variant="screen"
      />
    </View>
  );
}

function PrivacyDecisionScreen({
  busy,
  config,
  errorMessage,
  onAccept,
  onDecline,
  palette,
}: {
  busy: boolean;
  config: ReturnType<typeof loadComplianceConfig>;
  errorMessage: string | null;
  onAccept: (adultEligibilityConfirmed: boolean) => void;
  onDecline: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  const [documentId, setDocumentId] = useState<ComplianceDocumentId | null>(
    null,
  );
  const [adultConfirmed, setAdultConfirmed] = useState(false);

  if (documentId) {
    const document = complianceDocument(documentId, config, "zh-CN");
    return (
      <PrivacyLegalTextScreen
        markdown={document.markdown}
        onBack={() => setDocumentId(null)}
        palette={palette}
        title={document.title}
      />
    );
  }

  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.decisionContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.decisionCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View
            style={[styles.brandIcon, { backgroundColor: palette.accentSoft }]}
          >
            <AppIcon color={palette.accent} name="shield-checkmark" size={28} />
          </View>
          <Text style={[styles.brand, { color: palette.text }]}>
            {t("common.brand.name")}
          </Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: palette.text }]}
          >
            {t("privacy.consent.title")}
          </Text>
          <Text style={[styles.summary, { color: palette.textSecondary }]}>
            {t("privacy.consent.summary", {
              operator:
                config.operatorName ?? t("privacy.consent.operatorPending"),
            })}
          </Text>
          <View style={styles.points}>
            {privacyPointKeys.map((key) => (
              <View key={key} style={styles.pointRow}>
                <View
                  style={[styles.pointDot, { backgroundColor: palette.accent }]}
                />
                <Text
                  style={[styles.pointText, { color: palette.textSecondary }]}
                >
                  {t(key)}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.documentLinks}>
            <DocumentLink
              label={t("privacy.consent.privacyLink")}
              onPress={() => setDocumentId("privacy")}
              palette={palette}
            />
            <DocumentLink
              label={t("privacy.consent.termsLink")}
              onPress={() => setDocumentId("terms")}
              palette={palette}
            />
            <DocumentLink
              label={t("privacy.consent.thirdPartiesLink")}
              onPress={() => setDocumentId("third-parties")}
              palette={palette}
            />
            <DocumentLink
              label={t("privacy.center.personalInformation")}
              onPress={() => setDocumentId("personal-information")}
              palette={palette}
            />
            <DocumentLink
              label={t("privacy.center.permissions")}
              onPress={() => setDocumentId("permissions")}
              palette={palette}
            />
          </View>
          <Text
            style={[styles.separateConsent, { color: palette.textSecondary }]}
          >
            {t("privacy.consent.separateConsent")}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: adultConfirmed }}
            disabled={busy}
            onPress={() => setAdultConfirmed((confirmed) => !confirmed)}
            style={({ pressed }) => [
              styles.ageConfirmation,
              { borderColor: palette.borderStrong },
              pressed && styles.pressed,
            ]}
          >
            <AppIcon
              color={adultConfirmed ? palette.accent : palette.textSecondary}
              name={adultConfirmed ? "checkbox" : "square-outline"}
              size={22}
            />
            <Text style={[styles.ageConfirmationText, { color: palette.text }]}>
              {t("privacy.consent.adultConfirmation")}
            </Text>
          </Pressable>
          {errorMessage ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: palette.danger }]}
            >
              {errorMessage}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !adultConfirmed}
            onPress={() => onAccept(adultConfirmed)}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: palette.accent },
              pressed && styles.pressed,
              (busy || !adultConfirmed) && styles.disabled,
            ]}
          >
            {busy ? (
              <LoadingIndicator
                color="#ffffff"
                palette={palette}
                variant="inline"
              />
            ) : null}
            <Text style={styles.primaryButtonText}>
              {t("privacy.consent.accept")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onDecline}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: palette.borderStrong },
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
              {t("privacy.consent.decline")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DocumentLink({
  label,
  onPress,
  palette,
}: {
  label: string;
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  return (
    <Pressable accessibilityRole="link" hitSlop={8} onPress={onPress}>
      <Text style={[styles.documentLink, { color: palette.accent }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PrivacyLegalTextScreen({
  markdown,
  onBack,
  palette,
  title,
}: {
  markdown: string;
  onBack: () => void;
  palette: ReturnType<typeof useAppPalette>;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <View style={[styles.legalHeader, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel={t("common.navigation.back")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={styles.backButton}
        >
          <AppIcon color={palette.text} name="chevron-back" size={24} />
        </Pressable>
        <Text
          numberOfLines={2}
          style={[styles.legalTitle, { color: palette.text }]}
        >
          {title}
        </Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView
        contentContainerStyle={styles.legalContent}
        showsVerticalScrollIndicator={false}
      >
        <Text selectable style={[styles.legalText, { color: palette.text }]}>
          {plainLegalText(markdown)}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function plainLegalText(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function PrivacyDeclinedScreen({
  onReconsider,
  palette,
}: {
  onReconsider: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={["top"]}
      style={[
        styles.safeArea,
        styles.centered,
        { backgroundColor: palette.background },
      ]}
    >
      <View style={styles.stateContent}>
        <AppIcon
          color={palette.textSecondary}
          name="cloud-offline-outline"
          size={38}
        />
        <Text
          accessibilityRole="header"
          style={[styles.stateTitle, { color: palette.text }]}
        >
          {t("privacy.consent.declinedTitle")}
        </Text>
        <Text style={[styles.stateDetail, { color: palette.textSecondary }]}>
          {t("privacy.consent.declinedDetail")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onReconsider}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: palette.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {t("privacy.consent.reconsider")}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function PrivacyErrorScreen({
  message,
  onRetry,
  palette,
}: {
  message: string;
  onRetry: () => void;
  palette: ReturnType<typeof useAppPalette>;
}) {
  const { t } = useI18n();
  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={["top"]}
      style={[
        styles.safeArea,
        styles.centered,
        { backgroundColor: palette.background },
      ]}
    >
      <View style={styles.stateContent}>
        <AppIcon color={palette.danger} name="alert-circle-outline" size={38} />
        <Text
          accessibilityRole="alert"
          style={[styles.stateTitle, { color: palette.text }]}
        >
          {message}
        </Text>
        <Text style={[styles.stateDetail, { color: palette.textSecondary }]}>
          {t("privacy.consent.failClosed")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: palette.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {t("privacy.consent.retry")}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  decisionContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  decisionCard: {
    alignSelf: "center",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 620,
    padding: spacing.xl,
    width: "100%",
  },
  brandIcon: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  brand: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  summary: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  points: { gap: spacing.sm, marginTop: spacing.lg },
  pointRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  pointDot: { borderRadius: 3, height: 6, marginTop: 8, width: 6 },
  pointText: { flex: 1, fontSize: 14, lineHeight: 21 },
  documentLinks: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  documentLink: { fontSize: 14, fontWeight: "600", lineHeight: 22 },
  separateConsent: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.md,
    textAlign: "center",
  },
  ageConfirmation: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ageConfirmationText: { flex: 1, fontSize: 14, lineHeight: 21 },
  error: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
  legalHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  backButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    width: 44,
  },
  legalTitle: { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center" },
  legalContent: {
    alignSelf: "center",
    maxWidth: 760,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    width: "100%",
  },
  legalText: { fontSize: 15, lineHeight: 25 },
  stateContent: {
    alignItems: "center",
    maxWidth: 520,
    padding: spacing.xl,
    width: "100%",
  },
  stateTitle: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 29,
    marginTop: spacing.md,
    textAlign: "center",
  },
  stateDetail: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
