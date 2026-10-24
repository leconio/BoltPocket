import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { BottomSheet } from "@/components/ui";
import type { AppState } from "@/domain/app-state";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  loadModelRegistry,
  resolvePublicModelProfile,
  type ModelProfile,
  type ModelRegistrySummary,
} from "@/infrastructure/model-config";
import {
  shallowEqualAppStateSelection,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

function createConversationModelSelector(conversationId: string) {
  return (state: AppState) => ({
    locked:
      Object.hasOwn(state.activeRunsByConversation, conversationId) ||
      state.autoApplyingProposalIds.some(
        (proposalId) =>
          state.proposals[proposalId]?.conversationId === conversationId,
      ),
    pinnedProfileId: state.conversationModelProfileIds[conversationId],
  });
}

export function ConversationModelControl({
  conversationId,
}: {
  conversationId: string;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const { dispatch } = useAppActions();
  const selector = useMemo(
    () => createConversationModelSelector(conversationId),
    [conversationId],
  );
  const { locked, pinnedProfileId } = useAppStateSelector(
    selector,
    shallowEqualAppStateSelection,
  );
  const [registry, setRegistry] = useState<ModelRegistrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const reload = useCallback(() => {
    let focused = true;
    setLoading(true);
    setLoadError(null);
    void loadModelRegistry()
      .then((value) => {
        if (focused) setRegistry(value);
      })
      .catch((error: unknown) => {
        if (focused) {
          setRegistry(null);
          setLoadError(
            localizedErrorMessage(error, t("chat.common.tryAgainLater")),
          );
        }
      })
      .finally(() => {
        if (focused) setLoading(false);
      });
    return () => {
      focused = false;
    };
  }, [t]);

  useFocusEffect(reload);

  const activeRoute = useMemo(() => {
    if (!registry) return null;
    try {
      return resolvePublicModelProfile(
        registry,
        pinnedProfileId ?? registry.routes.main,
      );
    } catch {
      return resolvePublicModelProfile(registry, registry.routes.main);
    }
  }, [pinnedProfileId, registry]);
  const eligibleModels = useMemo(
    () =>
      registry?.models.filter((profile) => profile.purposes.includes("chat")) ??
      [],
    [registry],
  );

  useEffect(() => {
    if (
      registry &&
      pinnedProfileId &&
      !registry.models.some((profile) => profile.id === pinnedProfileId)
    ) {
      dispatch({
        type: "conversation/set-model",
        conversationId,
        modelProfileId: null,
      });
    }
  }, [conversationId, dispatch, pinnedProfileId, registry]);

  const select = (profile: ModelProfile) => {
    if (locked || !registry) return;
    dispatch({
      type: "conversation/set-model",
      conversationId,
      modelProfileId: profile.id === registry.routes.main ? null : profile.id,
    });
    setVisible(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={
          activeRoute
            ? t("chat.model.currentAccessibility", {
                model: activeRoute.profile.name,
                provider: activeRoute.provider.name,
              })
            : t("chat.model.choose")
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: locked || loading, expanded: visible }}
        disabled={locked || loading}
        onPress={() => {
          if (!registry) {
            Alert.alert(
              loadError ? t("chat.model.couldNotLoad") : t("chat.model.none"),
              loadError ?? t("chat.model.openSettingsFirst"),
            );
            return;
          }
          setVisible(true);
        }}
        style={({ pressed }) => [
          styles.control,
          { borderColor: palette.border },
          pressed && { backgroundColor: palette.accentSoft },
          (locked || loading) && { opacity: 0.42 },
        ]}
      >
        {loading ? (
          <LoadingIndicator palette={palette} variant="inline" />
        ) : (
          <Ionicons
            color={palette.textSecondary}
            name="hardware-chip-outline"
            size={15}
          />
        )}
        <Text
          numberOfLines={1}
          style={[styles.controlText, { color: palette.textSecondary }]}
        >
          {activeRoute?.profile.name ?? t("chat.model.fallbackName")}
        </Text>
        <Ionicons color={palette.textTertiary} name="chevron-up" size={13} />
      </Pressable>

      <BottomSheet
        onClose={() => setVisible(false)}
        palette={palette}
        title={t("chat.model.current")}
        visible={visible}
      >
        <View accessibilityRole="radiogroup" style={styles.list}>
          {registry?.providers.map((provider) => {
            const models = eligibleModels.filter(
              (profile) => profile.providerId === provider.id,
            );
            if (models.length === 0) return null;
            return (
              <View key={provider.id} style={styles.group}>
                <Text
                  style={[styles.providerName, { color: palette.textTertiary }]}
                >
                  {provider.name}
                </Text>
                {models.map((profile) => {
                  const followsDefault =
                    !pinnedProfileId && profile.id === registry.routes.main;
                  const selected =
                    followsDefault || pinnedProfileId === profile.id;
                  return (
                    <Pressable
                      accessibilityLabel={t("chat.model.use", {
                        model: profile.name,
                        provider: provider.name,
                      })}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: locked,
                      }}
                      disabled={locked}
                      key={profile.id}
                      onPress={() => select(profile)}
                      style={({ pressed }) => [
                        styles.option,
                        { borderBottomColor: palette.border },
                        selected && { backgroundColor: palette.accentSoft },
                        pressed && { backgroundColor: palette.codeSurface },
                      ]}
                    >
                      <View style={styles.optionCopy}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.optionTitle,
                            { color: selected ? palette.accent : palette.text },
                          ]}
                        >
                          {profile.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.capabilities,
                            { color: palette.textTertiary },
                          ]}
                        >
                          {[
                            t("chat.model.capability.tools"),
                            profile.capabilities.vision
                              ? t("chat.model.capability.vision")
                              : null,
                            profile.capabilities.reasoning
                              ? t("chat.model.capability.reasoning")
                              : null,
                            profile.id === registry.routes.main
                              ? t("chat.model.capability.default")
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons
                          color={palette.accent}
                          name="checkmark"
                          size={20}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: 176,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  controlText: { flexShrink: 1, fontSize: 12.5, fontWeight: "600" },
  list: { gap: spacing.sm },
  group: { gap: spacing.xxs },
  providerName: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  option: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionCopy: { flex: 1, gap: 3, minWidth: 0 },
  optionTitle: { fontSize: 14, fontWeight: "600" },
  capabilities: { fontSize: 11.5 },
});
