import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  DeviceCapabilityId,
  DeviceCapabilityPolicy,
  DeviceCapabilitySettings,
} from "@/application/ports/device-capabilities";
import { AppIcon, type IconName } from "@/components/app-icon";
import { LoadingIndicator } from "@/components/loading-indicator";
import { SegmentedControl } from "@/components/segmented-control";
import { ScreenHeader, SectionLabel } from "@/components/ui";
import { P0_DEVICE_CAPABILITY_POLICIES } from "@/domain/device-capability-catalog";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import {
  DeviceSystemPermissionDeniedError,
  getDeviceSystemPermission,
  openDeviceSystemSettings,
  requestDeviceSystemPermission,
  type DeviceSystemPermissionState,
} from "@/infrastructure/device/device-system-permissions";
import { useAppServices } from "@/providers/runtime-services-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type CapabilityPresentation = Readonly<{
  id: DeviceCapabilityId;
  title: MessageKey;
  detail: MessageKey;
  icon: IconName;
  group:
    | "device"
    | "connectivity"
    | "communication"
    | "personal"
    | "sensors"
    | "media";
}>;

const CAPABILITIES: readonly CapabilityPresentation[] = [
  {
    id: "device-status",
    title: "settings.device.capability.deviceStatus",
    detail: "settings.device.capability.deviceStatusDetail",
    icon: "phone-portrait-outline",
    group: "device",
  },
  {
    id: "power",
    title: "settings.device.capability.power",
    detail: "settings.device.capability.powerDetail",
    icon: "battery-half-outline",
    group: "device",
  },
  {
    id: "storage",
    title: "settings.device.capability.storage",
    detail: "settings.device.capability.storageDetail",
    icon: "server-outline",
    group: "device",
  },
  {
    id: "network",
    title: "settings.device.capability.network",
    detail: "settings.device.capability.networkDetail",
    icon: "git-network-outline",
    group: "connectivity",
  },
  {
    id: "location",
    title: "settings.device.capability.location",
    detail: "settings.device.capability.locationDetail",
    icon: "location-outline",
    group: "connectivity",
  },
  {
    id: "wifi",
    title: "settings.device.capability.wifi",
    detail: "settings.device.capability.wifiDetail",
    icon: "wifi-outline",
    group: "connectivity",
  },
  {
    id: "bluetooth",
    title: "settings.device.capability.bluetooth",
    detail: "settings.device.capability.bluetoothDetail",
    icon: "bluetooth-outline",
    group: "communication",
  },
  {
    id: "local-network",
    title: "settings.device.capability.localNetwork",
    detail: "settings.device.capability.localNetworkDetail",
    icon: "radio-outline",
    group: "communication",
  },
  {
    id: "external-apps",
    title: "settings.device.capability.externalApps",
    detail: "settings.device.capability.externalAppsDetail",
    icon: "open-outline",
    group: "communication",
  },
  {
    id: "calendar",
    title: "settings.device.capability.calendar",
    detail: "settings.device.capability.calendarDetail",
    icon: "calendar-outline",
    group: "personal",
  },
  {
    id: "reminders",
    title: "settings.device.capability.reminders",
    detail: "settings.device.capability.remindersDetail",
    icon: "checkbox-outline",
    group: "personal",
  },
  {
    id: "sensors",
    title: "settings.device.capability.sensors",
    detail: "settings.device.capability.sensorsDetail",
    icon: "speedometer-outline",
    group: "sensors",
  },
  {
    id: "audio",
    title: "settings.device.capability.audio",
    detail: "settings.device.capability.audioDetail",
    icon: "musical-notes-outline",
    group: "media",
  },
];

export function DeviceCapabilitiesSettingsScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { deviceCapabilityPolicies } = useAppServices();
  const [settings, setSettings] = useState<DeviceCapabilitySettings>(
    P0_DEVICE_CAPABILITY_POLICIES,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DeviceCapabilityId | null>(null);
  const [systemPermissions, setSystemPermissions] = useState<
    Partial<Record<DeviceCapabilityId, DeviceSystemPermissionState>>
  >({});
  const permissionOptions = useMemo(
    () =>
      [
        { label: t("settings.device.policy.allow"), value: "allow" },
        { label: t("settings.device.policy.ask"), value: "ask" },
        { label: t("settings.device.policy.deny"), value: "deny" },
      ] as const,
    [t],
  );

  const refreshPermissions = () => {
    void Promise.all(
      CAPABILITIES.map(
        async ({ id }) => [id, await getDeviceSystemPermission(id)] as const,
      ),
    ).then(
      (entries) => setSystemPermissions(Object.fromEntries(entries)),
      () => setSystemPermissions({}),
    );
  };

  useEffect(() => {
    let active = true;
    void deviceCapabilityPolicies.load().then(
      (value) => {
        if (!active) return;
        setSettings(value);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError(t("settings.device.readFailed"));
        setLoading(false);
      },
    );
    refreshPermissions();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPermissions();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [deviceCapabilityPolicies, t]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const setPolicy = (
    capability: DeviceCapabilityId,
    policy: DeviceCapabilityPolicy,
  ) => {
    if (pending) return;
    setPending(capability);
    void (async () => {
      if (policy === "allow") {
        const system = await requestDeviceSystemPermission(capability);
        if (system.status !== "granted" && system.status !== "not-required") {
          throw new DeviceSystemPermissionDeniedError(capability, system);
        }
      }
      const next = await deviceCapabilityPolicies.set(capability, policy);
      setSettings(next);
    })()
      .catch((failure: unknown) => {
        if (
          failure instanceof DeviceSystemPermissionDeniedError &&
          !failure.canAskAgain
        ) {
          Alert.alert(
            t("settings.device.permissionRequired"),
            t("settings.device.permissionRequiredDetail"),
            [
              { text: t("settings.common.cancel"), style: "cancel" },
              {
                text: t("settings.device.openSettings"),
                onPress: () => void openDeviceSystemSettings(),
              },
            ],
          );
        } else {
          Alert.alert(
            failure instanceof DeviceSystemPermissionDeniedError
              ? t("settings.device.permissionDenied")
              : t("settings.device.saveFailed"),
          );
        }
      })
      .finally(() => {
        setPending(null);
        refreshPermissions();
      });
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
        title={t("settings.device.title")}
      />
      {loading ? (
        <LoadingIndicator
          accessibilityLabel={t("settings.device.reading")}
          palette={palette}
          style={styles.loading}
          variant="screen"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.intro, { color: palette.textSecondary }]}>
            {t("settings.device.intro")}
          </Text>
          {(
            [
              "device",
              "connectivity",
              "communication",
              "personal",
              "sensors",
              "media",
            ] as const
          ).map((group) => (
            <View key={group}>
              <SectionLabel palette={palette}>
                {t(`settings.device.section.${group}` as MessageKey)}
              </SectionLabel>
              {CAPABILITIES.filter((item) => item.group === group).map(
                (item) => {
                  const system = systemPermissions[item.id];
                  const systemLabel =
                    system?.status === "granted"
                      ? t("settings.device.system.allowed")
                      : system?.status === "denied"
                        ? t("settings.device.system.denied")
                        : system?.status === "undetermined"
                          ? t("settings.device.system.notRequested")
                          : null;
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.row,
                        { borderBottomColor: palette.border },
                      ]}
                    >
                      <View style={styles.heading}>
                        <View
                          style={[
                            styles.icon,
                            { backgroundColor: palette.codeSurface },
                          ]}
                        >
                          <AppIcon
                            color={palette.textSecondary}
                            name={item.icon}
                            size={19}
                          />
                        </View>
                        <View style={styles.copy}>
                          <View style={styles.titleRow}>
                            <Text
                              style={[styles.title, { color: palette.text }]}
                            >
                              {t(item.title)}
                            </Text>
                            {systemLabel ? (
                              <Text
                                style={[
                                  styles.system,
                                  { color: palette.textTertiary },
                                ]}
                              >
                                {systemLabel}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            style={[
                              styles.detail,
                              { color: palette.textSecondary },
                            ]}
                          >
                            {t(item.detail)}
                          </Text>
                        </View>
                      </View>
                      <SegmentedControl
                        accessibilityLabel={t(
                          "settings.device.policy.accessibility",
                          {
                            capability: t(item.title),
                          },
                        )}
                        onChange={(policy) => setPolicy(item.id, policy)}
                        options={permissionOptions}
                        palette={palette}
                        value={settings[item.id]}
                      />
                      {pending === item.id ? (
                        <Text
                          accessibilityLiveRegion="polite"
                          style={[
                            styles.saving,
                            { color: palette.textTertiary },
                          ]}
                        >
                          {t("settings.device.saving")}
                        </Text>
                      ) : null}
                    </View>
                  );
                },
              )}
            </View>
          ))}
          <Text style={[styles.note, { color: palette.textSecondary }]}>
            {t("settings.device.profileNote")}
          </Text>
          {error ? (
            <Text style={[styles.error, { color: palette.danger }]}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: spacing.sm },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  heading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  icon: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  copy: { flex: 1, minWidth: 0 },
  titleRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  title: { fontSize: 16, fontWeight: "600" },
  system: { fontSize: 11, fontWeight: "600" },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  saving: { fontSize: 11, textAlign: "right" },
  note: { fontSize: 12, lineHeight: 19, marginTop: spacing.lg },
  error: { fontSize: 13, lineHeight: 19, marginTop: spacing.md },
});
