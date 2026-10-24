import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet, ListRow, SectionLabel } from "@/components/ui";
import {
  projectH5CapabilityDefinition,
  projectH5NetworkDeclarations,
  projectH5PermissionDeclarations,
  type ProjectH5Manifest,
  type ProjectH5NetworkDeclaration,
  type ProjectH5Permission,
  type ProjectH5PermissionDeclaration,
} from "@/domain/project-h5-manifest";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

export type ProjectH5PermissionDisplayState =
  "ask" | "granted" | "denied" | "disabled";

function SheetAction({
  label,
  onPress,
  palette,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  palette: AppPalette;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? palette.accent : palette.codeSurface,
          borderColor: primary ? palette.accent : palette.borderStrong,
        },
        pressed && { opacity: 0.68 },
      ]}
    >
      <Text
        style={[
          styles.actionText,
          { color: primary ? palette.background : palette.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function recipientDescription(
  declaration: ProjectH5PermissionDeclaration,
  manifest: ProjectH5Manifest,
  localLabel: string,
) {
  if (!declaration.recipients?.length) return localLabel;
  const byId = new Map(
    projectH5NetworkDeclarations(manifest).map((item) => [item.id, item]),
  );
  return declaration.recipients
    .map((id) => byId.get(id)?.origin)
    .filter((origin): origin is string => Boolean(origin))
    .join("、");
}

export function ProjectH5PermissionDetailsSheet({
  manifest,
  networkState,
  onClose,
  onResetNetwork,
  onResetPermission,
  palette,
  permissionState,
  title,
  visible,
}: {
  manifest: ProjectH5Manifest;
  networkState?: "ask" | "granted" | "denied";
  onClose: () => void;
  onResetNetwork?: () => void;
  onResetPermission?: (permission: ProjectH5Permission) => void;
  palette: AppPalette;
  permissionState?: (
    permission: ProjectH5Permission,
  ) => ProjectH5PermissionDisplayState;
  title: string;
  visible: boolean;
}) {
  const { t } = useI18n();
  const permissions = projectH5PermissionDeclarations(manifest);
  const network = projectH5NetworkDeclarations(manifest);
  const stateLabel = (state: ProjectH5PermissionDisplayState) =>
    t(`browser.host.miniApp.${state}`);

  return (
    <BottomSheet
      onClose={onClose}
      palette={palette}
      title={t("browser.chrome.miniAppPermissions")}
      visible={visible}
    >
      <Text style={[styles.appTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.explanation, { color: palette.textSecondary }]}>
        {t("browser.host.miniApp.contentBound")}
      </Text>

      <SectionLabel palette={palette}>
        {t("settings.browser.permissionsTitle")}
      </SectionLabel>
      {permissions.length === 0 ? (
        <ListRow
          icon="shield-checkmark-outline"
          palette={palette}
          title={t("browser.host.miniApp.noDevicePermissions")}
        />
      ) : (
        permissions.map((declaration) => {
          const definition = projectH5CapabilityDefinition(declaration.id);
          const state = permissionState?.(declaration.id);
          const resettable = state === "granted" || state === "denied";
          return (
            <ListRow
              detail={`${declaration.purpose}\n${recipientDescription(
                declaration,
                manifest,
                t("browser.host.miniApp.recipient.local"),
              )}${
                resettable
                  ? `\n${t(
                      state === "denied"
                        ? "browser.host.miniApp.askAgain"
                        : "browser.host.miniApp.resetConsent",
                    )}`
                  : ""
              }`}
              icon="shield-outline"
              key={declaration.id}
              onPress={
                resettable && onResetPermission
                  ? () => onResetPermission(declaration.id)
                  : undefined
              }
              palette={palette}
              title={t(definition.labelKey)}
              value={
                state
                  ? stateLabel(state)
                  : t(`browser.host.miniApp.scope.${declaration.mode}`)
              }
            />
          );
        })
      )}

      <SectionLabel palette={palette}>
        {t("browser.host.miniApp.networkCount", { count: network.length })}
      </SectionLabel>
      {network.length === 0 ? (
        <ListRow
          icon="cloud-outline"
          palette={palette}
          title={t("browser.host.miniApp.noNetwork")}
        />
      ) : (
        network.map((declaration) => (
          <ListRow
            detail={`${declaration.purpose}${
              networkState && networkState !== "ask"
                ? `\n${t("browser.host.miniApp.resetConsent")}`
                : ""
            }`}
            icon="server-outline"
            key={declaration.id}
            onPress={
              networkState && networkState !== "ask" && onResetNetwork
                ? onResetNetwork
                : undefined
            }
            palette={palette}
            title={declaration.origin}
            value={
              networkState
                ? stateLabel(networkState)
                : t("browser.host.miniApp.scope.session")
            }
          />
        ))
      )}
    </BottomSheet>
  );
}

export function ProjectH5CapabilityPromptSheet({
  appTitle,
  declaration,
  manifest,
  onAllow,
  onDeny,
  palette,
  visible,
}: {
  appTitle: string;
  declaration: ProjectH5PermissionDeclaration | null;
  manifest: ProjectH5Manifest | null;
  onAllow: () => void;
  onDeny: () => void;
  palette: AppPalette;
  visible: boolean;
}) {
  const { t } = useI18n();
  const capability = declaration
    ? t(projectH5CapabilityDefinition(declaration.id).labelKey)
    : "";
  const recipients =
    declaration && manifest
      ? recipientDescription(
          declaration,
          manifest,
          t("browser.host.miniApp.recipient.local"),
        )
      : "";
  return (
    <BottomSheet
      onClose={onDeny}
      palette={palette}
      title={t("browser.host.miniApp.permissionTitle", { capability })}
      visible={visible}
    >
      {declaration ? (
        <>
          <Text style={[styles.promptLead, { color: palette.text }]}>
            {t("browser.host.miniApp.permissionIntro", {
              capability,
              name: appTitle,
            })}
          </Text>
          <View
            style={[
              styles.disclosure,
              { backgroundColor: palette.codeSurface },
            ]}
          >
            <Text
              selectable
              style={[styles.disclosureText, { color: palette.textSecondary }]}
            >
              {t("browser.host.miniApp.permissionDetail", {
                purpose: declaration.purpose,
                recipients,
                scope: t(`browser.host.miniApp.scope.${declaration.mode}`),
              })}
            </Text>
          </View>
          <Text style={[styles.impact, { color: palette.textSecondary }]}>
            {t("browser.host.miniApp.refusalImpact")}
          </Text>
          <View style={styles.actions}>
            <SheetAction
              label={t("browser.host.miniApp.deny")}
              onPress={onDeny}
              palette={palette}
            />
            <SheetAction
              label={t("browser.host.miniApp.allow")}
              onPress={onAllow}
              palette={palette}
              primary
            />
          </View>
        </>
      ) : null}
    </BottomSheet>
  );
}

export function ProjectH5NetworkPromptSheet({
  appTitle,
  declarations,
  onAllow,
  onDeny,
  palette,
  visible,
}: {
  appTitle: string;
  declarations: readonly ProjectH5NetworkDeclaration[];
  onAllow: () => void;
  onDeny: () => void;
  palette: AppPalette;
  visible: boolean;
}) {
  const { t } = useI18n();
  return (
    <BottomSheet
      onClose={onDeny}
      palette={palette}
      title={t("browser.host.miniApp.networkTitle")}
      visible={visible}
    >
      <Text style={[styles.promptLead, { color: palette.text }]}>
        {t("browser.host.miniApp.networkIntro", { name: appTitle })}
      </Text>
      {declarations.map((declaration) => (
        <ListRow
          detail={t("browser.host.miniApp.networkPurpose", {
            purpose: declaration.purpose,
          })}
          icon="server-outline"
          key={declaration.id}
          palette={palette}
          title={declaration.origin}
        />
      ))}
      <Text style={[styles.impact, { color: palette.textSecondary }]}>
        {t("browser.host.miniApp.contentBound")}
      </Text>
      <View style={styles.actions}>
        <SheetAction
          label={t("browser.host.miniApp.deny")}
          onPress={onDeny}
          palette={palette}
        />
        <SheetAction
          label={t("browser.host.miniApp.allow")}
          onPress={onAllow}
          palette={palette}
          primary
        />
      </View>
    </BottomSheet>
  );
}

export function ProjectH5NetworkBlockedView({
  onReview,
  palette,
}: {
  onReview: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.blocked}>
      <View style={[styles.blockedCard, { backgroundColor: palette.surface }]}>
        <Text style={[styles.blockedTitle, { color: palette.text }]}>
          {t("browser.host.miniApp.networkBlocked")}
        </Text>
        <Text style={[styles.explanation, { color: palette.textSecondary }]}>
          {t("browser.host.miniApp.networkBlockedDetail")}
        </Text>
        <View style={styles.actions}>
          <SheetAction
            label={t("browser.host.miniApp.reviewNetwork")}
            onPress={onReview}
            palette={palette}
            primary
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  actionText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  appTitle: { fontSize: 18, fontWeight: "700" },
  disclosure: {
    borderRadius: radii.lg,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  disclosureText: { fontSize: 14, lineHeight: 22 },
  explanation: { fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  impact: { fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  promptLead: { fontSize: 16, fontWeight: "600", lineHeight: 24 },
  blocked: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  blockedCard: {
    borderRadius: radii.lg,
    maxWidth: 440,
    padding: spacing.lg,
    width: "100%",
  },
  blockedTitle: { fontSize: 18, fontWeight: "700" },
});
