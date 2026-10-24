import { File } from "expo-file-system";

import type { AgentInputImageAttachment } from "@/application/ports/agent-runtime";
import type { ImageAttachment } from "@/domain/models";

import { normalizeImageAttachment } from "./image-attachment";

async function loadImageAttachment(
  attachment: ImageAttachment,
): Promise<AgentInputImageAttachment> {
  const base64 =
    attachment.base64?.trim() || (await new File(attachment.uri).base64());
  const normalized = normalizeImageAttachment({
    uri: attachment.uri,
    mimeType: attachment.mimeType,
    base64,
    fileSize: attachment.sizeBytes,
    width: attachment.width,
    height: attachment.height,
    name: attachment.name,
  });
  return {
    ...attachment,
    mimeType: normalized.mimeType,
    base64: normalized.base64,
    sizeBytes: attachment.sizeBytes,
  };
}

/** Reads selected image bytes only for the lifetime of an outgoing model call. */
export function loadImageAttachmentsForAgent(
  attachments: readonly ImageAttachment[],
) {
  return Promise.all(attachments.map(loadImageAttachment));
}
