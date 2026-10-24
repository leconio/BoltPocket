import type {
  AiDataCategory,
  AiDataConsentPort,
  AiDataRecipient,
} from "@/application/ports/ai-data-consent";
import {
  assertModelPermittedForDistribution,
  isMainlandChinaRecipient,
  loadComplianceConfig,
} from "@/config/compliance";
import type { ResolvedModelRuntimeConfig } from "@/infrastructure/model-config";
import { LOCAL_PROVIDER_ID } from "@/config/local-inference";

export function aiDataCategoriesForMessage(input: {
  hasAttachments: boolean;
  hasProjectContext: boolean;
  hasConnectedDocuments: boolean;
  hasPendingDocumentLinks: boolean;
}): AiDataCategory[] {
  const categories: AiDataCategory[] = ["message"];
  if (input.hasAttachments) categories.push("attachments");
  if (input.hasProjectContext) categories.push("project-context");
  if (input.hasConnectedDocuments || input.hasPendingDocumentLinks) {
    categories.push("connected-documents");
  }
  return categories;
}

export function aiDataRecipientForModel(
  modelConfig: ResolvedModelRuntimeConfig,
): AiDataRecipient {
  const registeredService = assertModelPermittedForDistribution(
    loadComplianceConfig(),
    modelConfig,
  );
  const modelHost = new URL(modelConfig.baseUrl).hostname;
  return {
    providerId: modelConfig.providerId,
    providerName: registeredService?.providerName ?? modelHost,
    baseUrl: modelConfig.baseUrl,
    modelId: modelConfig.model,
    modelName: registeredService?.modelName ?? modelConfig.model,
    recipientName: registeredService?.recipientName ?? modelHost,
    recipientLocation: registeredService?.recipientLocation ?? null,
    filingNumber: registeredService?.filingNumber ?? null,
    crossBorder: registeredService
      ? !isMainlandChinaRecipient(registeredService.recipientLocation)
      : "unknown",
  };
}

export function requestModelDataConsent(
  consent: AiDataConsentPort,
  modelConfig: ResolvedModelRuntimeConfig,
  categories: readonly AiDataCategory[],
  signal?: AbortSignal,
) {
  // There is no recipient or data transfer on the native model route.
  if (modelConfig.providerId === LOCAL_PROVIDER_ID) return Promise.resolve(!signal?.aborted);
  return consent.requestConsent(
    aiDataRecipientForModel(modelConfig),
    categories,
    signal,
  );
}
