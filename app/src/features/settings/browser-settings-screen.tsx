import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import {
  AppSwitch,
  ListRow,
  ScreenHeader,
  SectionLabel,
  type IconName,
} from "@/components/ui";
import {
  useBrowserActions,
  useBrowserState,
} from "@/features/browser/browser-provider";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import type { BrowserCapabilityKey } from "@/infrastructure/browser/browser-settings-repository";
import {
  BROWSER_SYSTEM_PERMISSION_KEYS,
  BrowserSystemPermissionDeniedError,
  getBrowserSystemPermission,
  openBrowserSystemSettings,
  type BrowserSystemPermissionKey,
  type BrowserSystemPermissionState,
} from "@/infrastructure/browser/browser-system-permissions";
import { spacing, useAppPalette, type AppPalette } from "@/theme/tokens";

type Capability = Readonly<{
  key: BrowserCapabilityKey;
  labelKey: MessageKey;
  icon: IconName;
}>;

const permissionCapabilities: readonly Capability[] = [
  {
    key: "location",
    labelKey: "settings.browser.permission.location",
    icon: "location-outline",
  },
  {
    key: "camera",
    labelKey: "settings.browser.permission.camera",
    icon: "camera-outline",
  },
  {
    key: "microphone",
    labelKey: "settings.browser.permission.microphone",
    icon: "mic-outline",
  },
  {
    key: "fileSelection",
    labelKey: "settings.browser.permission.fileSelection",
    icon: "folder-open-outline",
  },
  {
    key: "motionSensors",
    labelKey: "settings.browser.permission.motion",
    icon: "pulse-outline",
  },
  {
    key: "clipboardRead",
    labelKey: "settings.browser.permission.clipboardRead",
    icon: "clipboard-outline",
  },
  {
    key: "clipboardWrite",
    labelKey: "settings.browser.permission.clipboardWrite",
    icon: "copy-outline",
  },
];

const webCapabilities: readonly Capability[] = [
  {
    key: "downloads",
    labelKey: "settings.browser.feature.downloads",
    icon: "download-outline",
  },
  {
    key: "externalApps",
    labelKey: "settings.browser.feature.externalApps",
    icon: "open-outline",
  },
  {
    key: "sharing",
    labelKey: "settings.browser.feature.sharing",
    icon: "share-outline",
  },
  {
    key: "popups",
    labelKey: "settings.browser.permission.popups",
    icon: "copy-outline",
  },
  {
    key: "fullscreenMedia",
    labelKey: "settings.browser.feature.fullscreenMedia",
    icon: "scan-outline",
  },
  {
    key: "autoplayMedia",
    labelKey: "settings.browser.feature.autoplay",
    icon: "play-circle-outline",
  },
  {
    key: "screenWakeLock",
    labelKey: "settings.browser.feature.keepAwake",
    icon: "sunny-outline",
  },
  {
    key: "screenOrientation",
    labelKey: "settings.browser.feature.screenOrientation",
    icon: "phone-landscape-outline",
  },
  {
    key: "printing",
    labelKey: "settings.browser.feature.printing",
    icon: "print-outline",
  },
  {
    key: "barcodeDetection",
    labelKey: "settings.browser.permission.qrCode",
    icon: "qr-code-outline",
  },
];

async function readBrowserSystemPermissions() {
  const entries = await Promise.all(
    BROWSER_SYSTEM_PERMISSION_KEYS.map(
      async (key) => [key, await getBrowserSystemPermission(key)] as const,
    ),
  );
  return Object.fromEntries(entries) as Partial<
    Record<BrowserSystemPermissionKey, BrowserSystemPermissionState>
  >;
}

export function BrowserSettingsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { clearData } = useBrowserActions();
  const [clearing, setClearing] = useState(false);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };
  const confirmClearData = () => {
    if (clearing) return;
    Alert.alert(
      t("settings.browser.clearData"),
      t("settings.browser.clearDataDetail"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.browser.clearDataConfirm"),
          style: "destructive",
          onPress: () => {
            setClearing(true);
            void clearData()
              .then(
                () => Alert.alert(t("settings.browser.clearDataComplete")),
                (error: unknown) =>
                  Alert.alert(
                    t("settings.browser.clearDataFailed"),
                    localizedErrorMessage(
                      error,
                      t("settings.browser.error.retry"),
                    ),
                  ),
              )
              .finally(() => setClearing(false));
          },
        },
      ],
    );
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
        title={t("settings.browser.title")}
      />
      <ScrollView
        contentContainerStyle={styles.settingsContent}
        showsVerticalScrollIndicator={false}
      >
        <ListRow
          icon="shield-checkmark-outline"
          onPress={() => router.push("./browser-permissions")}
          palette={palette}
          title={t("settings.browser.permissionsTitle")}
        />
        <ListRow
          destructive
          icon="trash-outline"
          onPress={clearing ? undefined : confirmClearData}
          palette={palette}
          title={t("settings.browser.clearData")}
          value={clearing ? t("settings.browser.clearDataClearing") : undefined}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

