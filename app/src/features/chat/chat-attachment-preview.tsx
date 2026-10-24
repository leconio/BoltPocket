import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ChatAttachment } from "@/domain/models";
import {
  isGeneratedImageAttachment,
  isGeneratedVideoAttachment,
  isImageAttachment,
  isTextFileAttachment,
} from "@/domain/models";
import { ImageAttachmentPicker } from "@/features/chat/image-attachment-picker";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatAttachmentPreview({
  attachments,
  disabled = false,
  onOpenGeneratedMedia,
  onRemove,
  palette,
}: {
  attachments: readonly ChatAttachment[];
  disabled?: boolean;
  onOpenGeneratedMedia?: (attachmentId: string) => void;
  onRemove: (attachmentId: string) => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  const images = attachments.filter(isImageAttachment);
  const generatedImages = attachments.filter(isGeneratedImageAttachment);
  const generatedVideos = attachments.filter(isGeneratedVideoAttachment);
  const files = attachments.filter(isTextFileAttachment);
  return (
    <View style={styles.root}>
      {images.length ? (
        <ImageAttachmentPicker
          attachments={images}
          disabled={disabled}
          onAttachmentAdd={() => undefined}
          onAttachmentRemove={onRemove}
          palette={palette}
          showActions={false}
        />
      ) : null}
      {generatedImages.length ? (
        <ScrollView
          accessibilityLabel={t("chat.attachment.preview.generatedImages")}
          contentContainerStyle={styles.generatedImages}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {generatedImages.map((image) => (
            <Pressable
              accessibilityHint={t("chat.attachment.preview.openImage")}
              accessibilityLabel={t(
                "chat.attachment.preview.generatedImageBy",
                { model: image.modelId, provider: image.providerName },
              )}
              accessibilityRole="button"
              key={image.id}
              onPress={() => onOpenGeneratedMedia?.(image.id)}
              style={({ pressed }) => [
                styles.generatedImageCard,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                },
                pressed && { opacity: 0.68 },
              ]}
            >
              <Image
                contentFit="cover"
                source={{ uri: image.uri }}
                style={styles.generatedImage}
              />
              <View style={styles.previewIcon}>
                <Ionicons color="#fff" name="expand-outline" size={15} />
              </View>
              <View style={styles.generatedImageMeta}>
                <Ionicons
                  color={palette.textSecondary}
                  name="sparkles-outline"
                  size={14}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.generatedImageLabel,
                    { color: palette.textSecondary },
                  ]}
                >
                  {image.modelId}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {generatedVideos.length ? (
        <ScrollView
          accessibilityLabel={t("chat.attachment.preview.generatedVideos")}
          contentContainerStyle={styles.generatedVideos}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {generatedVideos.map((video) => (
            <Pressable
              accessibilityHint={t("chat.attachment.preview.openVideo")}
              accessibilityLabel={t(
                "chat.attachment.preview.generatedVideoBy",
                { model: video.modelId, provider: video.providerName },
              )}
              accessibilityRole="button"
              key={video.id}
              onPress={() => onOpenGeneratedMedia?.(video.id)}
              style={({ pressed }) => [
                styles.generatedVideoCard,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                },
                pressed && { opacity: 0.68 },
              ]}
            >
              <View
                style={[
                  styles.generatedVideoIcon,
                  { backgroundColor: palette.accentSoft },
                ]}
              >
                <Ionicons color={palette.accent} name="play" size={24} />
              </View>
              <View style={styles.generatedVideoCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.videoTitle, { color: palette.text }]}
                >
                  {t("chat.attachment.preview.generatedVideo")}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.videoMeta, { color: palette.textSecondary }]}
                >
                  {[
                    video.durationSeconds
                      ? t("chat.attachment.preview.duration", {
                          count: video.durationSeconds,
                        })
                      : null,
                    fileSizeLabel(video.sizeBytes),
                    video.modelId,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Ionicons
                color={palette.textTertiary}
                name="chevron-forward"
                size={18}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {files.length ? (
        <ScrollView
          accessibilityLabel={t("chat.attachment.preview.files")}
          contentContainerStyle={styles.files}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {files.map((file) => (
            <View
              key={file.id}
              style={[
                styles.file,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Ionicons
                color={palette.textSecondary}
                name="document-text-outline"
                size={20}
              />
              <View style={styles.fileCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.fileName, { color: palette.text }]}
                >
                  {file.name}
                </Text>
                <Text
                  style={[styles.fileSize, { color: palette.textTertiary }]}
                >
                  {fileSizeLabel(file.sizeBytes)}
                </Text>
              </View>
              {!disabled ? (
                <Pressable
                  accessibilityLabel={t("chat.attachment.preview.removeFile", {
                    name: file.name,
                  })}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => onRemove(file.id)}
                  style={({ pressed }) => [
                    styles.remove,
                    pressed && { opacity: 0.5 },
                  ]}
                >
                  <Ionicons
                    color={palette.textSecondary}
                    name="close"
                    size={17}
                  />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, maxWidth: "100%", minWidth: 0 },
  files: { gap: spacing.xs },
  generatedImages: { gap: spacing.xs },
  generatedVideos: { gap: spacing.xs },
  generatedImageCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    width: 248,
  },
  previewIcon: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.56)",
    borderRadius: radii.pill,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: 28,
  },
  generatedImage: { aspectRatio: 1, width: "100%" },
  generatedImageMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  generatedImageLabel: { flex: 1, fontSize: 12 },
  generatedVideoCard: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 78,
    padding: spacing.sm,
    width: 300,
  },
  generatedVideoIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  generatedVideoCopy: { flex: 1, minWidth: 0 },
  videoTitle: { fontSize: 14, fontWeight: "600" },
  videoMeta: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  file: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 58,
    maxWidth: 230,
    minWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 13, fontWeight: "600" },
  fileSize: { fontSize: 11, marginTop: 2 },
  remove: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});
