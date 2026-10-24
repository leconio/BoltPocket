import type { GeneratedVideoAttachment } from "../../domain/models.ts";

export type VideoGenerationCapability = Readonly<{
  providerId: string;
  providerName: string;
  modelProfileId: string;
  modelId: string;
}>;

export type VideoAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";

export type VideoReferenceUrl = Readonly<{
  type: "image_url" | "video_url" | "audio_url";
  url: string;
}>;

export type VideoGenerationInput = Readonly<{
  taskId: string;
  parentRunId: string;
  conversationId: string;
  projectId: string | null;
  prompt: string;
  ratio?: VideoAspectRatio;
  durationSeconds?: number;
  generateAudio?: boolean;
  referenceImages?: readonly Readonly<{
    base64: string;
    mimeType: string;
  }>[];
  /** HTTPS references copied verbatim from the current user message. */
  referenceUrls?: readonly VideoReferenceUrl[];
  signal?: AbortSignal;
}>;

export type VideoGenerationResult = Readonly<{
  attachment: GeneratedVideoAttachment;
  capability: VideoGenerationCapability;
  providerTaskId: string;
}>;

/**
 * Credentials, provider URLs, async task polling, and signed result URLs stay
 * behind this host-owned boundary. The Agent receives only a sanitized
 * capability descriptor and the saved durable result.
 */
export interface AgentVideoGenerationPort {
  capability(): Promise<VideoGenerationCapability | null>;
  generate(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}