export function BrowserPermissionsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { setCapability: saveCapability } = useBrowserActions();
  const settings = useBrowserState((browser) => browser.settings);
  const settingsLoading = useBrowserState((browser) => browser.settingsLoading);
  const settingsError = useBrowserState((browser) => browser.settingsError);
  const [pending, setPending] = useState<BrowserCapabilityKey | null>(null);
  const [systemPermissions, setSystemPermissions] = useState<
    Partial<Record<BrowserSystemPermissionKey, BrowserSystemPermissionState>>
  >({});

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void readBrowserSystemPermissions().then(
        (permissions) => {
          if (active) setSystemPermissions(permissions);
        },
        () => {
          if (active) setSystemPermissions({});
        },
      );
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const setCapability = (key: BrowserCapabilityKey, enabled: boolean) => {
    setPending(key);
    void saveCapability(key, enabled)
      .catch((error: unknown) => {
        if (
          error instanceof BrowserSystemPermissionDeniedError &&
          !error.canAskAgain
        ) {
          Alert.alert(
            t("settings.browser.error.permissionRequired"),
            localizedErrorMessage(
              error,
              t("settings.browser.error.permissionRequiredDetail"),
            ),
            [
              { text: t("settings.common.cancel"), style: "cancel" },
              {
                text: t("settings.browser.error.openSettings"),
                onPress: () => void openBrowserSystemSettings(),
              },
            ],
          );
          return;
        }
        Alert.alert(
          error instanceof BrowserSystemPermissionDeniedError
            ? t("settings.browser.error.permissionDenied")
            : t("settings.browser.error.couldNotSave"),
          localizedErrorMessage(error, t("settings.browser.error.retry")),
        );
      })
      .finally(() => {
        setPending(null);
        void readBrowserSystemPermissions().then(setSystemPermissions, () =>
          setSystemPermissions({}),
        );
      });
  };

  const platformCapabilities: readonly Capability[] =
    Platform.OS === "ios"
      ? [
          {
            key: "pictureInPicture",
            labelKey: "settings.browser.feature.pictureInPicture",
            icon: "albums-outline",
          },
          {
            key: "airPlay",
            labelKey: "settings.browser.feature.airPlay",
            icon: "tv-outline",
          },
        ]
      : Platform.OS === "android"
        ? [
            {
              key: "vibration",
              labelKey: "settings.browser.feature.vibration",
              icon: "phone-portrait-outline",
            },
            {
              key: "protectedMedia",
              labelKey: "settings.browser.feature.protectedMedia",
              icon: "shield-outline",
            },
          ]
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
        title={t("settings.browser.permissionsTitle")}
      />
      {settingsLoading ? (
        <View style={styles.loading}>
          <LoadingIndicator
            accessibilityLabel={t("settings.browser.reading")}
            palette={palette}
            style={styles.loading}
            variant="screen"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel palette={palette}>
            {t("settings.browser.section.permissions")}
          </SectionLabel>
          {permissionCapabilities.map((capability) => (
            <CapabilityRow
              capability={capability}
              disabled={pending !== null}
              enabled={settings[capability.key]}
              key={capability.key}
              onChange={setCapability}
              palette={palette}
              systemPermission={
                capability.key === "location" ||
                capability.key === "camera" ||
                capability.key === "microphone"
                  ? systemPermissions[capability.key]
                  : undefined
              }
            />
          ))}
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t("settings.browser.requestExplanation")}
          </Text>

          <SectionLabel palette={palette}>
            {t("settings.browser.section.webFeatures")}
          </SectionLabel>
          {[...webCapabilities, ...platformCapabilities].map((capability) => (
            <CapabilityRow
              capability={capability}
              disabled={pending !== null}
              enabled={settings[capability.key]}
              key={capability.key}
              onChange={setCapability}
              palette={palette}
            />
          ))}

          {settingsError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.error, { color: palette.danger }]}
            >
              {settingsError}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CapabilityRow({
  capability,
  disabled,
  enabled,
  onChange,
  palette,
  systemPermission,
}: {
  capability: Capability;
  disabled: boolean;
  enabled: boolean;
  onChange: (key: BrowserCapabilityKey, enabled: boolean) => void;
  palette: AppPalette;
  systemPermission?: BrowserSystemPermissionState;
}) {
  const { t } = useI18n();
  const label = t(capability.labelKey);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled, disabled }}
      disabled={disabled}
      onPress={() => onChange(capability.key, !enabled)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: palette.border },
        pressed && styles.rowPressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.codeSurface }]}>
        <Ionicons
          color={palette.textSecondary}
          name={capability.icon}
          size={18}
        />
      </View>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      {systemPermission && systemPermission.status !== "unavailable" ? (
        <Text
          style={[styles.permissionStatus, { color: palette.textTertiary }]}
        >
          {systemPermission.status === "granted"
            ? t("settings.browser.state.allowed")
            : systemPermission.status === "denied"
              ? t("settings.browser.state.denied")
              : t("settings.browser.state.notRequested")}
        </Text>
      ) : null}
      <View pointerEvents="none">
        <AppSwitch
          accessible={false}
          disabled={disabled}
          ios_backgroundColor={palette.borderStrong}
          style={styles.capabilitySwitch}
          thumbColor={Platform.OS === "android" ? palette.surface : undefined}
          trackColor={{ false: palette.borderStrong, true: palette.accent }}
          value={enabled}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  settingsContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 58,
  },
  rowPressed: { opacity: 0.72 },
  icon: {
    alignItems: "center",
    borderRadius: 10,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  rowLabel: { flex: 1, fontSize: 16, marginLeft: spacing.sm },
  permissionStatus: { fontSize: 12, marginRight: spacing.sm },
  capabilitySwitch: {
    // React Native gives iOS Switch an explicit flex-start self-alignment.
    // Override it so the visible control follows the row's vertical center.
    alignSelf: "center",
    flexShrink: 0,
  },
  note: { fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  error: { fontSize: 13, lineHeight: 19, marginTop: spacing.lg },
});
