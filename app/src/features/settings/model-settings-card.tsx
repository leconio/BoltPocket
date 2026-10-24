import Ionicons from "@react-native-vector-icons/ionicons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { BottomSheet } from "@/components/ui";
import { formatCompactTokenCount } from "@/application/conversation-context-usage";
import {
  ModelSettingsAction as ActionButton,
  ModelSettingsField as Field,
  modelSettingsStyles as styles,
} from "@/features/settings/model-settings-components";
import { purposeSummary } from "@/features/settings/model-settings-draft";
import { useModelSettingsSession } from "@/features/settings/model-settings-session";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  CUSTOM_MODEL_PROVIDER_PRESET_ID,
  MODEL_API_KEY_MASK,
  MODEL_PROVIDER_PRESETS,
  modelProviderPresetById,
  type ModelProviderPresetNote,
} from "@/infrastructure/model-config";
import {
  CodexDeviceOAuthError,
  type CodexDeviceCodeInfo,
} from "@/infrastructure/model-config/codex-device-oauth";
import { OPENAI_CODEX_PROVIDER_KIND } from "@/infrastructure/model-config/codex-provider-constants";
import { useAppPalette } from "@/theme/tokens";

type Feedback = { kind: "success" | "error"; message: string } | null;
type CodexLoginPrompt = CodexDeviceCodeInfo & { providerId: string };

const PRESET_NOTE_MESSAGE_KEYS = {
  "openai-compatible-models-only": "settings.model.presetOpenCodeGoNote",
  "model-or-endpoint-id": "settings.model.presetArkModelNote",
  "glm-standard-billing": "settings.model.presetGlmStandardNote",
  "glm-coding-plan-billing": "settings.model.presetGlmCodingPlanNote",
  "volcengine-coding-plan-billing": "settings.model.presetArkCodingPlanNote",
  "volcengine-agent-plan-key": "settings.model.presetArkAgentPlanNote",
} as const satisfies Record<ModelProviderPresetNote, MessageKey>;

const CAUTION_PRESET_NOTES = new Set<ModelProviderPresetNote>([
  "glm-standard-billing",
  "glm-coding-plan-billing",
  "volcengine-coding-plan-billing",
  "volcengine-agent-plan-key",
]);

