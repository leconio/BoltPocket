import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import type { GoogleDocsAuthorizedAccount } from "@/application/ports/google-docs-connections";
import { ScreenHeader } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import { findSupportedDocumentLinks } from "@/infrastructure/connectors/document-link";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectGoogleDocsConnectionState = createAppStateFieldsSelector(
  "activeConversationId",
  "connections",
  "draft",
  "projects",
);

function isGoogleConnection(connectionId: string) {
  return /^(?:google-docs|google-sheets|google-slides)-/u.test(connectionId);
}

export function GoogleDocsConnectionScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId, resumeConversationId } = useLocalSearchParams<{
    projectId?: string;
    resumeConversationId?: string;
  }>();
  const { authorizeGoogleWorkspace, googleWorkspaceAccount, sendMessage } =
    useAppActions();
  const state = useAppStateSelector(selectGoogleDocsConnectionState);
  const project = projectId ? state.projects[projectId] : undefined;
  const [account, setAccount] = useState<GoogleDocsAuthorizedAccount | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectAuthorized = useMemo(
    () =>
      Boolean(
        project &&
        Object.values(state.connections).some(
          (connection) =>
            connection.projectId === project.id &&
            connection.status === "connected" &&
            isGoogleConnection(connection.id),
        ),
      ),
    [project, state.connections],
  );

  useEffect(() => {
    let active = true;
    void googleWorkspaceAccount()
      .then((restored) => {
        if (active) setAccount(restored);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsChecking(false);
      });
    return () => {
      active = false;
    };
  }, [googleWorkspaceAccount]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      project
        ? { pathname: "/connections", params: { projectId: project.id } }
        : "/projects",
    );
  };

  const resumeAgentDraft = () => {
    if (
      !resumeConversationId ||
      state.activeConversationId !== resumeConversationId
    ) {
      return false;
    }
    const content = state.draft.trim();
    const hasGoogleLink = findSupportedDocumentLinks(content).some(
      (link) => link.provider !== "notion",
    );
    if (!content || !hasGoogleLink) return false;
    goBack();
    setTimeout(() => void sendMessage(content), 220);
    return true;
  };

  const authorize = async () => {
    if (!project || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const force = Boolean(
        account && projectAuthorized && !resumeConversationId,
      );
      const authorized = await authorizeGoogleWorkspace(project.id, force);
      if (!authorized) {
        setError(t("connections.google.cancelled"));
        return;
      }
      setAccount(authorized);
      if (resumeAgentDraft()) return;
      router.dismissTo({
        pathname: "/connections",
        params: { projectId: project.id },
      });
    } catch (caught) {
      setError(localizedErrorMessage(caught, t("connections.google.failed")));
    } finally {
      setIsConnecting(false);
    }
  };

  const buttonLabel = resumeConversationId
    ? account
      ? t("connections.google.continueAgent")
      : t("connections.google.authorizeAndContinue")
    : account && projectAuthorized
      ? t("connections.google.reauthorize")
      : account
        ? t("connections.google.connectProject")
        : t("connections.google.authorize");

  const capabilityKeys = [
    "connections.google.capability.links",
    "connections.google.capability.create",
    "connections.google.capability.safeChanges",
    "connections.google.capability.delete",
  ] as const satisfies readonly MessageKey[];

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        title={t("connections.catalog.google.title")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.hero,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <Text style={[styles.eyebrow, { color: palette.textSecondary }]}>
            {t("connections.google.provider")}
          </Text>
          <Text style={[styles.title, { color: palette.text }]}>
            {t("connections.google.once")}
          </Text>
          <Text style={[styles.description, { color: palette.textSecondary }]}>
            {t("connections.google.description")}
          </Text>
          {isChecking ? (
            <LoadingIndicator
              palette={palette}
              style={styles.accountProgress}
              variant="content"
            />
          ) : account ? (
            <Text style={[styles.account, { color: palette.text }]}>
              {t("connections.google.account.authorized", {
                account: account.label,
              })}
            </Text>
          ) : (
            <Text style={[styles.account, { color: palette.textSecondary }]}>
              {t("connections.google.account.unauthorized")}
            </Text>
          )}
        </View>

        <Text style={[styles.sectionTitle, { color: palette.text }]}>
          {t("connections.google.why")}
        </Text>
        <View style={styles.capabilities}>
          {capabilityKeys.map((key) => (
            <View key={key} style={styles.capabilityRow}>
              <Text style={[styles.bullet, { color: palette.text }]}>•</Text>
              <Text
                style={[
                  styles.capabilityText,
                  { color: palette.textSecondary },
                ]}
              >
                {t(key)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.privacy, { color: palette.textTertiary }]}>
          {t("connections.google.privacy")}
        </Text>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: palette.danger }]}
          >
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityLabel={buttonLabel}
          accessibilityRole="button"
          disabled={!project || isChecking || isConnecting}
          onPress={() => void authorize()}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: palette.text },
            (!project || isChecking || isConnecting) && { opacity: 0.36 },
            pressed && { opacity: 0.68 },
          ]}
        >
          {isConnecting ? (
            <LoadingIndicator
              color={palette.background}
              palette={palette}
              variant="inline"
            />
          ) : (
            <Text style={[styles.buttonText, { color: palette.background }]}>
              {buttonLabel}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  hero: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { fontSize: 28, fontWeight: "700", marginTop: spacing.xs },
  description: { fontSize: 15, lineHeight: 23, marginTop: spacing.sm },
  accountProgress: { alignSelf: "flex-start", marginTop: spacing.md },
  account: { fontSize: 13, fontWeight: "600", marginTop: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginTop: spacing.xl },
  capabilities: { gap: spacing.sm, marginTop: spacing.md },
  capabilityRow: { alignItems: "flex-start", flexDirection: "row" },
  bullet: { fontSize: 17, lineHeight: 22, width: 20 },
  capabilityText: { flex: 1, fontSize: 14, lineHeight: 22 },
  privacy: { fontSize: 12, lineHeight: 18, marginTop: spacing.xl },
  error: { fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 52,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
});
