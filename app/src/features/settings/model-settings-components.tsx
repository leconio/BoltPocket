import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

export function ModelSettingsField({
  label,
  palette,
  rightAction,
  ...props
}: ComponentProps<typeof TextInput> & {
  label: string;
  palette: ReturnType<typeof useAppPalette>;
  rightAction?: {
    accessibilityLabel: string;
    disabled?: boolean;
    onPress: () => void;
    title: string;
  };
}) {
  return (
    <View style={modelSettingsStyles.field}>
      <Text style={[modelSettingsStyles.label, { color: palette.text }]}>
        {label}
      </Text>
      <View style={modelSettingsStyles.fieldControlRow}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={palette.textTertiary}
          style={[
            modelSettingsStyles.input,
            {
              backgroundColor: palette.background,
              borderColor: palette.border,
              color: palette.text,
            },
          ]}
          {...props}
        />
        {rightAction ? (
          <Pressable
            accessibilityLabel={rightAction.accessibilityLabel}
            accessibilityRole="button"
            disabled={rightAction.disabled}
            onPress={rightAction.onPress}
            style={({ pressed }) => [
              modelSettingsStyles.fieldAction,
              {
                backgroundColor: palette.surface,
                borderColor: palette.borderStrong,
              },
              rightAction.disabled && modelSettingsStyles.disabled,
              pressed && { backgroundColor: palette.codeSurface },
            ]}
          >
            <Text
              style={[
                modelSettingsStyles.fieldActionText,
                { color: palette.accent },
              ]}
            >
              {rightAction.title}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ModelSettingsAction({
  danger = false,
  disabled = false,
  loading = false,
  loadingTitle,
  onPress,
  palette,
  secondary = false,
  title,
}: {
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  loadingTitle?: string;
  onPress: () => void;
  palette: ReturnType<typeof useAppPalette>;
  secondary?: boolean;
  title: string;
}) {
  const { t } = useI18n();
  const foreground = danger
    ? palette.danger
    : secondary
      ? palette.text
      : palette.accentText;
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        modelSettingsStyles.action,
        secondary
          ? {
              backgroundColor: palette.surface,
              borderColor: danger ? palette.danger : palette.borderStrong,
            }
          : {
              backgroundColor: palette.accent,
              borderColor: palette.accent,
            },
        (disabled || loading) && { opacity: 0.4 },
        pressed && { opacity: 0.68 },
      ]}
    >
      {loading ? (
        <LoadingIndicator
          color={foreground}
          palette={palette}
          variant="inline"
        />
      ) : null}
      <Text style={[modelSettingsStyles.actionText, { color: foreground }]}>
        {loading ? (loadingTitle ?? t("settings.model.saving")) : title}
      </Text>
    </Pressable>
  );
}

export const modelSettingsStyles = StyleSheet.create({
  container: { gap: spacing.md, width: "100%" },
  providerTabs: { gap: spacing.xs, paddingRight: spacing.md },
  providerTab: {
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    maxWidth: 180,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  addProvider: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
    width: "100%",
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  loading: { alignSelf: "center", minHeight: 80 },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: "600" },
  fieldControlRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.xs,
  },
  input: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontSize: 16,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  fieldAction: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 60,
    paddingHorizontal: spacing.sm,
  },
  fieldActionText: { fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  protocolRow: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  protocolOption: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  protocolValue: { fontSize: 15, fontWeight: "500" },
  providerHint: {
    alignItems: "flex-start",
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  providerHintCopy: { flex: 1, gap: 3, minWidth: 0 },
  providerHintText: { fontSize: 13, lineHeight: 19 },
  providerHintDetail: { fontSize: 12, lineHeight: 18 },
  providerOptionCopy: { flex: 1, gap: 2, minWidth: 0 },
  providerOptionDetail: { fontSize: 12, lineHeight: 17 },
  codexCodeCard: {
    alignItems: "center",
    borderRadius: radii.sm,
    gap: spacing.xs,
    padding: spacing.md,
  },
  codexCode: { fontSize: 24, fontWeight: "700", letterSpacing: 2 },
  savedKeyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: -spacing.xs,
  },
  maskedKey: { fontSize: 12 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sectionTitle: { fontSize: 13, fontWeight: "600" },
  modelList: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  modelRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  modelCopy: { flex: 1, minWidth: 0 },
  modelName: { fontSize: 15, fontWeight: "500" },
  modelPurposes: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  empty: {
    alignItems: "center",
    minHeight: 72,
    justifyContent: "center",
  },
  emptyText: { fontSize: 14 },
  feedback: {
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  feedbackText: { fontSize: 13, lineHeight: 19 },
  action: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  inlineActions: { flexDirection: "row", gap: spacing.sm },
});