export function ModelSettingsCard() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const session = useModelSettingsSession();
  const { load } = session;
  const [selectedProviderId, setSelectedProviderId] =
    useState("provider-default");
  const [saving, setSaving] = useState(false);
  const [providerSheetVisible, setProviderSheetVisible] = useState(false);
  const [protocolSheetVisible, setProtocolSheetVisible] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [codexLoginPrompt, setCodexLoginPrompt] =
    useState<CodexLoginPrompt | null>(null);
  const [authorizingCodex, setAuthorizingCodex] = useState(false);
  const codexAuthorizationAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void load().catch((error: unknown) => {
      setFeedback({
        kind: "error",
        message: errorMessage(error, t("settings.model.settingFailed")),
      });
    });
  }, [load, t]);

  useEffect(
    () => () => {
      codexAuthorizationAbort.current?.abort();
      if (codexAuthorizationAbort.current) {
        void WebBrowser.dismissBrowser().catch(() => undefined);
      }
    },
    [],
  );

  const selectedProvider =
    session.providers.find((provider) => provider.id === selectedProviderId) ??
    session.providers[0];
  const models = selectedProvider
    ? session.models.filter((model) => model.providerId === selectedProvider.id)
    : [];
  const selectedPreset = selectedProvider
    ? modelProviderPresetById(selectedProvider.presetId)
    : undefined;
  const selectedPresetNote =
    selectedPreset && "note" in selectedPreset
      ? selectedPreset.note
      : undefined;
  const selectedPresetNeedsCaution = selectedPresetNote
    ? CAUTION_PRESET_NOTES.has(selectedPresetNote)
    : false;
  const customProvider =
    selectedProvider?.presetId === CUSTOM_MODEL_PROVIDER_PRESET_ID;
  const codexProvider = selectedProvider?.kind === OPENAI_CODEX_PROVIDER_KIND;

  const saveProvider = async () => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await session.saveProviders();
      setFeedback({ kind: "success", message: t("settings.model.saved") });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: errorMessage(error, t("settings.model.settingFailed")),
      });
    } finally {
      setSaving(false);
    }
  };

  const openCodexAuthorizationPage = async (
    information: CodexDeviceCodeInfo,
  ) => {
    await Clipboard.setStringAsync(information.userCode);
    void WebBrowser.openBrowserAsync(information.verificationUri).catch(
      (error: unknown) =>
        setFeedback({
          kind: "error",
          message: errorMessage(error, t("settings.model.settingFailed")),
        }),
    );
  };

  const authorizeCodex = async () => {
    if (!selectedProvider || authorizingCodex) return;
    codexAuthorizationAbort.current?.abort();
    const controller = new AbortController();
    codexAuthorizationAbort.current = controller;
    setAuthorizingCodex(true);
    setFeedback(null);
    try {
      await session.authorizeCodex(
        selectedProvider.id,
        async (information) => {
          setCodexLoginPrompt({
            ...information,
            providerId: selectedProvider.id,
          });
          await openCodexAuthorizationPage(information);
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setFeedback({
          kind: "success",
          message: t("settings.model.codex.connected"),
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFeedback({
          kind: "error",
          message: codexErrorMessage(error, t),
        });
      }
    } finally {
      if (codexAuthorizationAbort.current === controller) {
        codexAuthorizationAbort.current = null;
        setAuthorizingCodex(false);
        setCodexLoginPrompt(null);
        void WebBrowser.dismissBrowser().catch(() => undefined);
      }
    }
  };

  const cancelCodexAuthorization = () => {
    codexAuthorizationAbort.current?.abort();
    setCodexLoginPrompt(null);
    void WebBrowser.dismissBrowser().catch(() => undefined);
  };

  const confirmCodexLogout = () => {
    if (!selectedProvider || authorizingCodex) return;
    Alert.alert(
      t("settings.model.codex.logoutTitle"),
      t("settings.model.codex.logoutConfirm"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.model.codex.logout"),
          style: "destructive",
          onPress: () => {
            setAuthorizingCodex(true);
            setFeedback(null);
            void session
              .logoutCodex(selectedProvider.id)
              .catch((error: unknown) =>
                setFeedback({
                  kind: "error",
                  message: errorMessage(
                    error,
                    t("settings.model.settingFailed"),
                  ),
                }),
              )
              .finally(() => setAuthorizingCodex(false));
          },
        },
      ],
    );
  };

  const selectPreset = async (
    presetId: Parameters<typeof session.selectProviderPreset>[1],
  ) => {
    if (authorizingCodex) return;
    setProviderSheetVisible(false);
    setFeedback(null);
    try {
      await session.selectProviderPreset(selectedProvider.id, presetId);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: errorMessage(error, t("settings.model.settingFailed")),
      });
    }
  };

  const confirmRemoveProvider = () => {
    if (!selectedProvider || saving) return;
    Alert.alert(
      t("settings.model.deleteProviderTitle"),
      t("settings.model.deleteProviderConfirm", {
        provider: selectedProvider.name,
      }),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.model.delete"),
          style: "destructive",
          onPress: () => {
            setSaving(true);
            setFeedback(null);
            void session
              .removeProvider(selectedProvider.id)
              .catch((error: unknown) =>
                setFeedback({
                  kind: "error",
                  message: errorMessage(
                    error,
                    t("settings.model.settingFailed"),
                  ),
                }),
              )
              .finally(() => setSaving(false));
          },
        },
      ],
    );
  };

  if (session.loading && !session.loaded) {
    return (
      <LoadingIndicator
        accessibilityLabel={t("settings.model.reading")}
        palette={palette}
        style={styles.loading}
        variant="content"
      />
    );
  }

  if (!selectedProvider) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.providerTabs}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {session.providers.map((provider) => {
          const selected = provider.id === selectedProvider.id;
          return (
            <Pressable
              accessibilityLabel={t("settings.model.providerAccessibility", {
                provider: provider.name,
              })}
              accessibilityRole="button"
              disabled={authorizingCodex}
              key={provider.id}
              onPress={() => {
                setSelectedProviderId(provider.id);
                setFeedback(null);
              }}
              style={({ pressed }) => [
                styles.providerTab,
                {
                  backgroundColor: selected
                    ? palette.accentSoft
                    : palette.surface,
                  borderColor: selected ? palette.accent : palette.border,
                },
                pressed && { opacity: 0.65 },
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ color: selected ? palette.accent : palette.text }}
              >
                {provider.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityLabel={t("settings.model.addProvider")}
          accessibilityRole="button"
          disabled={
            saving || authorizingCodex || session.providers.length >= 12
          }
          onPress={() => setSelectedProviderId(session.addProvider())}
          style={({ pressed }) => [
            styles.addProvider,
            { borderColor: palette.border },
            pressed && { backgroundColor: palette.accentSoft },
          ]}
        >
          <Ionicons color={palette.textSecondary} name="add" size={18} />
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {t("settings.model.provider")}
          </Text>
          <Pressable
            accessibilityLabel={t("settings.model.deleteProvider")}
            accessibilityRole="button"
            disabled={saving || authorizingCodex}
            hitSlop={8}
            onPress={confirmRemoveProvider}
          >
            <Ionicons color={palette.danger} name="trash-outline" size={18} />
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>
            {t("settings.model.providerType")}
          </Text>
          <Pressable
            accessibilityLabel={t("settings.model.selectProvider")}
            accessibilityRole="button"
            disabled={authorizingCodex}
            onPress={() => setProviderSheetVisible(true)}
            style={({ pressed }) => [
              styles.protocolRow,
              {
                backgroundColor: palette.background,
                borderColor: palette.border,
              },
              pressed && { opacity: 0.65 },
            ]}
          >
            <Text style={[styles.protocolValue, { color: palette.text }]}>
              {selectedPreset?.name ?? t("settings.model.customProvider")}
            </Text>
            <Ionicons
              color={palette.textTertiary}
              name="chevron-forward"
              size={18}
            />
          </Pressable>
        </View>
        {customProvider ? (
          <>
            <Field
              label={t("settings.model.providerName")}
              onChangeText={(name) =>
                session.updateProvider(selectedProvider.id, { name })
              }
              palette={palette}
              placeholder={t("settings.model.provider")}
              value={selectedProvider.name}
            />
            <Field
              keyboardType="url"
              label={t("settings.model.baseUrl")}
              onChangeText={(baseUrl) =>
                session.updateProvider(selectedProvider.id, { baseUrl })
              }
              palette={palette}
              placeholder="https://example.com/v1"
              value={selectedProvider.baseUrl}
            />
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.text }]}>
                {t("settings.model.interfaceProtocol")}
              </Text>
              <Pressable
                accessibilityLabel={t("settings.model.selectProtocol")}
                accessibilityRole="button"
                onPress={() => setProtocolSheetVisible(true)}
                style={({ pressed }) => [
                  styles.protocolRow,
                  {
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  },
                  pressed && { opacity: 0.65 },
                ]}
              >
                <Text style={[styles.protocolValue, { color: palette.text }]}>
                  {t(
                    selectedProvider.protocol === "responses"
                      ? "settings.model.protocol.responses"
                      : "settings.model.protocol.chatCompletions",
                  )}
                </Text>
                <Ionicons
                  color={palette.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            </View>
          </>
        ) : !codexProvider ? (
          <View
            style={[
              styles.providerHint,
              {
                backgroundColor: selectedPresetNeedsCaution
                  ? palette.dangerSoft
                  : palette.codeSurface,
              },
            ]}
          >
            <Ionicons
              color={
                selectedPresetNeedsCaution ? palette.danger : palette.accent
              }
              name={
                selectedPresetNeedsCaution
                  ? "warning-outline"
                  : "checkmark-circle-outline"
              }
              size={17}
            />
            <View style={styles.providerHintCopy}>
              <Text
                style={[
                  styles.providerHintText,
                  { color: palette.textSecondary },
                ]}
              >
                {t("settings.model.presetManaged")}
              </Text>
              {selectedPresetNote ? (
                <Text
                  style={[
                    styles.providerHintDetail,
                    {
                      color: selectedPresetNeedsCaution
                        ? palette.danger
                        : palette.textTertiary,
                    },
                  ]}
                >
                  {t(PRESET_NOTE_MESSAGE_KEYS[selectedPresetNote])}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {codexProvider ? (
          <>
            {selectedProvider.codexAuthorization ? (
              <View
                style={[
                  styles.providerHint,
                  { backgroundColor: palette.successSoft },
                ]}
              >
                <Ionicons
                  color={palette.success}
                  name="checkmark-circle"
                  size={18}
                />
                <View style={styles.providerHintCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.providerHintText, { color: palette.text }]}
                  >
                    {selectedProvider.codexAuthorization.email ??
                      t("settings.model.codex.account", {
                        account:
                          selectedProvider.codexAuthorization.accountId.slice(
                            -8,
                          ),
                      })}
                  </Text>
                  <Text
                    style={[
                      styles.providerHintDetail,
                      { color: palette.textSecondary },
                    ]}
                  >
                    {selectedProvider.codexAuthorization.plan
                      ? t("settings.model.codex.plan", {
                          plan: selectedProvider.codexAuthorization.plan,
                        })
                      : t("settings.model.codex.localOnly")}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={t("settings.model.codex.logout")}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={confirmCodexLogout}
                  style={({ pressed }) => [pressed && { opacity: 0.55 }]}
                >
                  <Text style={{ color: palette.danger, fontSize: 13 }}>
                    {t("settings.model.codex.logout")}
                  </Text>
                </Pressable>
              </View>
            ) : codexLoginPrompt?.providerId === selectedProvider.id ? (
              <Pressable
                accessibilityLabel={t("settings.model.codex.openAuthorization")}
                accessibilityRole="button"
                onPress={() =>
                  void openCodexAuthorizationPage(codexLoginPrompt)
                }
                style={[
                  styles.codexCodeCard,
                  { backgroundColor: palette.accentSoft },
                ]}
              >
                <Text
                  selectable
                  style={[styles.codexCode, { color: palette.accent }]}
                >
                  {codexLoginPrompt.userCode}
                </Text>
                <Text
                  style={[
                    styles.providerHintDetail,
                    { color: palette.textSecondary },
                  ]}
                >
                  {t("settings.model.codex.codeCopied")}
                </Text>
              </Pressable>
            ) : (
              <ActionButton
                loading={authorizingCodex}
                loadingTitle={t("settings.model.codex.waiting")}
                onPress={() => void authorizeCodex()}
                palette={palette}
                title={t("settings.model.codex.login")}
              />
            )}
            {codexLoginPrompt?.providerId === selectedProvider.id ? (
              <ActionButton
                onPress={cancelCodexAuthorization}
                palette={palette}
                secondary
                title={t("settings.common.cancel")}
              />
            ) : null}
          </>
        ) : (
          <>
            <Field
              autoComplete="one-time-code"
              importantForAutofill="no"
              label={t("settings.model.apiKey")}
              onChangeText={(apiKeyDraft) =>
                session.updateProvider(selectedProvider.id, { apiKeyDraft })
              }
              palette={palette}
              placeholder={
                selectedProvider.hasStoredApiKey &&
                !selectedProvider.apiKeyNeedsReplacement
                  ? t("settings.model.keepApiKey")
                  : t("settings.model.apiKeyPlaceholder")
              }
              secureTextEntry
              textContentType="oneTimeCode"
              value={selectedProvider.apiKeyDraft}
            />
            {selectedProvider.hasStoredApiKey &&
            !selectedProvider.apiKeyNeedsReplacement &&
            !selectedProvider.apiKeyDraft ? (
              <View style={styles.savedKeyRow}>
                <Ionicons color={palette.accent} name="lock-closed" size={13} />
                <Text
                  style={[styles.maskedKey, { color: palette.textSecondary }]}
                >
                  {t("settings.model.apiKeySaved", {
                    mask: MODEL_API_KEY_MASK,
                  })}
                </Text>
              </View>
            ) : null}
            {selectedProvider.apiKeyNeedsReplacement &&
            !selectedProvider.apiKeyDraft ? (
              <View style={styles.savedKeyRow}>
                <Ionicons color={palette.accent} name="key-outline" size={13} />
                <Text
                  style={[styles.maskedKey, { color: palette.textSecondary }]}
                >
                  {t("settings.model.apiKeyRequiredAfterProviderChange")}
                </Text>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>
            {t("settings.model.modelsAdded")}
          </Text>
          <Text style={[styles.sectionTitle, { color: palette.textTertiary }]}>
            {models.length}
          </Text>
        </View>

        {models.length > 0 ? (
          <View style={[styles.modelList, { borderColor: palette.border }]}>
            {models.map((model, index) => (
              <Pressable
                accessibilityLabel={t("settings.model.editAccessibility", {
                  model: model.modelId,
                })}
                accessibilityRole="button"
                key={model.id}
                onPress={() =>
                  router.push({
                    pathname: "/settings/model-add" as never,
                    params: {
                      providerId: selectedProvider.id,
                      modelProfileId: model.id,
                    },
                  })
                }
                style={({ pressed }) => [
                  styles.modelRow,
                  {
                    borderBottomColor: palette.border,
                    borderBottomWidth:
                      index === models.length - 1 ? 0 : undefined,
                  },
                  pressed && { backgroundColor: palette.codeSurface },
                ]}
              >
                <View style={styles.modelCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.modelName, { color: palette.text }]}
                  >
                    {model.modelId}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.modelPurposes,
                      { color: palette.textSecondary },
                    ]}
                  >
                    {purposeSummary(model.purposes, t)} ·{" "}
                    {formatCompactTokenCount(model.contextWindow)}
                  </Text>
                </View>
                <Ionicons
                  color={palette.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.textTertiary }]}>
              {t("settings.model.noModels")}
            </Text>
          </View>
        )}

        <ActionButton
          disabled={saving || authorizingCodex}
          onPress={() =>
            router.push({
              pathname: "/settings/model-add" as never,
              params: { providerId: selectedProvider.id },
            })
          }
          palette={palette}
          secondary
          title={t("settings.model.addModel")}
        />
        {models.length > 0 ? (
          <ActionButton
            disabled={saving || authorizingCodex}
            loading={saving}
            onPress={() => void saveProvider()}
            palette={palette}
            title={t("settings.model.saveProvider")}
          />
        ) : null}

        {feedback ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.feedback,
              {
                backgroundColor:
                  feedback.kind === "success"
                    ? palette.successSoft
                    : palette.dangerSoft,
              },
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                {
                  color:
                    feedback.kind === "success"
                      ? palette.success
                      : palette.danger,
                },
              ]}
            >
              {feedback.message}
            </Text>
          </View>
        ) : null}
      </View>
      <BottomSheet
        onClose={() => setProviderSheetVisible(false)}
        palette={palette}
        title={t("settings.model.selectProvider")}
        visible={providerSheetVisible}
      >
        {MODEL_PROVIDER_PRESETS.map((preset) => {
          const selected = selectedProvider.presetId === preset.id;
          return (
            <Pressable
              accessibilityLabel={t("settings.model.useProvider", {
                provider: preset.name,
              })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={preset.id}
              onPress={() => void selectPreset(preset.id)}
              style={({ pressed }) => [
                styles.protocolOption,
                { borderBottomColor: palette.border },
                pressed && { backgroundColor: palette.codeSurface },
              ]}
            >
              <View style={styles.providerOptionCopy}>
                <Text style={[styles.protocolValue, { color: palette.text }]}>
                  {preset.name}
                </Text>
                <Text
                  style={[
                    styles.providerOptionDetail,
                    { color: palette.textSecondary },
                  ]}
                >
                  {t(
                    preset.kind === OPENAI_CODEX_PROVIDER_KIND
                      ? "settings.model.codex.localOnly"
                      : preset.protocol === "responses"
                        ? "settings.model.protocol.responses"
                        : "settings.model.protocol.chatCompletions",
                  )}
                </Text>
              </View>
              <Ionicons
                color={selected ? palette.accent : palette.borderStrong}
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={22}
              />
            </Pressable>
          );
        })}
        <Pressable
          accessibilityLabel={t("settings.model.useProvider", {
            provider: t("settings.model.customProvider"),
          })}
          accessibilityRole="radio"
          accessibilityState={{ selected: customProvider }}
          onPress={() => void selectPreset(CUSTOM_MODEL_PROVIDER_PRESET_ID)}
          style={({ pressed }) => [
            styles.protocolOption,
            { borderBottomWidth: 0 },
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <View style={styles.providerOptionCopy}>
            <Text style={[styles.protocolValue, { color: palette.text }]}>
              {t("settings.model.customProvider")}
            </Text>
            <Text
              style={[
                styles.providerOptionDetail,
                { color: palette.textSecondary },
              ]}
            >
              {t("settings.model.customProviderDetail")}
            </Text>
          </View>
          <Ionicons
            color={customProvider ? palette.accent : palette.borderStrong}
            name={customProvider ? "checkmark-circle" : "ellipse-outline"}
            size={22}
          />
        </Pressable>
      </BottomSheet>
      <BottomSheet
        onClose={() => setProtocolSheetVisible(false)}
        palette={palette}
        title={t("settings.model.interfaceProtocol")}
        visible={protocolSheetVisible}
      >
        {(
          [
            [
              "chat-completions",
              "settings.model.protocol.chatCompletions" satisfies MessageKey,
            ],
            [
              "responses",
              "settings.model.protocol.responses" satisfies MessageKey,
            ],
          ] as const
        ).map(([protocol, labelKey], index) => {
          const selected = selectedProvider.protocol === protocol;
          const label = t(labelKey);
          return (
            <Pressable
              accessibilityLabel={t("settings.model.useProtocol", {
                protocol: label,
              })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={protocol}
              onPress={() => {
                session.updateProvider(selectedProvider.id, { protocol });
                setProtocolSheetVisible(false);
              }}
              style={({ pressed }) => [
                styles.protocolOption,
                {
                  borderBottomColor: palette.border,
                  borderBottomWidth: index === 1 ? 0 : undefined,
                },
                pressed && { backgroundColor: palette.codeSurface },
              ]}
            >
              <Text style={[styles.protocolValue, { color: palette.text }]}>
                {label}
              </Text>
              <Ionicons
                color={selected ? palette.accent : palette.borderStrong}
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={22}
              />
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return localizedErrorMessage(error, fallback);
}

function codexErrorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (!(error instanceof CodexDeviceOAuthError)) {
    return errorMessage(error, t("settings.model.codex.failed"));
  }
  if (error.code === "not-enabled") {
    return t("settings.model.codex.error.notEnabled");
  }
  if (error.code === "expired") {
    return t("settings.model.codex.error.expired");
  }
  if (error.code === "secure-storage") {
    return t("settings.model.codex.error.secureStorage");
  }
  return t("settings.model.codex.error.network");
}
