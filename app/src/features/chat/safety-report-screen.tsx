import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import {
  SafetyReportError,
  safetyReportCategories,
  type SafetyReportCategory,
  type SafetyReportTargetType,
} from "@/application/ports/safety-report";
import { AppSwitch, ScreenHeader } from "@/components/ui";
import {
  isGeneratedImageAttachment,
  isGeneratedVideoAttachment,
} from "@/domain/models";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { useAppServices } from "@/providers/runtime-services-provider";
import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const categoryKeys: Readonly<Record<SafetyReportCategory, MessageKey>> = {
  unsafe: "chat.report.category.unsafe",
  incorrect: "chat.report.category.incorrect",
  privacy: "chat.report.category.privacy",
  copyright: "chat.report.category.copyright",
  spam: "chat.report.category.spam",
  other: "chat.report.category.other",
};

const selectSafetyReportState = createAppStateFieldsSelector(
  "messagesByConversation",
);

export function SafetyReportScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { safetyReports } = useAppServices();
  const {
    conversationId,
    messageId,
    attachmentId,
    targetId,
    targetLabel,
    targetType,
    excerpt,
  } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
    attachmentId?: string;
    targetId?: string;
    targetLabel?: string;
    targetType?: string;
    excerpt?: string;
  }>();
  const state = useAppStateSelector(selectSafetyReportState);
  const [category, setCategory] = useState<SafetyReportCategory>("unsafe");
  const [includeContent, setIncludeContent] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const target = useMemo(() => {
    if (
      targetType === "capability_entry" &&
      typeof targetId === "string" &&
      targetId.length > 0 &&
      targetId.length <= 256 &&
      typeof targetLabel === "string" &&
      targetLabel.length > 0 &&
      targetLabel.length <= 160
    ) {
      return {
        excerpt:
          typeof excerpt === "string" ? excerpt.slice(0, 4_000) : undefined,
        id: targetId,
        label: targetLabel,
        type: "capability_entry" as const satisfies SafetyReportTargetType,
      };
    }
    if (typeof conversationId !== "string" || typeof messageId !== "string") {
      return null;
    }
    const message = state.messagesByConversation[conversationId]?.find(
      (candidate) => candidate.id === messageId,
    );
    if (!message || message.role !== "assistant") return null;
    if (typeof attachmentId === "string") {
      const attachment = message.attachments?.find(
        (candidate) => candidate.id === attachmentId,
      );
      if (attachment && isGeneratedImageAttachment(attachment)) {
        return {
          excerpt: `${attachment.providerName} / ${attachment.modelId}`,
          id: attachment.id,
          label: t("chat.report.target.image"),
          type: "generated_image" as const satisfies SafetyReportTargetType,
        };
      }
      if (attachment && isGeneratedVideoAttachment(attachment)) {
        return {
          excerpt: `${attachment.providerName} / ${attachment.modelId}`,
          id: attachment.id,
          label: t("chat.report.target.video"),
          type: "generated_video" as const satisfies SafetyReportTargetType,
        };
      }
      return null;
    }
    return {
      excerpt: message.content,
      id: message.id,
      label: t("chat.report.target.answer"),
      type: "assistant_message" as const satisfies SafetyReportTargetType,
    };
  }, [
    attachmentId,
    conversationId,
    excerpt,
    messageId,
    state.messagesByConversation,
    targetId,
    targetLabel,
    targetType,
    t,
  ]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const submit = async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      await safetyReports.submit({
        category,
        includeContent,
        targetId: target.id,
        targetType: target.type,
        ...(includeContent && target.excerpt
          ? { excerpt: target.excerpt.slice(0, 4_000) }
          : {}),
        ...(includeContent && note.trim()
          ? { note: note.trim().slice(0, 2_000) }
          : {}),
      });
      Alert.alert(
        t("chat.report.successTitle"),
        t("chat.report.successMessage"),
        [{ text: t("chat.report.done"), onPress: goBack }],
      );
    } catch (error) {
      Alert.alert(
        t("chat.report.failedTitle"),
        error instanceof SafetyReportError && error.code === "rate-limited"
          ? t("chat.report.rateLimited")
          : t("chat.report.failedMessage"),
      );
    } finally {
      setSubmitting(false);
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
        title={t("chat.report.title")}
      />
      {!target ? (
        <View style={styles.empty}>
          <Ionicons
            color={palette.textSecondary}
            name="alert-circle-outline"
            size={32}
          />
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("chat.report.targetMissing")}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.intro, { color: palette.textSecondary }]}>
              {t("chat.report.intro", { target: target.label })}
            </Text>

            <Text style={[styles.sectionTitle, { color: palette.text }]}>
              {t("chat.report.reason")}
            </Text>
            <View accessibilityRole="radiogroup" style={styles.categories}>
              {safetyReportCategories.map((candidate) => {
                const selected = candidate === category;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={candidate}
                    onPress={() => setCategory(candidate)}
                    style={({ pressed }) => [
                      styles.category,
                      {
                        backgroundColor: selected
                          ? palette.accentSoft
                          : palette.surface,
                        borderColor: selected ? palette.accent : palette.border,
                      },
                      pressed && { opacity: 0.72 },
                    ]}
                  >
                    <Ionicons
                      color={selected ? palette.accent : palette.textSecondary}
                      name={selected ? "radio-button-on" : "radio-button-off"}
                      size={20}
                    />
                    <Text
                      style={[styles.categoryText, { color: palette.text }]}
                    >
                      {t(categoryKeys[candidate])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={[
                styles.privacyCard,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.privacyCopy}>
                <Text style={[styles.privacyTitle, { color: palette.text }]}>
                  {t("chat.report.includeContent")}
                </Text>
                <Text
                  style={[
                    styles.privacyDetail,
                    { color: palette.textSecondary },
                  ]}
                >
                  {t("chat.report.includeContentDetail")}
                </Text>
              </View>
              <AppSwitch
                accessibilityLabel={t("chat.report.includeContent")}
                onValueChange={setIncludeContent}
                trackColor={{
                  false: palette.borderStrong,
                  true: palette.accent,
                }}
                value={includeContent}
              />
            </View>

            {includeContent ? (
              <View style={styles.noteSection}>
                <Text style={[styles.sectionTitle, { color: palette.text }]}>
                  {t("chat.report.note")}
                </Text>
                <TextInput
                  accessibilityLabel={t("chat.report.note")}
                  maxLength={2_000}
                  multiline
                  onChangeText={setNote}
                  placeholder={t("chat.report.notePlaceholder")}
                  placeholderTextColor={palette.textTertiary}
                  style={[
                    styles.note,
                    {
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                      color: palette.text,
                    },
                  ]}
                  textAlignVertical="top"
                  value={note}
                />
              </View>
            ) : null}

            <View
              style={[
                styles.disclosure,
                { backgroundColor: palette.codeSurface },
              ]}
            >
              <Ionicons
                color={palette.textSecondary}
                name="shield-checkmark-outline"
                size={18}
              />
              <Text
                style={[
                  styles.disclosureText,
                  { color: palette.textSecondary },
                ]}
              >
                {t(
                  includeContent
                    ? "chat.report.contentIncluded"
                    : "chat.report.contentNotIncluded",
                )}
              </Text>
            </View>
            <Text style={[styles.retention, { color: palette.textTertiary }]}>
              {t("chat.report.retention")}
            </Text>
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: palette.border }]}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: palette.accent },
                pressed && { backgroundColor: palette.accentPressed },
                submitting && { opacity: 0.55 },
              ]}
            >
              {submitting ? (
                <LoadingIndicator
                  color={palette.accentText}
                  palette={palette}
                  variant="inline"
                />
              ) : null}
              <Text style={[styles.submitText, { color: palette.accentText }]}>
                {t(
                  submitting ? "chat.report.submitting" : "chat.report.submit",
                )}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  intro: { fontSize: 14, lineHeight: 21 },
  sectionTitle: { fontSize: 15, fontWeight: "600" },
  categories: { gap: spacing.xs },
  category: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  categoryText: { flex: 1, fontSize: 15 },
  privacyCard: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  privacyCopy: { flex: 1, gap: spacing.xxs },
  privacyTitle: { fontSize: 15, fontWeight: "600" },
  privacyDetail: { fontSize: 13, lineHeight: 19 },
  noteSection: { gap: spacing.xs },
  note: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 112,
    padding: spacing.md,
  },
  disclosure: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  disclosureText: { flex: 1, fontSize: 13, lineHeight: 19 },
  retention: { fontSize: 12, lineHeight: 18 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  submit: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  submitText: { fontSize: 15, fontWeight: "700" },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
