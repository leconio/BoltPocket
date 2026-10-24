import type { GeneratedImageAttachment } from "../../domain/models.ts";

export type ImageGenerationCapability = Readonly<{
  providerId: string;
  providerName: string;
  modelProfileId: string;
  modelId: string;
}>;

export type ImageGenerationInput = Readonly<{
  taskId: string;
  parentRunId: string;
  conversationId: string;
  projectId: string | null;
  prompt: string;
  signal?: AbortSignal;
}>;

export type ImageGenerationResult = Readonly<{
  attachment: GeneratedImageAttachment;
  capability: ImageGenerationCapability;
}>;

/**
 * Model credentials and provider URLs stay behind this host-owned boundary.
 * The Agent sees only the sanitized capability descriptor and saved result.
 */
export interface AgentImageGenerationPort {
  capability(): Promise<ImageGenerationCapability | null>;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
