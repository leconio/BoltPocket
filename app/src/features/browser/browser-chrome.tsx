import Ionicons from "@react-native-vector-icons/ionicons";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type ComponentRef,
} from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { BottomSheet, IconButton, ListRow } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

import type { BrowserTask } from "./browser-provider";
import { useBrowserActions, useBrowserState } from "./browser-provider";
import {
  browserTaskDetail,
  browserTaskTitle,
} from "./browser-task-presentation";

export function BrowserTabStrip({
  activeTaskId,
  canCreateTask,
  onCloseTask,
  onNewTask,
  onSelectTask,
  ownerLabels,
  palette,
  tasks,
}: {
  activeTaskId: string | null;
  canCreateTask: boolean;
  onCloseTask: (taskId: string) => void;
  onNewTask: () => void;
  onSelectTask: (taskId: string) => void;
  ownerLabels: Readonly<Record<string, string | undefined>>;
  palette: AppPalette;
  tasks: readonly BrowserTask[];
}) {
  const { t } = useI18n();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const activeIndex = tasks.findIndex((task) => task.id === activeTaskId);
  useEffect(() => {
    if (activeIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: true,
        x: Math.max(0, activeIndex * 192 - 8),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex]);
  if (tasks.length < 2) return null;
  return (
    <View
      style={[
        styles.tabStrip,
        {
          backgroundColor: palette.background,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.tabStripContent}
        horizontal
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        showsHorizontalScrollIndicator={false}
      >
        {tasks.map((task, index) => {
          const selected = task.id === activeTaskId;
          const title = browserTaskTitle(task, t);
          const detail = [ownerLabels[task.id], browserTaskDetail(task, t)]
            .filter(Boolean)
            .join(" · ");
          return (
            <View
              key={task.id}
              style={[
                styles.browserTab,
                {
                  backgroundColor: selected
                    ? palette.accentSoft
                    : palette.surface,
                  borderColor: selected ? palette.accent : palette.border,
                },
              ]}
            >
              <Pressable
                accessibilityLabel={t("browser.chrome.switchTask", {
                  detail,
                  index: index + 1,
                  title,
                })}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onSelectTask(task.id)}
                style={({ pressed }) => [
                  styles.browserTabMain,
                  pressed && { opacity: 0.62 },
                ]}
              >
                <View
                  style={[
                    styles.browserTabIndex,
                    {
                      backgroundColor: selected
                        ? palette.accent
                        : palette.codeSurface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.browserTabIndexText,
                      {
                        color: selected
                          ? palette.background
                          : palette.textSecondary,
                      },
                    ]}
                  >
                    {index + 1}
                  </Text>
                </View>
                {task.navigation.loading ? (
                  <LoadingIndicator palette={palette} variant="inline" />
                ) : (
                  <Ionicons
                    color={selected ? palette.accent : palette.textSecondary}
                    name={
                      task.source.kind === "project-preview"
                        ? "code-slash-outline"
                        : "globe-outline"
                    }
                    size={15}
                  />
                )}
                <View style={styles.browserTabCopy}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.browserTabTitle,
                      { color: selected ? palette.accent : palette.text },
                    ]}
                  >
                    {title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.browserTabDetail,
                      { color: palette.textTertiary },
                    ]}
                  >
                    {detail}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel={t("browser.chrome.closeTask", {
                  index: index + 1,
                  title,
                })}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => onCloseTask(task.id)}
                style={({ pressed }) => [
                  styles.browserTabClose,
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <Ionicons color={palette.textTertiary} name="close" size={14} />
              </Pressable>
            </View>
          );
        })}
        <Pressable
          accessibilityLabel={t("browser.chrome.newTask")}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canCreateTask }}
          disabled={!canCreateTask}
          onPress={onNewTask}
          style={({ pressed }) => [
            styles.browserTabNew,
            { backgroundColor: palette.surface, borderColor: palette.border },
            pressed && { backgroundColor: palette.accentSoft },
            !canCreateTask && { opacity: 0.35 },
          ]}
        >
          <Ionicons color={palette.textSecondary} name="add" size={19} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

export function BrowserHeader({
  address,
  addressFocused,
  agentGranted,
  agentLabel,
  currentUrl,
  loading,
  onAddressBlur,
  onAddressChange,
  onAddressFocus,
  onAddressSubmit,
  onMenu,
  onMinimize,
  palette,
  previewLabel,
}: {
  address: string;
  addressFocused: boolean;
  agentGranted: boolean;
  agentLabel: string;
  currentUrl: string | null;
  loading: boolean;
  onAddressBlur: () => void;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressSubmit: () => void;
  onMenu: () => void;
  onMinimize: () => void;
  palette: AppPalette;
  previewLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <View style={[styles.addressBar, { borderBottomColor: palette.border }]}>
        <IconButton
          icon="chevron-down"
          label={t("browser.chrome.minimize")}
          onPress={onMinimize}
          palette={palette}
        />
        <View
          style={[
            styles.addressInputSurface,
            {
              backgroundColor: palette.surface,
              borderColor: addressFocused ? palette.accent : palette.border,
            },
          ]}
        >
          <Ionicons
            color={
              previewLabel || currentUrl?.startsWith("https://")
                ? palette.success
                : palette.textTertiary
            }
            name={
              previewLabel
                ? "code-slash-outline"
                : currentUrl?.startsWith("https://")
                  ? "lock-closed-outline"
                  : "search-outline"
            }
            size={15}
          />
          {previewLabel ? (
            <Text
              accessibilityLabel={t("browser.chrome.preview", {
                label: previewLabel,
              })}
              numberOfLines={1}
              style={[styles.previewTitle, { color: palette.text }]}
            >
              {previewLabel}
            </Text>
          ) : (
            <TextInput
              accessibilityLabel={t("browser.chrome.address")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onBlur={onAddressBlur}
              onChangeText={onAddressChange}
              onFocus={onAddressFocus}
              onSubmitEditing={onAddressSubmit}
              placeholder={t("browser.chrome.address")}
              placeholderTextColor={palette.textTertiary}
              returnKeyType="go"
              selectTextOnFocus
              style={[styles.addressInput, { color: palette.text }]}
              value={addressFocused ? address : (currentUrl ?? "")}
            />
          )}
          {loading ? (
            <LoadingIndicator palette={palette} variant="inline" />
          ) : null}
        </View>
        <IconButton
          icon="ellipsis-horizontal"
          label={t("browser.chrome.menu")}
          onPress={onMenu}
          palette={palette}
        />
      </View>

      {agentGranted ? (
        <View
          style={[styles.agentStatus, { backgroundColor: palette.accentSoft }]}
        >
          <View
            style={[styles.agentDot, { backgroundColor: palette.accent }]}
          />
          <Text
            numberOfLines={1}
            style={[styles.agentStatusText, { color: palette.accent }]}
          >
            {agentLabel}
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function BrowserMenuSheet({
  agentGranted,
  agentManaged,
  currentUrl,
  onClose,
  onH5History,
  onOpenExternal,
  onPermissions,
  onReload,
  onToggleAgentGrant,
  onToggleFullscreen,
  palette,
  visible,
  fullscreen = false,
  projectPreview = false,
}: {
  agentGranted: boolean;
  agentManaged: boolean;
  currentUrl: string | null;
  onClose: () => void;
  onH5History: () => void;
  onOpenExternal: () => void;
  onPermissions: () => void;
  onReload: () => void;
  onToggleAgentGrant: () => void;
  onToggleFullscreen: () => void;
  palette: AppPalette;
  visible: boolean;
  fullscreen?: boolean;
  projectPreview?: boolean;
}) {
  const { t } = useI18n();
  const { close } = useBrowserActions();
  const multipleTasks = useBrowserState((browser) => browser.tasks.length > 1);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const closeThen = (action: () => void) => {
    if (Platform.OS === "ios") {
      if (pendingActionRef.current) return;
      pendingActionRef.current = action;
      onClose();
      return;
    }
    onClose();
    action();
  };
  const performPendingAction = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };

  return (
    <BottomSheet
      onDismiss={performPendingAction}
      onClose={onClose}
      palette={palette}
      title={t("browser.chrome.title")}
      visible={visible}
    >
      <ListRow
        icon="apps-outline"
        onPress={() => closeThen(onH5History)}
        palette={palette}
        title={t("browser.chrome.h5History")}
      />
      {projectPreview ? (
        <ListRow
          icon="shield-checkmark-outline"
          onPress={() => closeThen(onPermissions)}
          palette={palette}
          title={t("browser.chrome.miniAppPermissions")}
        />
      ) : null}
      {projectPreview && currentUrl ? (
        <>
          <ListRow
            icon="refresh"
            onPress={() => closeThen(onReload)}
            palette={palette}
            title={t("browser.host.toolbar.refresh")}
          />
        </>
      ) : null}
      <ListRow
        icon={fullscreen ? "contract-outline" : "expand-outline"}
        onPress={() => closeThen(onToggleFullscreen)}
        palette={palette}
        title={t(
          fullscreen
            ? "browser.chrome.exitFullscreen"
            : "browser.chrome.fullscreen",
        )}
      />
      {!projectPreview && currentUrl ? (
        <>
          <ListRow
            icon="open-outline"
            onPress={() => closeThen(onOpenExternal)}
            palette={palette}
            title={t("browser.chrome.openSystem")}
          />
          <ListRow
            icon={agentGranted ? "shield-checkmark" : "shield-outline"}
            onPress={onToggleAgentGrant}
            palette={palette}
            title={
              agentManaged
                ? t("browser.chrome.agent.temporary")
                : agentGranted
                  ? t("browser.chrome.agent.revoke")
                  : t("browser.chrome.agent.allow")
            }
          />
        </>
      ) : null}
      <ListRow
        destructive
        icon="close-circle-outline"
        onPress={() => closeThen(close)}
        palette={palette}
        title={t(
          multipleTasks
            ? "browser.chrome.closeTab"
            : "browser.chrome.closeBrowser",
        )}
      />
    </BottomSheet>
  );
}

export function BrowserStartPage({ palette }: { palette: AppPalette }) {
  const { t } = useI18n();
  return (
    <ScrollView
      contentContainerStyle={styles.startPage}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.startMark, { backgroundColor: palette.accentSoft }]}>
        <Ionicons color={palette.accent} name="globe-outline" size={28} />
      </View>
      <Text style={[styles.startTitle, { color: palette.text }]}>
        {t("browser.chrome.title")}
      </Text>
    </ScrollView>
  );
}

export function BrowserToolbarButton({
  icon,
  label,
  onPress,
  palette,
  disabled = false,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  palette: AppPalette;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        pressed && { backgroundColor: palette.codeSurface },
        disabled && { opacity: 0.3 },
      ]}
    >
      <Ionicons color={palette.textSecondary} name={icon} size={21} />
    </Pressable>
  );
}

export function BrowserFullscreenExit({
  onPress,
  palette,
}: {
  onPress: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityLabel={t("browser.chrome.exitFullscreen")}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.fullscreenExit,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          shadowColor: palette.text,
        },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <Ionicons
        color={palette.textSecondary}
        name="contract-outline"
        size={20}
      />
    </Pressable>
  );
}

