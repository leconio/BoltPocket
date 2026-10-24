import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListRow, ScreenHeader, SectionLabel } from "@/components/ui";
import {
  APP_FILING_QUERY_URL,
  chinaReleaseConfigurationIssues,
  loadComplianceConfig,
} from "@/config/compliance";
import { useI18n } from "@/i18n/i18n-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

export function AboutScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const config = loadComplianceConfig();
  const version = Constants.expoConfig?.version ?? "unknown";
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };
  const openDocument = (document: string) =>
    router.push(
      `/settings/legal?document=${encodeURIComponent(document)}` as Href,
    );
  const openPublicOrBundledDocument = (
    url: string | null,
    document: string,
  ) => {
    if (url && config.serviceDeploymentVerified) {
      void Linking.openURL(url);
      return;
    }
    openDocument(document);
  };
  const hasReleaseInformation = Boolean(
    config.operatorName ||
    config.appFilingNumber ||
    config.websiteIcpFilingNumber ||
    config.supportEmail,
  );
  const mainlandReleaseIssues =
    config.distributionRegion === "china-mainland"
      ? chinaReleaseConfigurationIssues(config)
      : [];
  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        title={t("settings.about.title")}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Text style={[styles.name, { color: palette.text }]}>
            {t("common.brand.name")}
          </Text>
          <Text style={[styles.version, { color: palette.textSecondary }]}>
            {t("settings.about.version", { version })}
          </Text>
          <Text style={[styles.summary, { color: palette.textSecondary }]}>
            {t("settings.about.summary")}
          </Text>
        </View>
        <SectionLabel palette={palette}>
          {t("settings.about.legal")}
        </SectionLabel>
        <ListRow
          icon="shield-checkmark-outline"
          onPress={() => router.push("/settings/privacy" as Href)}
          palette={palette}
          title={t("privacy.center.title")}
        />
        <ListRow
          icon="shield-checkmark-outline"
          onPress={() =>
            openPublicOrBundledDocument(config.privacyPolicyUrl, "privacy")
          }
          palette={palette}
          title={t("settings.about.privacy")}
        />
        <ListRow
          icon="document-text-outline"
          onPress={() => openPublicOrBundledDocument(config.termsUrl, "terms")}
          palette={palette}
          title={t("settings.about.userAgreement")}
        />
        <ListRow
          icon="sparkles-outline"
          onPress={() => openDocument("ai-rules")}
          palette={palette}
          title={t("settings.about.aiRules")}
        />
        <ListRow
          icon="code-slash-outline"
          onPress={() => openDocument("third-parties")}
          palette={palette}
          title={t("settings.about.thirdParties")}
        />
        {hasReleaseInformation ? (
          <>
            <SectionLabel palette={palette}>
              {t("settings.about.releaseInformation")}
            </SectionLabel>
            <ListRow
              detail={
                mainlandReleaseIssues.length > 0
                  ? t("settings.about.distribution.blockedDetail", {
                      count: mainlandReleaseIssues.length,
                    })
                  : undefined
              }
              icon="earth-outline"
              palette={palette}
              title={t("settings.about.distribution")}
              value={t(
                config.distributionRegion === "china-mainland"
                  ? "settings.about.distribution.chinaMainland"
                  : "settings.about.distribution.global",
              )}
            />
            {config.operatorName ? (
              <ListRow
                icon="business-outline"
                palette={palette}
                title={t("settings.about.operator")}
                value={config.operatorName}
              />
            ) : null}
            {config.appFilingNumber ? (
              <ListRow
                icon="receipt-outline"
                onPress={() => void Linking.openURL(APP_FILING_QUERY_URL)}
                palette={palette}
                title={t("settings.about.appFilingNumber")}
                value={config.appFilingNumber}
              />
            ) : null}
            {config.websiteIcpFilingNumber ? (
              <ListRow
                icon="globe-outline"
                onPress={() => void Linking.openURL(APP_FILING_QUERY_URL)}
                palette={palette}
                title={t("settings.about.websiteIcpFilingNumber")}
                value={config.websiteIcpFilingNumber}
              />
            ) : null}
            {config.supportEmail ? (
              <ListRow
                icon="mail-outline"
                onPress={() =>
                  void Linking.openURL(`mailto:${config.supportEmail}`)
                }
                palette={palette}
                title={t("settings.about.support")}
                value={config.supportEmail}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", paddingBottom: spacing.lg },
  name: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  version: { fontSize: 13, marginTop: spacing.xs },
  summary: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
