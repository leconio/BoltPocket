import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { LoadingIndicator } from "@/components/loading-indicator";
import { IconButton, ScreenHeader } from "@/components/ui";
import type { AppState } from "@/domain/app-state";
import { isGeneratedVideoAttachment } from "@/domain/models";
import {
  findGeneratedMediaAttachment,
  mediaReadAccessRoot,
} from "@/features/chat/generated-media-preview";
import { useI18n } from "@/i18n/i18n-provider";
import { useApplicationActive } from "@/infrastructure/lifecycle/use-application-active";
import { useAppStateSelector } from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectMessagesByConversation(state: AppState) {
  return state.messagesByConversation;
}

export function GeneratedMediaPreviewScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { conversationId, messageId, attachmentId } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
    attachmentId?: string;
  }>();
  const messagesByConversation = useAppStateSelector(
    selectMessagesByConversation,
    Object.is,
  );
  const [failedVideoUri, setFailedVideoUri] = useState<string | null>(null);
  const [screenFocused, setScreenFocused] = useState(true);
  const appActive = useApplicationActive();
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );
  const attachment = useMemo(() => {
    if (
      typeof conversationId !== "string" ||
      typeof messageId !== "string" ||
      typeof attachmentId !== "string"
    ) {
      return null;
    }
    return findGeneratedMediaAttachment(
      messagesByConversation[conversationId] ?? [],
      messageId,
      attachmentId,
    );
  }, [attachmentId, conversationId, messageId, messagesByConversation]);
  const video =
    attachment && isGeneratedVideoAttachment(attachment) ? attachment : null;
  const videoError = Boolean(video && failedVideoUri === video.uri);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const shareFile = async () => {
    if (!attachment) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t("chat.media.openFailed"), t("chat.media.noPreviewApp"));
        return;
      }
      await Sharing.shareAsync(attachment.uri, {
        dialogTitle: attachment.name,
        mimeType: attachment.mimeType,
        ...(video ? { UTI: "public.mpeg-4" } : {}),
      });
    } catch {
      Alert.alert(t("chat.media.openFailed"), t("chat.media.fileMissing"));
    }
  };
  const share = () => {
    if (!attachment) return;
    Alert.alert(
      t("chat.media.shareDisclosureTitle"),
      t("chat.media.shareDisclosureDetail"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("chat.media.shareDisclosureAction"),
          onPress: () => void shareFile(),
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
        right={
          attachment ? (
            <View style={styles.headerActions}>
              <IconButton
                icon="flag-outline"
                label={t("chat.report.action")}
                onPress={() =>
                  router.push({
                    pathname: "/conversation/report" as never,
                    params: { attachmentId, conversationId, messageId },
                  })
                }
                palette={palette}
              />
              <IconButton
                icon="share-outline"
                label={t("chat.media.openOtherApp")}
                onPress={share}
                palette={palette}
              />
            </View>
          ) : null
        }
        title={
          attachment
            ? t(video ? "chat.media.videoPreview" : "chat.media.imagePreview")
            : t("chat.media.mediaPreview")
        }
      />
      {!attachment ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t("chat.media.fileNotFound")}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.content,
            { paddingBottom: Math.max(spacing.md, insets.bottom) },
          ]}
        >
          <View
            style={[
              styles.preview,
              {
                backgroundColor: palette.codeSurface,
                borderColor: palette.border,
              },
            ]}
          >
            {video ? (
              videoError ? (
                <View style={styles.empty}>
                  <Ionicons
                    color={palette.textSecondary}
                    name="videocam-off-outline"
                    size={36}
                  />
                  <Text
                    style={[styles.emptyText, { color: palette.textSecondary }]}
                  >
                    {t("chat.media.cannotPlayInApp")}
                  </Text>
                  <Pressable
                    accessibilityLabel={t("chat.media.openVideoOtherApp")}
                    accessibilityRole="button"
                    onPress={share}
                    style={({ pressed }) => [
                      styles.fallbackButton,
                      { borderColor: palette.borderStrong },
                      pressed && { opacity: 0.65 },
                    ]}
                  >
                    <Text style={{ color: palette.text }}>
                      {t("chat.media.openOtherApp")}
                    </Text>
                  </Pressable>
                </View>
              ) : screenFocused && appActive ? (
                <WebView
                  allowFileAccess
                  allowFileAccessFromFileURLs
                  allowUniversalAccessFromFileURLs={false}
                  allowingReadAccessToURL={mediaReadAccessRoot(video.uri)}
                  allowsFullscreenVideo
                  allowsInlineMediaPlayback
                  javaScriptEnabled={false}
                  mediaPlaybackRequiresUserAction
                  onError={() => setFailedVideoUri(video.uri)}
                  originWhitelist={["file://*"]}
                  renderLoading={() => (
                    <View style={styles.loading}>
                      <LoadingIndicator
                        palette={palette}
                        style={styles.loading}
                        variant="media"
                      />
                    </View>
                  )}
                  setSupportMultipleWindows={false}
                  source={{ uri: video.uri }}
                  startInLoadingState
                  style={styles.webView}
                />
              ) : (
                <View style={styles.empty}>
                  <Ionicons
                    color={palette.textSecondary}
                    name="videocam-outline"
                    size={36}
                  />
                </View>
              )
            ) : (
              <Image
                accessibilityLabel={t("chat.media.imagePreviewAccessibility")}
                accessibilityRole="image"
                contentFit="contain"
                source={{ uri: attachment.uri }}
                style={styles.image}
              />
            )}
          </View>
          <View style={styles.meta}>
            <Text style={[styles.aiLabel, { color: palette.accent }]}>
              {t("chat.content.aiGenerated")}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.model, { color: palette.text }]}
            >
              {attachment.modelId}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.detail, { color: palette.textSecondary }]}
            >
              {[
                attachment.providerName,
                video?.durationSeconds
                  ? t("chat.media.videoDuration", {
                      count: video.durationSeconds,
                    })
                  : null,
                fileSizeLabel(attachment.sizeBytes),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flex: 1, gap: spacing.sm, padding: spacing.md },
  preview: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    overflow: "hidden",
  },
  image: { height: "100%", width: "100%" },
  webView: { flex: 1 },
  loading: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyText: { fontSize: 14, lineHeight: 20 },
  fallbackButton: {
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  meta: { minHeight: 48, justifyContent: "center" },
  aiLabel: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  model: { fontSize: 14, fontWeight: "600" },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  headerActions: { alignItems: "center", flexDirection: "row" },
});
