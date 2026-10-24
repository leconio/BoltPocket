import type { ChatMessage, GeneratedMediaAttachment } from "@/domain/models";
import { isGeneratedMediaAttachment } from "@/domain/models";

export function findGeneratedMediaAttachment(
  messages: readonly ChatMessage[],
  messageId: string,
  attachmentId: string,
): GeneratedMediaAttachment | null {
  const message = messages.find((candidate) => candidate.id === messageId);
  const attachment = message?.attachments?.find(
    (candidate) => candidate.id === attachmentId,
  );
  return attachment && isGeneratedMediaAttachment(attachment)
    ? attachment
    : null;
}

export function mediaReadAccessRoot(uri: string) {
  const separator = uri.lastIndexOf("/");
  return separator >= 0 ? uri.slice(0, separator + 1) : uri;
}
