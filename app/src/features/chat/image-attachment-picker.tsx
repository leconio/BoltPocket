import Ionicons, {
  type IoniconsIconName,
} from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import type { ImageAttachment } from "@/domain/models";
import {
  expoImageSelectionService,
  ImageSelectionError,
  type ImageSelectionOptions,
  type ImageSelectionService,
  type ImageSelectionSource,
} from "@/infrastructure/media/expo-image-selection-service";
import {
  ImageAttachmentValidationError,
  toChatImageAttachment,
} from "@/infrastructure/media/image-attachment";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { radii, spacing, type AppPalette, useAppPalette } from "@/theme/tokens";

type ImageAttachmentPickerBaseProps = {
  attachments: readonly ImageAttachment[];
  onError?: (error: unknown) => void;
  disabled?: boolean;
  maxAttachments?: number;
  selectionOptions?: ImageSelectionOptions;
  service?: ImageSelectionService;
  palette?: AppPalette;
  showActions?: boolean;
};

type ImageAttachmentPickerChangeHandlers =
  | {
      onChange: (attachments: ImageAttachment[]) => void;
      onAttachmentAdd?: never;
      onAttachmentRemove?: never;
    }
  | {
      onChange?: never;
      onAttachmentAdd: (attachment: ImageAttachment) => void;
      onAttachmentRemove: (attachmentId: string) => void;
    };

export type ImageAttachmentPickerProps = ImageAttachmentPickerBaseProps &
  ImageAttachmentPickerChangeHandlers;

export function imageAttachmentErrorKey(error: unknown): MessageKey {
  if (error instanceof ImageAttachmentValidationError) {
    if (error.code === "attachment-too-large")
      return "chat.attachment.error.imageTooLarge";
    if (error.code === "unsupported-mime-type")
      return "chat.attachment.error.unsupportedImage";
    return "chat.attachment.error.invalidImage";
  }
  if (error instanceof ImageSelectionError) {
    if (error.code === "camera-permission-denied")
      return "chat.attachment.error.cameraPermission";
    return "chat.attachment.error.pickerUnavailable";
  }
  return "chat.attachment.error.addImageFailed";
}

export function ImageAttachmentPicker({
  attachments,
  onChange,
  onAttachmentAdd,
  onAttachmentRemove,
  onError,
  disabled = false,
  maxAttachments = 4,
  selectionOptions,
  service = expoImageSelectionService,
  palette: paletteOverride,
  showActions = true,
}: ImageAttachmentPickerProps) {
  const { t } = useI18n();
  const appPalette = useAppPalette();
  const palette = paletteOverride ?? appPalette;
  const [activeSource, setActiveSource] = useState<ImageSelectionSource | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const safeLimit = Number.isFinite(maxAttachments)
    ? Math.max(0, Math.floor(maxAttachments))
    : 4;
  const canAdd = !disabled && !activeSource && attachments.length < safeLimit;

  const addImage = async (source: ImageSelectionSource) => {
    if (!canAdd) return;
    setActiveSource(source);
    setErrorMessage("");
    try {
      const attachment = await service.selectImage(source, selectionOptions);
      if (attachment) {
        const chatAttachment = toChatImageAttachment(attachment);
        if (onChange) onChange([...attachments, chatAttachment]);
        else onAttachmentAdd(chatAttachment);
      }
    } catch (error) {
      setErrorMessage(t(imageAttachmentErrorKey(error)));
      onError?.(error);
    } finally {
      setActiveSource(null);
    }
  };

  const removeImage = (attachmentId: string) => {
    if (disabled || activeSource) return;
    if (onChange) {
      onChange(
        attachments.filter((attachment) => attachment.id !== attachmentId),
      );
    } else {
      onAttachmentRemove(attachmentId);
    }
  };

  return (
    <View style={styles.root}>
      {attachments.length ? (
        <ScrollView
          accessibilityLabel={t("chat.attachment.image.added")}
          contentContainerStyle={styles.previewList}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.previewScroller}
        >
          {attachments.map((attachment, index) => (
            <View
              key={attachment.id}
              style={[styles.preview, { borderColor: palette.borderStrong }]}
            >
              <Image
                accessibilityLabel={
                  attachment.name ??
                  t("chat.attachment.image.item", { index: index + 1 })
                }
                contentFit="cover"
                source={{ uri: attachment.uri }}
                style={StyleSheet.absoluteFill}
                transition={120}
              />
              {!disabled ? (
                <Pressable
                  accessibilityLabel={t("chat.attachment.image.remove", {
                    image:
                      attachment.name ??
                      t("chat.attachment.image.item", { index: index + 1 }),
                  })}
                  accessibilityRole="button"
                  disabled={Boolean(activeSource)}
                  hitSlop={8}
                  onPress={() => removeImage(attachment.id)}
                  style={({ pressed }) => [
                    styles.removeButton,
                    { backgroundColor: palette.overlay },
                    pressed && { opacity: 0.65 },
                  ]}
                >
                  <Ionicons color="#ffffff" name="close" size={15} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {showActions ? (
        <View style={styles.actions}>
          <PickerAction
            active={activeSource === "library"}
            disabled={!canAdd}
            icon="images-outline"
            label={t("chat.attachment.image.album")}
            onPress={() => void addImage("library")}
            palette={palette}
          />
          <PickerAction
            active={activeSource === "camera"}
            disabled={!canAdd}
            icon="camera-outline"
            label={t("chat.attachment.image.camera")}
            onPress={() => void addImage("camera")}
            palette={palette}
          />
          <Text style={[styles.limitText, { color: palette.textTertiary }]}>
            {attachments.length}/{safeLimit}
          </Text>
        </View>
      ) : null}

      {errorMessage ? (
        <Text
          accessibilityRole="alert"
          style={[styles.errorText, { color: palette.danger }]}
        >
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

function PickerAction({
  active,
  disabled,
  icon,
  label,
  onPress,
  palette,
}: {
  active: boolean;
  disabled: boolean;
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  palette: AppPalette;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityLabel={t("chat.attachment.image.addFrom", {
        source: label,
      })}
      accessibilityRole="button"
      accessibilityState={{ busy: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.codeSurface, borderColor: palette.border },
        pressed && { opacity: 0.65 },
        disabled && !active && { opacity: 0.4 },
      ]}
    >
      {active ? (
        <LoadingIndicator palette={palette} variant="inline" />
      ) : (
        <Ionicons color={palette.textSecondary} name={icon} size={17} />
      )}
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, maxWidth: "100%", minWidth: 0 },
  previewScroller: { flexGrow: 0, flexShrink: 0, height: 76 },
  previewList: { gap: spacing.xs, paddingVertical: 2 },
  preview: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    height: 72,
    overflow: "hidden",
    width: 72,
  },
  removeButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 26,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 4,
    width: 26,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  action: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionText: { fontSize: 13, fontWeight: "600" },
  limitText: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    marginLeft: "auto",
  },
  errorText: { fontSize: 12, lineHeight: 18 },
});