export function BrowserFullscreenMenu({
  onPress,
  palette,
}: {
  onPress: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityLabel={t("browser.chrome.menu")}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.fullscreenExit,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          shadowColor: palette.text,
        },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      <Ionicons
        color={palette.textSecondary}
        name="ellipsis-horizontal"
        size={20}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addressBar: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 58,
    paddingHorizontal: spacing.xs,
  },
  tabStrip: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabStripContent: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  browserTab: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 46,
    paddingVertical: spacing.xxs,
    width: 184,
  },
  browserTabMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    paddingLeft: spacing.sm,
  },
  browserTabCopy: { flex: 1, minWidth: 0 },
  browserTabIndex: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 19,
    justifyContent: "center",
    width: 19,
  },
  browserTabIndexText: { fontSize: 10, fontWeight: "700" },
  browserTabTitle: { fontSize: 12.5, fontWeight: "600" },
  browserTabDetail: { fontSize: 10.5, marginTop: 1 },
  browserTabClose: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 30,
    justifyContent: "center",
    marginHorizontal: 3,
    width: 28,
  },
  browserTabNew: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
    justifyContent: "center",
    width: 46,
  },
  addressInputSurface: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  addressInput: {
    flex: 1,
    fontSize: 14,
    minHeight: 40,
    includeFontPadding: false,
    minWidth: 0,
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  previewTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    minWidth: 0,
  },
  agentStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.md,
  },
  agentDot: { borderRadius: radii.pill, height: 7, width: 7 },
  agentStatusText: { flex: 1, fontSize: 11.5, fontWeight: "600" },
  toolbarButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 48,
  },
  fullscreenExit: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    right: spacing.sm,
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    top: spacing.sm,
    width: 42,
    zIndex: 2,
  },
  startPage: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  startMark: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  startTitle: { fontSize: 22, fontWeight: "600", marginTop: spacing.md },
});
