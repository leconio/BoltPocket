import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { useI18n } from "@/i18n/i18n-provider";
import { useAppPalette, spacing } from "@/theme/tokens";
import {
  LOCAL_MODELS,
  type LocalModelId,
} from "@/infrastructure/model-config/local-model-catalog";
import {
  localDownloads,
  selectedLocalModelId,
  selectLocalModel,
} from "@/infrastructure/model-config/local-model-library";
import { loadMainModelChoice } from "@/infrastructure/model-config";
import {
  ModelSettingsAction as Action,
  modelSettingsStyles as styles,
} from "./model-settings-components";

function DownloadAwake() {
  useKeepAwake("local-model-download");
  return null;
}
const formatSize = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${(bytes / 1e6).toFixed(0)} MB`;

export function LocalModelSettingsCard() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const downloads = useSyncExternalStore(
    localDownloads.subscribe,
    localDownloads.snapshot,
  );
  const [selected, setSelected] = useState<LocalModelId>();
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const busy = Object.values(downloads).some(
    ({ phase }) =>
      phase === "downloading" ||
      phase === "verifying" ||
      phase === "cancelling",
  );
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      selectedLocalModelId(),
      localDownloads.refresh(),
      loadMainModelChoice(),
    ])
      .then(([id, , choice]) => {
        if (mounted) {
          setSelected(id);
          setIsDefault(choice.source === "local");
          setLoadError(false);
        }
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const choose = async (id: LocalModelId) => {
    setSaving(true);
    try {
      await selectLocalModel(id);
      setSelected(id);
      setIsDefault(true);
    } catch {
      Alert.alert(t("settings.local.selectFailed"));
    } finally {
      setSaving(false);
    }
  };
  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      Alert.alert(t("settings.local.linkFailed")),
    );
  };
  return (
    <View style={styles.container}>
      {busy ? <DownloadAwake /> : null}
      <Text style={{ color: palette.textSecondary }}>
        {t("settings.local.intro")}
      </Text>
      {loadError ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {t("settings.local.loadFailed")}
        </Text>
      ) : null}
      {LOCAL_MODELS.map((model) => {
        const state = downloads[model.id];
        const ready = state.phase === "ready";
        const active =
          state.phase === "downloading" || state.phase === "cancelling";
        const progress = Math.min(
          100,
          Math.floor((state.received / model.bytes) * 100),
        );
        const status = ready
          ? t("settings.local.ready")
          : state.phase === "verifying"
            ? t("settings.local.verifying")
            : state.phase === "cancelling"
              ? t("settings.local.cancelling")
              : active
                ? t("settings.local.progress", {
                    percent: progress,
                    received: formatSize(state.received),
                    total: formatSize(model.bytes),
                  })
                : t("settings.local.missing");
        return (
          <View
            key={model.id}
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text
                style={[
                  styles.cardTitle,
                  localStyles.name,
                  { color: palette.text },
                ]}
              >
                {model.name}
              </Text>
              {ready && isDefault && selected === model.id ? (
                <Text style={{ color: palette.accent }}>
                  {t("settings.local.selected")}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: palette.textSecondary }}>
              {formatSize(model.bytes)} ·{" "}
              {Platform.OS === "android" && model.androidGpuLayers === 0
                ? "CPU"
                : "GPU"}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: palette.textSecondary }}
            >
              {status}
            </Text>
            {active || state.phase === "verifying" ? (
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: progress }}
                style={[localStyles.track, { backgroundColor: palette.border }]}
              >
                <View
                  style={[
                    localStyles.fill,
                    { width: `${progress}%`, backgroundColor: palette.accent },
                  ]}
                />
              </View>
            ) : null}
            {model.id === "bolt-e4b-local" ? (
              <Text style={{ color: palette.textSecondary }}>
                {t("settings.local.nemotronNote")}
              </Text>
            ) : null}
            {state.error ? (
              <Text accessibilityRole="alert" style={{ color: palette.danger }}>
                {state.error === "storage"
                  ? t("settings.local.storageError")
                  : state.error === "integrity"
                    ? t("settings.local.integrityError")
                    : t("settings.local.networkError")}
              </Text>
            ) : null}
            <View style={localStyles.actions}>
              {ready ? (
                <Action
                  palette={palette}
                  title={
                    isDefault && selected === model.id
                      ? t("settings.local.selected")
                      : t("settings.local.useModel")
                  }
                  disabled={saving || (isDefault && selected === model.id)}
                  onPress={() => {
                    void choose(model.id);
                  }}
                />
              ) : active ? (
                <Action
                  palette={palette}
                  secondary
                  title={
                    state.phase === "cancelling"
                      ? t("settings.local.cancelling")
                      : t("settings.local.cancel")
                  }
                  disabled={state.phase === "cancelling"}
                  onPress={() => {
                    void localDownloads
                      .cancel(model.id)
                      .catch(() =>
                        Alert.alert(t("settings.local.cancelFailed")),
                      );
                  }}
                />
              ) : (
                <Action
                  palette={palette}
                  title={
                    state.phase === "verifying"
                      ? t("settings.local.verifying")
                      : state.phase === "error"
                        ? t("settings.local.retry")
                        : t("settings.local.download")
                  }
                  disabled={busy}
                  onPress={() => {
                    void localDownloads.download(model.id);
                  }}
                />
              )}
              <Action
                palette={palette}
                secondary
                title={t("settings.local.source")}
                onPress={() =>
                  open(
                    `https://huggingface.co/${model.repository}/tree/${model.revision}`,
                  )
                }
              />
              <Action
                palette={palette}
                secondary
                title={model.license}
                onPress={() => open(model.licenseUrl)}
              />
            </View>
          </View>
        );
      })}
      <Text style={{ color: palette.textSecondary }}>
        {t("settings.local.downloadNote")}
      </Text>
    </View>
  );
}
const localStyles = StyleSheet.create({
  name: { flex: 1, marginRight: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4 },
});
