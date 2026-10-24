export type AiDataCategory =
  "message" | "attachments" | "project-context" | "connected-documents";

export type AiDataRecipient = {
  providerId: string;
  providerName: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  recipientName: string;
  recipientLocation: string | null;
  filingNumber: string | null;
  crossBorder: boolean | "unknown";
};

export type AiDataConsentGrant = AiDataRecipient & {
  consentKey: string;
  categories: AiDataCategory[];
  consentedAt: string;
  policyVersion: string;
};

export type PendingAiDataConsent = AiDataRecipient & {
  requestId: string;
  categories: AiDataCategory[];
  requestedAt: string;
};

export interface AiDataConsentStore {
  find(consentKey: string): Promise<AiDataConsentGrant | null>;
  list(): Promise<AiDataConsentGrant[]>;
  save(grant: AiDataConsentGrant): Promise<void>;
  withdrawAll(): Promise<void>;
}

export interface AiDataConsentPort {
  requestConsent(
    recipient: AiDataRecipient,
    categories: readonly AiDataCategory[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  listGrants(): Promise<AiDataConsentGrant[]>;
  withdrawAll(): Promise<void>;
}
