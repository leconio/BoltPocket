import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AiDataConsentGrant } from "@/application/ports/ai-data-consent";
import type { DocumentOAuthConnection } from "@/application/ports/document-oauth";
import { ListRow, ScreenHeader, SectionLabel } from "@/components/ui";
import { loadComplianceConfig } from "@/config/compliance";
import { usePrivacyConsent } from "@/features/privacy/privacy-consent-boundary";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { useAppServices } from "@/providers/runtime-services-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

export function PrivacyDataScreen() {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const config = loadComplianceConfig();
  const { aiDataConsentBroker, documentOAuth } = useAppServices();
  const mainland = config.distributionRegion === "china-mainland";
  const { policyVersion, record, status, withdrawGeneralConsent } =
    usePrivacyConsent();
  const [grants, setGrants] = useState<AiDataConsentGrant[]>([]);
  const [connections, setConnections] = useState<DocumentOAuthConnection[]>([]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings" as Href);
  };
  const openDocument = (document: string) =>
    router.push(
      `/settings/legal?document=${encodeURIComponent(document)}` as Href,
    );

  const refreshControls = useCallback(async () => {
    const [nextGrants, nextConnections] = await Promise.all([
      aiDataConsentBroker.listGrants(),
      documentOAuth.list(),
    ]);
    setGrants(nextGrants);
    setConnections(nextConnections);
  }, [aiDataConsentBroker, documentOAuth]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      aiDataConsentBroker.listGrants(),
      documentOAuth.list(),
    ]).then(
      ([nextGrants, nextConnections]) => {
        if (!active) return;
        setGrants(nextGrants);
        setConnections(nextConnections);
      },
      (error: unknown) => {
        if (!active) return;
        Alert.alert(
          t("settings.about.couldNotLoadData"),
          localizedErrorMessage(error, t("settings.common.retry")),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [aiDataConsentBroker, documentOAuth, t]);

  const revokeAiConsent = () => {
    Alert.alert(
      t("settings.about.ai.revokeTitle"),
      t("settings.about.ai.revokeConfirm"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.about.ai.revokeAction"),
          style: "destructive",
          onPress: () => {
            void aiDataConsentBroker
              .withdrawAll()
              .then(refreshControls)
              .catch((error: unknown) =>
                Alert.alert(
                  t("settings.about.ai.revokeFailed"),
                  localizedErrorMessage(error, t("settings.common.retry")),
                ),
              );
          },
        },
      ],
    );
  };

  const deleteOAuthConnection = (connection: DocumentOAuthConnection) => {
    Alert.alert(
      t("settings.about.oauth.deleteTitle"),
      t("settings.about.oauth.deleteConfirm", {
        account: connection.accountName,
      }),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.about.oauth.deleteAction"),
          style: "destructive",
          onPress: () => {
            void documentOAuth
              .disconnect(connection.connectionId)
              .then(refreshControls)
              .catch((error: unknown) =>
                Alert.alert(
                  t("settings.about.oauth.deleteFailed"),
                  localizedErrorMessage(error, t("settings.common.retry")),
                ),
              );
          },
        },
      ],
    );
  };

  const revokeGeneralConsent = () => {
    Alert.alert(
      t("privacy.center.revokeTitle"),
      t("privacy.center.revokeConfirm"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("privacy.center.revokeAction"),
          style: "destructive",
          onPress: () => {
            void aiDataConsentBroker
              .withdrawAll()
              .then(withdrawGeneralConsent)
              .catch(() =>
                Alert.alert(
                  t("privacy.center.revokeGeneral"),
                  t("privacy.center.revokeFailed"),
                ),
              );
          },
        },
      ],
    );
  };

  const requestPersonalInformation = () => {
    if (!config.supportEmail) return;
    const subject = encodeURIComponent(t("privacy.center.emailSubject"));
    void Linking.openURL(`mailto:${config.supportEmail}?subject=${subject}`);
  };

  const acceptedAt = record
    ? new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(record.decidedAt))
    : undefined;

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        title={t("privacy.center.title")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.summary, { color: palette.textSecondary }]}>
          {t("privacy.center.summary")}
        </Text>

        {mainland ? (
          <>
            <SectionLabel palette={palette}>
              {t("privacy.center.status")}
            </SectionLabel>
            <ListRow
              detail={
                status === "accepted"
                  ? t("privacy.center.statusAccepted")
                  : t("privacy.center.statusNotRequired")
              }
              icon="shield-checkmark-outline"
              palette={palette}
              title={t("privacy.center.policyVersion")}
              value={policyVersion}
            />
            {acceptedAt ? (
              <ListRow
                icon="time-outline"
                palette={palette}
                title={t("privacy.center.acceptedAt")}
                value={acceptedAt}
              />
            ) : null}
          </>
        ) : null}

        <SectionLabel palette={palette}>
          {t("privacy.center.documents")}
        </SectionLabel>
        <ListRow
          icon="list-outline"
          onPress={() => openDocument("personal-information")}
          palette={palette}
          title={t("privacy.center.personalInformation")}
        />
        <ListRow
          icon="git-network-outline"
          onPress={() => openDocument("third-parties")}
          palette={palette}
          title={t("privacy.center.thirdParties")}
        />
        <ListRow
          icon="key-outline"
          onPress={() => openDocument("permissions")}
          palette={palette}
          title={t("privacy.center.permissions")}
        />
        <ListRow
          icon="sparkles-outline"
          onPress={() => openDocument("ai-rules")}
          palette={palette}
          title={t("privacy.center.aiRules")}
        />
        <ListRow
          icon="shield-checkmark-outline"
          onPress={() => openDocument("privacy")}
          palette={palette}
          title={t("privacy.center.privacyPolicy")}
        />
        <ListRow
          icon="document-text-outline"
          onPress={() => openDocument("terms")}
          palette={palette}
          title={t("privacy.center.userAgreement")}
        />

        <SectionLabel palette={palette}>
          {t("privacy.center.controls")}
        </SectionLabel>
        {grants.length > 0 ? (
          <ListRow
            destructive
            detail={t("settings.about.ai.revokeDetail", {
              count: grants.length,
            })}
            icon="close-circle-outline"
            onPress={revokeAiConsent}
            palette={palette}
            title={t("settings.about.ai.revoke")}
          />
        ) : null}
        {connections.map((connection) => (
          <ListRow
            destructive
            detail={t("settings.about.oauth.deleteDetail", {
              provider: connection.provider === "google" ? "Google" : "Notion",
            })}
            icon="trash-outline"
            key={connection.connectionId}
            onPress={() => deleteOAuthConnection(connection)}
            palette={palette}
            title={connection.accountName}
          />
        ))}
        <ListRow
          detail={t("privacy.center.accountDetail")}
          icon="person-outline"
          onPress={() => router.push("/account" as Href)}
          palette={palette}
          title={t("privacy.center.account")}
        />
        {config.supportEmail ? (
          <ListRow
            detail={t("privacy.center.contactDetail")}
            icon="mail-outline"
            onPress={requestPersonalInformation}
            palette={palette}
            title={t("privacy.center.contact")}
          />
        ) : null}
        <ListRow
          detail={t("privacy.center.localDataDetail")}
          icon="phone-portrait-outline"
          palette={palette}
          title={t("privacy.center.localData")}
        />
        {mainland ? (
          <ListRow
            destructive
            detail={t("privacy.center.revokeConfirm")}
            icon="hand-left-outline"
            onPress={revokeGeneralConsent}
            palette={palette}
            title={t("privacy.center.revokeGeneral")}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summary: { fontSize: 14, lineHeight: 21, marginBottom: spacing.md },
});
