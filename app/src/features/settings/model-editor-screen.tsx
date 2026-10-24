import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { BottomSheet, ScreenHeader } from "@/components/ui";
import {
  ModelSettingsAction as ActionButton,
  ModelSettingsField as Field,
} from "@/features/settings/model-settings-components";
import {
  EDITABLE_MODEL_PURPOSES,
  purposeSummary,
} from "@/features/settings/model-settings-draft";
import { ModelContextWindowSlider } from "@/features/settings/model-context-window-slider";
import { useModelSettingsSession } from "@/features/settings/model-settings-session";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  defaultModelContextWindow,
  discoverConfiguredModelNames,
  type ModelPurpose,
} from "@/infrastructure/model-config";
import { OPENAI_CODEX_PROVIDER_KIND } from "@/infrastructure/model-config/codex-provider-constants";
import { formatCompactTokenCount } from "@/application/conversation-context-usage";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type ActiveSheet = "models" | "purposes" | null;
type Draft = {
  modelId: string;
  contextWindow: number;
  contextWindowCustomized: boolean;
  purposes: ModelPurpose[];
};

export function ModelEditorScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const session = useModelSettingsSession();
  const { load } = session;
  const { providerId: providerIdParam, modelProfileId: modelProfileIdParam } =
    useLocalSearchParams<{
      providerId?: string;
      modelProfileId?: string;
    }>();
  const providerId = typeof providerIdParam === "string" ? providerIdParam : "";
  const modelProfileId =
    typeof modelProfileIdParam === "string" ? modelProfileIdParam : null;
  const provider = session.providers.find((item) => item.id === providerId);
  const editablePurposes =
    provider?.kind === OPENAI_CODEX_PROVIDER_KIND
      ? EDITABLE_MODEL_PURPOSES.filter(
          (purpose) =>
            purpose.id !== "imageGeneration" &&
            purpose.id !== "videoGeneration",
        )
      : EDITABLE_MODEL_PURPOSES;
  const editing = modelProfileId
    ? session.models.find((model) => model.id === modelProfileId)
    : null;
  const draftKey = modelProfileId ?? `new:${providerId}`;
  const defaultDraft: Draft = editing
    ? {
        modelId: editing.modelId,
        contextWindow: editing.contextWindow,
        contextWindowCustomized: true,
        purposes: [...editing.purposes],
      }
    : {
        modelId: "",
        contextWindow: defaultModelContextWindow(""),
        contextWindowCustomized: false,
        purposes: [],
      };
  const [draftState, setDraftState] = useState<{
    key: string;
    value: Draft;
  } | null>(null);
  const draft = draftState?.key === draftKey ? draftState.value : defaultDraft;
  const setDraft = (update: (value: Draft) => Draft) => {
    setDraftState((current) => ({
      key: draftKey,
      value: update(current?.key === draftKey ? current.value : defaultDraft),
    }));
  };
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoveryAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void load().catch((caught: unknown) =>
      setError(errorMessage(caught, t("settings.model.settingFailed"))),
    );
    return () => discoveryAbort.current?.abort();
  }, [load, t]);

  const visibleModels = useMemo(() => {
    const query = modelFilter.trim().toLocaleLowerCase();
    return availableModels
      .filter((model) => !query || model.toLocaleLowerCase().includes(query))
      .slice(0, 100);
  }, [availableModels, modelFilter]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings/model");
  };

  const togglePurpose = (purpose: ModelPurpose) => {
    setDraft((current) => ({
      ...current,
      purposes: current.purposes.includes(purpose)
        ? current.purposes.filter((item) => item !== purpose)
        : [...current.purposes, purpose],
    }));
  };

  const discoverModels = async () => {
    if (!provider || discovering) return;
    discoveryAbort.current?.abort();
    const controller = new AbortController();
    discoveryAbort.current = controller;
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const models = await discoverConfiguredModelNames(
        {
          providerId: provider.id,
          providerKind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey:
            provider.apiKeyDraft.trim() ||
            (provider.hasStoredApiKey && !provider.apiKeyNeedsReplacement
              ? undefined
              : ""),
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setAvailableModels(models);
      setModelFilter("");
    } catch (caught) {
      if (!controller.signal.aborted) {
        setDiscoveryError(
          errorMessage(caught, t("settings.model.settingFailed")),
        );
      }
    } finally {
      if (discoveryAbort.current === controller) {
        discoveryAbort.current = null;
        if (!controller.signal.aborted) setDiscovering(false);
      }
    }
  };

  const openModelSheet = () => {
    setActiveSheet("models");
    if (availableModels.length === 0 && !discovering) {
      void discoverModels();
    }
  };

  const save = async () => {
    if (!provider || saving) return;
    setSaving(true);
    setError(null);
    try {
      await session.upsertModel({
        providerId: provider.id,
        ...(editing ? { modelProfileId: editing.id } : {}),
        modelId: draft.modelId,
        contextWindow: draft.contextWindow,
        purposes: draft.purposes,
      });
      goBack();
    } catch (caught) {
      setError(errorMessage(caught, t("settings.model.settingFailed")));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = () => {
    if (!editing || saving) return;
    Alert.alert(
      t("settings.model.deleteModelTitle"),
      t("settings.model.deleteModelConfirm", { model: editing.modelId }),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.model.delete"),
          style: "destructive",
          onPress: () => {
            setSaving(true);
            setError(null);
            void session
              .removeModel(editing.id)
              .then(goBack)
              .catch((caught: unknown) =>
                setError(
                  errorMessage(caught, t("settings.model.settingFailed")),
                ),
              )
              .finally(() => setSaving(false));
          },
        },
      ],
    );
  };

  const canSave = Boolean(draft.modelId.trim() && draft.purposes.length > 0);
  const pageReady = session.loaded && provider && (!modelProfileId || editing);

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        subtitle={provider?.name}
        title={t(editing ? "settings.model.edit" : "settings.model.addModel")}
      />
      {!pageReady ? (
        session.loading ? (
          <LoadingIndicator
            accessibilityLabel={t("settings.model.reading")}
            palette={palette}
            style={styles.loading}
            variant="screen"
          />
        ) : (
          <View style={styles.loading}>
            <Text style={{ color: palette.danger }}>
              {t("settings.model.modelMissing")}
            </Text>
          </View>
        )
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.safeArea}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.content}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Field
              editable={!editing}
              label={t("settings.model.model")}
              onChangeText={(modelId) =>
                setDraft((current) => ({
                  ...current,
                  modelId,
                  contextWindow: current.contextWindowCustomized
                    ? current.contextWindow
                    : defaultModelContextWindow(modelId),
                }))
              }
              palette={palette}
              placeholder={t("settings.model.modelName")}
              rightAction={
                editing
                  ? undefined
                  : {
                      accessibilityLabel: t("settings.model.fetch"),
                      onPress: openModelSheet,
                      title: t("settings.model.fetchShort"),
                    }
              }
              value={draft.modelId}
            />

            <View style={styles.fieldGroup}>
              <View style={styles.contextWindowHeader}>
                <Text style={[styles.fieldLabel, { color: palette.text }]}>
                  {t("settings.model.contextWindow")}
                </Text>
                <Text
                  style={[styles.contextWindowValue, { color: palette.accent }]}
                >
                  {formatCompactTokenCount(draft.contextWindow)}
                </Text>
              </View>
              <Text
                style={[
                  styles.contextWindowDetail,
                  { color: palette.textSecondary },
                ]}
              >
                {t("settings.model.contextWindowDetail")}
              </Text>
              <ModelContextWindowSlider
                accessibilityLabel={t(
                  "settings.model.contextWindowAccessibility",
                  { size: formatCompactTokenCount(draft.contextWindow) },
                )}
                onChange={(contextWindow) =>
                  setDraft((current) => ({
                    ...current,
                    contextWindow,
                    contextWindowCustomized: true,
                  }))
                }
                palette={palette}
                value={draft.contextWindow}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.text }]}>
                {t("settings.model.category")}
              </Text>
              <Pressable
                accessibilityLabel={t(
                  "settings.model.category.chooseAccessibility",
                )}
                accessibilityRole="button"
                onPress={() => setActiveSheet("purposes")}
                style={({ pressed }) => [
                  styles.valueRow,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <Text
                  numberOfLines={2}
                  style={[
                    styles.valueText,
                    {
                      color:
                        draft.purposes.length > 0
                          ? palette.text
                          : palette.textTertiary,
                    },
                  ]}
                >
                  {draft.purposes.length > 0
                    ? purposeSummary(draft.purposes, t)
                    : t("settings.model.category.choose")}
                </Text>
                <Ionicons
                  color={palette.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            </View>

            {error ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.error, { backgroundColor: palette.dangerSoft }]}
              >
                <Text style={[styles.errorText, { color: palette.danger }]}>
                  {error}
                </Text>
              </View>
            ) : null}

            <ActionButton
              disabled={!canSave}
              loading={saving}
              onPress={() => void save()}
              palette={palette}
              title={t(editing ? "settings.model.save" : "settings.model.add")}
            />
            {editing ? (
              <ActionButton
                danger
                disabled={saving}
                onPress={confirmRemove}
                palette={palette}
                secondary
                title={t("settings.model.deleteModel")}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("settings.model.fetch")}
        visible={activeSheet === "models"}
      >
        <TextInput
          accessibilityLabel={t("settings.model.search")}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setModelFilter}
          placeholder={t("settings.model.search")}
          placeholderTextColor={palette.textTertiary}
          style={[
            styles.searchInput,
            {
              backgroundColor: palette.codeSurface,
              color: palette.text,
            },
          ]}
          value={modelFilter}
        />
        {discovering ? (
          <LoadingIndicator
            accessibilityLabel={t("settings.model.fetching")}
            palette={palette}
            style={styles.sheetLoading}
            variant="list"
          />
        ) : discoveryError ? (
          <View style={styles.sheetMessage}>
            <Text style={[styles.sheetMessageText, { color: palette.danger }]}>
              {discoveryError}
            </Text>
            <ActionButton
              onPress={() => void discoverModels()}
              palette={palette}
              secondary
              title={t("settings.model.retry")}
            />
          </View>
        ) : (
          <View style={styles.optionList}>
            {visibleModels.map((model, index) => (
              <Pressable
                accessibilityLabel={t("settings.model.use", { model })}
                accessibilityRole="button"
                key={model}
                onPress={() => {
                  setDraft((current) => ({
                    ...current,
                    modelId: model,
                    contextWindow: current.contextWindowCustomized
                      ? current.contextWindow
                      : defaultModelContextWindow(model),
                  }));
                  setActiveSheet(null);
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  {
                    borderBottomColor: palette.border,
                    borderBottomWidth:
                      index === visibleModels.length - 1 ? 0 : undefined,
                  },
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <Text style={[styles.optionTitle, { color: palette.text }]}>
                  {model}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </BottomSheet>

      <BottomSheet
        onClose={() => setActiveSheet(null)}
        palette={palette}
        title={t("settings.model.category.choose")}
        visible={activeSheet === "purposes"}
      >
        <View style={styles.optionList}>
          {editablePurposes.map((option, index) => {
            const selected = draft.purposes.includes(option.id);
            return (
              <Pressable
                accessibilityLabel={t(
                  selected
                    ? "settings.model.category.deselect"
                    : "settings.model.category.select",
                  { label: t(option.labelKey) },
                )}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={option.id}
                onPress={() => togglePurpose(option.id)}
                style={({ pressed }) => [
                  styles.purposeRow,
                  {
                    borderBottomColor: palette.border,
                    borderBottomWidth:
                      index === editablePurposes.length - 1 ? 0 : undefined,
                  },
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <View
                  style={[
                    styles.purposeIcon,
                    {
                      backgroundColor: selected
                        ? palette.accentSoft
                        : palette.codeSurface,
                    },
                  ]}
                >
                  <Ionicons
                    color={selected ? palette.accent : palette.textSecondary}
                    name={option.icon}
                    size={18}
                  />
                </View>
                <Text style={[styles.optionTitle, { color: palette.text }]}>
                  {t(option.labelKey)}
                </Text>
                <Ionicons
                  color={selected ? palette.accent : palette.borderStrong}
                  name={selected ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.sheetAction}>
          <ActionButton
            onPress={() => setActiveSheet(null)}
            palette={palette}
            title={t("settings.model.complete")}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return localizedErrorMessage(error, fallback);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  fieldGroup: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: "600" },
  contextWindowHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  contextWindowValue: { fontSize: 14, fontWeight: "700" },
  contextWindowDetail: { fontSize: 12, lineHeight: 18 },
  valueRow: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  valueText: { flex: 1, fontSize: 15, lineHeight: 21 },
  error: { borderRadius: radii.sm, padding: spacing.sm },
  errorText: { fontSize: 13, lineHeight: 19 },
  searchInput: {
    borderRadius: radii.sm,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  sheetLoading: { minHeight: 160 },
  sheetMessage: { gap: spacing.md, paddingVertical: spacing.xl },
  sheetMessageText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  optionList: { marginTop: spacing.sm },
  optionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: spacing.xs,
  },
  purposeRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.xs,
  },
  purposeIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  optionTitle: { flex: 1, fontSize: 15 },
  sheetAction: { marginTop: spacing.lg },
});
