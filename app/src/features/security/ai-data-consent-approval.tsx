import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PendingAiDataConsent } from "@/application/ports/ai-data-consent";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const categoryLabelKeys = {
  message: "security.aiConsent.category.message",
  attachments: "security.aiConsent.category.attachments",
  "project-context": "security.aiConsent.category.projectContext",
  "connected-documents": "security.aiConsent.category.connectedDocuments",
} as const satisfies Record<
  PendingAiDataConsent["categories"][number],
  MessageKey
>;

export function AiDataConsentApproval({
  request,
  onApprove,
  onDeny,
}: {
  request: PendingAiDataConsent | null;
  onApprove: (requestId: string) => Promise<void>;
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
          accessibilityLabel={t("security.aiConsent.denyAccessibility")}
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
                {t("security.aiConsent.title")}
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
                  {t("security.aiConsent.description", {
                    model: request.modelName,
                  })}
                </Text>
                <View
                  style={[
                    styles.details,
                    { backgroundColor: palette.codeSurface },
                  ]}
                >
                  {request.categories.map((category) => (
                    <Text
                      key={category}
                      style={[styles.item, { color: palette.text }]}
                    >
                      • {t(categoryLabelKeys[category])}
                    </Text>
                  ))}
                </View>
                <View style={styles.meta}>
                  <Detail
                    label={t("security.aiConsent.meta.recipient")}
                    value={request.recipientName}
                  />
                  <Detail
                    label={t("security.aiConsent.meta.endpoint")}
                    value={new URL(request.baseUrl).hostname}
                  />
                  <Detail
                    label={t("security.aiConsent.meta.model")}
                    value={request.modelName}
                  />
                  {request.filingNumber ? (
                    <Detail
                      label={t("security.aiConsent.meta.filing")}
                      value={request.filingNumber}
                    />
                  ) : null}
                </View>
                <Text
                  style={[styles.warning, { color: palette.textSecondary }]}
                >
                  {t("security.aiConsent.policy")}
                  {"\n"}
                  {request.crossBorder === false
                    ? t("security.aiConsent.crossBorder.domestic")
                    : request.crossBorder === true
                      ? t("security.aiConsent.crossBorder.overseas", {
                          location:
                            request.recipientLocation ??
                            t(
                              "security.aiConsent.crossBorder.overseasFallback",
                            ),
                        })
                      : t("security.aiConsent.crossBorder.unknown")}
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
                    {t("security.aiConsent.deny")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void onApprove(request.requestId).catch((error: unknown) =>
                      Alert.alert(
                        t("security.aiConsent.failed"),
                        localizedErrorMessage(
                          error,
                          t("security.aiConsent.retry"),
                        ),
                      ),
                    );
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: palette.text },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[styles.buttonText, { color: palette.background }]}
                  >
                    {t("security.aiConsent.approve")}
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
  details: { borderRadius: radii.md, gap: spacing.xs, padding: spacing.md },
  item: { fontSize: 14, lineHeight: 21 },
  meta: { gap: spacing.xs },
  detailRow: { flexDirection: "row", gap: spacing.sm },
  detailLabel: { fontSize: 12, fontWeight: "600", width: 72 },
  detailValue: { flex: 1, fontSize: 13, lineHeight: 18 },
  warning: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  secondaryButton: { borderWidth: StyleSheet.hairlineWidth },
  buttonText: { fontSize: 14, fontWeight: "700", textAlign: "center" },
});
