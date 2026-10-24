import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PendingMcpToolApproval } from "@/application/ports/mcp-tool-approval";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const riskKeys = {
  destructive: "security.mcpTool.risk.destructive",
  read: "security.mcpTool.risk.read",
  unknown: "security.mcpTool.risk.unknown",
  write: "security.mcpTool.risk.write",
} as const satisfies Record<PendingMcpToolApproval["risk"], MessageKey>;

export function McpToolApproval({
  onApprove,
  onDeny,
  request,
}: {
  onApprove: (requestId: string, scope: "once" | "session") => void;
  onDeny: (requestId: string) => void;
  request: PendingMcpToolApproval | null;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const deny = () => {
    if (request) onDeny(request.requestId);
  };
  const canApproveSession = Boolean(
    request?.risk === "read" && request.request.approvalSessionId,
  );

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
          accessibilityLabel={t("security.mcpTool.denyAccessibility")}
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
              <View style={styles.heading}>
                <Text style={[styles.title, { color: palette.text }]}>
                  {t("security.mcpTool.title")}
                </Text>
                <View
                  style={[
                    styles.riskPill,
                    {
                      backgroundColor:
                        request.risk === "read"
                          ? palette.codeSurface
                          : palette.dangerSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.riskText,
                      {
                        color:
                          request.risk === "read"
                            ? palette.textSecondary
                            : palette.danger,
                      },
                    ]}
                  >
                    {t(riskKeys[request.risk])}
                  </Text>
                </View>
              </View>
              <Text
                style={[styles.description, { color: palette.textSecondary }]}
              >
                {t("security.mcpTool.description")}
              </Text>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                style={styles.scroll}
              >
                <View
                  style={[
                    styles.details,
                    { backgroundColor: palette.codeSurface },
                  ]}
                >
                  <Detail
                    label={t("security.mcpTool.project")}
                    value={
                      request.request.projectName ?? request.request.projectId
                    }
                  />
                  <Detail
                    label={t("security.mcpTool.server")}
                    value={request.request.serverName}
                  />
                  <Detail
                    label={t("security.mcpTool.tool")}
                    value={
                      request.request.toolTitle ?? request.request.toolName
                    }
                  />
                  <Detail
                    label={t("security.mcpTool.hash")}
                    monospace
                    value={request.patchHash}
                  />
                </View>
                <View style={styles.argumentGroup}>
                  <Text
                    style={[
                      styles.detailLabel,
                      { color: palette.textTertiary },
                    ]}
                  >
                    {t("security.mcpTool.arguments")}
                  </Text>
                  <Text
                    selectable
                    style={[
                      styles.arguments,
                      {
                        backgroundColor: palette.codeSurface,
                        color: palette.text,
                      },
                    ]}
                  >
                    {request.argumentsPreview}
                  </Text>
                </View>
                <Text
                  style={[styles.warning, { color: palette.textSecondary }]}
                >
                  {t("security.mcpTool.warning")}
                </Text>
              </ScrollView>
              <View style={styles.actions}>
                <ApprovalButton
                  label={t("security.mcpTool.deny")}
                  onPress={deny}
                  secondary
                />
                <ApprovalButton
                  label={t("security.mcpTool.allowOnce")}
                  onPress={() => onApprove(request.requestId, "once")}
                />
              </View>
              {canApproveSession ? (
                <ApprovalButton
                  label={t("security.mcpTool.allowSession")}
                  onPress={() => onApprove(request.requestId, "session")}
                  secondary
                />
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Detail({
  label,
  monospace = false,
  value,
}: {
  label: string;
  monospace?: boolean;
  value: string;
}) {
  const palette = useAppPalette();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.textTertiary }]}>
        {label}
      </Text>
      <Text
        selectable={monospace}
        style={[
          styles.detailValue,
          { color: palette.text },
          monospace && styles.monospace,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ApprovalButton({
  label,
  onPress,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? {
              borderColor: palette.borderStrong,
              borderWidth: StyleSheet.hairlineWidth,
            }
          : { backgroundColor: palette.text },
        pressed && { opacity: 0.66 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: secondary ? palette.text : palette.background },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    maxHeight: "88%",
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  heading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  title: { flex: 1, fontSize: 22, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 21 },
  riskPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  riskText: { fontSize: 12, fontWeight: "700" },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.md },
  details: { borderRadius: radii.md, gap: spacing.sm, padding: spacing.md },
  detailRow: { gap: 3 },
  detailLabel: { fontSize: 11, fontWeight: "600" },
  detailValue: { fontSize: 14, lineHeight: 20 },
  monospace: { fontFamily: "monospace", fontSize: 11 },
  argumentGroup: { gap: spacing.xs },
  arguments: {
    borderRadius: radii.md,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    maxHeight: 180,
    padding: spacing.md,
  },
  warning: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  buttonText: { fontSize: 14, fontWeight: "700" },
});
