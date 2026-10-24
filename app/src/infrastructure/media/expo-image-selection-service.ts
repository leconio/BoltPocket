import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import {
  ImageAttachmentValidationError,
  normalizeSelectedImageAttachment,
  type AgentImageAttachment,
  type NormalizeImageAttachmentOptions,
} from "./image-attachment";

export type ImageSelectionSource = "library" | "camera";

export type ImageSelectionOptions = Pick<
  NormalizeImageAttachmentOptions,
  "maxBytes"
> & {
  /** Native image quality from 0 to 1. Defaults to 0.8. */
  quality?: number;
};

export type ImageSelectionErrorCode =
  | "camera-permission-denied"
  | "invalid-options"
  | "empty-result"
  | "picker-failed";

export class ImageSelectionError extends Error {
  readonly code: ImageSelectionErrorCode;

  constructor(
    code: ImageSelectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImageSelectionError";
    this.code = code;
  }
}

export interface ImageSelectionService {
  selectImage(
    source: ImageSelectionSource,
    options?: ImageSelectionOptions,
  ): Promise<AgentImageAttachment | null>;
}

async function requireCameraPermission(): Promise<void> {
  let permission = await ImagePicker.getCameraPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await ImagePicker.requestCameraPermissionsAsync();
  }
  if (!permission.granted) {
    throw new ImageSelectionError(
      "camera-permission-denied",
      "Camera permission was not granted.",
    );
  }
}

function getQuality(value: number | undefined): number {
  const quality = value ?? 0.8;
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new ImageSelectionError(
      "invalid-options",
      "Image quality must be between 0 and 1.",
    );
  }
  return quality;
}

async function selectImage(
  source: ImageSelectionSource,
  options: ImageSelectionOptions = {},
): Promise<AgentImageAttachment | null> {
  try {
    if (source === "camera") await requireCameraPermission();

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      allowsEditing: false,
      allowsMultipleSelection: false,
      base64: false,
      exif: false,
      mediaTypes: ["images"],
      quality: getQuality(options.quality),
      selectionLimit: 1,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) {
      throw new ImageSelectionError(
        "empty-result",
        "The image picker returned no image.",
      );
    }

    const selectedFile = new File(asset.uri);
    const attachment = normalizeSelectedImageAttachment(
      {
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize ?? selectedFile.size,
        width: asset.width,
        height: asset.height,
        name: asset.fileName,
      },
      {
        maxBytes: options.maxBytes,
        fallbackMimeType: source === "camera" ? "image/jpeg" : undefined,
      },
    );

    return { id: Crypto.randomUUID(), ...attachment };
  } catch (error) {
    if (
      error instanceof ImageSelectionError ||
      error instanceof ImageAttachmentValidationError
    ) {
      throw error;
    }
    throw new ImageSelectionError(
      "picker-failed",
      "The native image picker could not complete the request.",
      { cause: error },
    );
  }
}

export const expoImageSelectionService: ImageSelectionService = {
  selectImage,
};

export function pickImageFromLibrary(
  options?: ImageSelectionOptions,
): Promise<AgentImageAttachment | null> {
  return expoImageSelectionService.selectImage("library", options);
}

export function takePhoto(
  options?: ImageSelectionOptions,
): Promise<AgentImageAttachment | null> {
  return expoImageSelectionService.selectImage("camera", options);
}
