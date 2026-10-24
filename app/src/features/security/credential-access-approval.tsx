import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PendingCredentialAccess } from "@/application/ports/credential-vault";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const kindLabelKeys = {
  password: "security.credential.kind.password",
  ssh: "security.credential.kind.ssh",
  "api-token": "security.credential.kind.apiToken",
  "secret-text": "security.credential.kind.secretText",
} as const satisfies Record<
  PendingCredentialAccess["credentialKind"],
  MessageKey
>;

function credentialKindLabel(
  request: PendingCredentialAccess,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (request.credentialKind === "ssh") {
    return t(
      request.credentialSshAuthentication === "private-key"
        ? "security.credential.kind.sshPrivateKey"
        : "security.credential.kind.sshPassword",
    );
  }
  if (request.credentialKind === "api-token") {
    return t(
      request.credentialApiAuthentication === "header"
        ? "security.credential.kind.apiHeader"
        : "security.credential.kind.bearer",
    );
  }
  return t(kindLabelKeys[request.credentialKind]);
}

export function CredentialAccessApproval({
  request,
  onApprove,
  onDeny,
}: {
  request: PendingCredentialAccess | null;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const deny = () => {
    if (request) onDeny(request.requestId);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={deny}
      statusBarTranslucent
      transparent
      visible={Boolean(request)}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel={t("security.credential.denyAccessibility")}
          accessibilityRole="button"
          onPress={deny}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: palette.overlay },
          ]}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              paddingBottom: Math.max(spacing.xl, insets.bottom),
            },
          ]}
        >
          {request ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                {t("security.credential.title")}
              </Text>
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                style={styles.scroll}
              >
                <Text
                  style={[styles.description, { color: palette.textSecondary }]}
                >
                  {t("security.credential.description")}
                </Text>

                <View
                  style={[
                    styles.details,
                    { backgroundColor: palette.codeSurface },
                  ]}
                >
                  <Detail
                    label={t("security.credential.meta.project")}
                    value={request.projectName}
                  />
                  <Detail
                    label={t("security.credential.meta.entry")}
                    value={`${request.credentialLabel} · ${credentialKindLabel(request, t)}`}
                  />
                  <Detail
                    label={t("security.credential.meta.purpose")}
                    value={request.purpose}
                  />
                </View>

                <Text
                  style={[styles.warning, { color: palette.textSecondary }]}
                >
                  {t("security.credential.warning")}
                </Text>
              </ScrollView>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={deny}
                  style={({ pressed }) => [
                    styles.button,
                    styles.secondaryButton,
                    { borderColor: palette.borderStrong },
                    pressed && { opacity: 0.64 },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: palette.text }]}>
                    {t("security.credential.deny")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onApprove(request.requestId)}
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: palette.text },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[styles.buttonText, { color: palette.background }]}
                  >
                    {t("security.credential.approve")}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const palette = useAppPalette();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.textTertiary }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    maxHeight: "90%",
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: { fontSize: 22, fontWeight: "700" },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.md },
  description: { fontSize: 14, lineHeight: 21 },
  details: { borderRadius: radii.md, gap: spacing.sm, padding: spacing.md },
  detailRow: { gap: 3 },
  detailLabel: { fontSize: 11, fontWeight: "600" },
  detailValue: { fontSize: 14, lineHeight: 20 },
  warning: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  secondaryButton: { borderWidth: StyleSheet.hairlineWidth },
  buttonText: { fontSize: 15, fontWeight: "700" },
});
