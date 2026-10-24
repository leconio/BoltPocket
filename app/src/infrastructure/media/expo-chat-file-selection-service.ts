import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";

import {
  ChatFileAttachmentError,
  createChatTextFileAttachment,
  MAX_CHAT_TEXT_FILE_BYTES,
} from "@/application/chat-file-attachment";
import type { TextFileAttachment } from "@/domain/models";

export interface ChatFileSelectionService {
  selectTextFile(): Promise<TextFileAttachment | null>;
}

export class ExpoChatFileSelectionService implements ChatFileSelectionService {
  async selectTextFile() {
    const selected = await File.pickFileAsync({
      mimeTypes: "*/*",
      multipleFiles: false,
    });
    if (selected.canceled || !selected.result) return null;
    const file = selected.result;
    if (file.size > MAX_CHAT_TEXT_FILE_BYTES) {
      throw new ChatFileAttachmentError(
        "file-too-large",
        "文件超过 64 KB，请选择较小的文本文件。",
      );
    }
    return createChatTextFileAttachment({
      id: `file-${randomUUID()}`,
      uri: file.uri,
      name: file.name,
      mimeType: file.type,
      text: await file.text(),
    });
  }
}

export const expoChatFileSelectionService = new ExpoChatFileSelectionService();
