import Constants from "expo-constants";
import {
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";
import { Platform } from "react-native";
import { LOCAL_INFERENCE } from "@/config/local-inference";

import { getAgentConfig } from "@/config/agent";
import {
  assertCloudDocumentConnectorsPermitted,
  generatedImagesEnabled,
  generatedVideoEnabled,
  loadComplianceConfig,
  thirdPartyMcpEnabled,
} from "@/config/compliance";
import {
  McpProxyService,
  OfficialStreamableHttpClientFactory,
} from "@boltpocket/mcp-client";
import type { AgentSshCredentialConnectionPort } from "@/application/ports/ssh-command-sessions";
import type { DistributionRegion } from "@/config/distribution";
import { loadModelSafetyConfig } from "@/config/model-safety";
import { loadOAuthBrokerConfig } from "@/config/oauth-broker";
import { LiveAgentOutputStore } from "@/application/live-agent-output";
import { PiMobileAgentRuntime } from "@/infrastructure/agent/pi-mobile-agent-runtime";
import { createPublicReadFetch } from "@/infrastructure/agent/public-read-fetch";
import { PiVisionSpecialist } from "@/infrastructure/agent/pi-vision-specialist";
import { PiTextSpecialist } from "@/infrastructure/agent/pi-text-specialist";
import { generatedImageStore } from "@/infrastructure/media/expo-generated-image-store";
import { generatedVideoStore } from "@/infrastructure/media/expo-generated-video-store";
import { OpenAICompatibleImageGenerationService } from "@/infrastructure/model-config/openai-compatible-image-generation";
import { OpenAICompatibleVideoGenerationService } from "@/infrastructure/model-config/openai-compatible-video-generation";
import { appBrowserControlBridge } from "@/infrastructure/browser/browser-control-bridge";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import { projectResourceCache } from "@/infrastructure/browser/expo-project-resource-cache";
import { NativeAgentBackgroundExecution } from "@/infrastructure/background/agent-background-execution";
import { getCurrentLocale } from "@/i18n/translate";
import { translateMessage } from "@/i18n/messages";
import { BrokerGoogleDocsAuthorization } from "@/infrastructure/connectors/broker-google-docs-authorization";
import { ExpoDocumentOAuth } from "@/infrastructure/connectors/expo-document-oauth";
import { ExpoGoogleDocsConnectionService } from "@/infrastructure/connectors/google-docs-connection-service";
import { GoogleSheetsHttpApi } from "@/infrastructure/connectors/google-sheets-http-api";
import { GoogleSlidesHttpApi } from "@/infrastructure/connectors/google-slides-http-api";
import { ExpoGoogleWorkspaceResourceConnectionService } from "@/infrastructure/connectors/google-workspace-resource-connection-service";
import { ExpoNotionConnectionService } from "@/infrastructure/connectors/notion-connection-service";
import { expoGoogleDocsCrypto } from "@/infrastructure/connectors/expo-google-docs-crypto";
import { expoNotionCrypto } from "@/infrastructure/connectors/expo-notion-crypto";
import { ExpoNativeTextConnectionService } from "@/infrastructure/connectors/expo-native-text-connections";
import { createRunConnectorRegistry } from "@/infrastructure/connectors/run-project-connectors";
import { ExpoEncryptedSqliteDocumentStore } from "@/infrastructure/persistence/expo-encrypted-sqlite-store";
import { DownloadedSkillRepository } from "@/infrastructure/capabilities/downloaded-skill-repository";
import { ProtectedMarketSkillRepository } from "@/infrastructure/capabilities/protected-market-skill-repository";
import { createAppCapabilityCatalog } from "@/infrastructure/capabilities/app-capability-catalog";
import { AgentThirdPartyCapabilityBridge } from "@/infrastructure/capabilities/agent-third-party-capability-bridge";
import { AgentSkillMarketPublicationBridge } from "@/infrastructure/capabilities/agent-skill-market-publication-bridge";
import { DirectSkillUrlResolver } from "@/infrastructure/capabilities/direct-skill-url";
import { SkillMarketClient } from "@/infrastructure/capabilities/skill-market-client";
import { SkillMarketPublicationClient } from "@/infrastructure/capabilities/skill-market-publication-client";
import { loadFirstPartyApiConfig } from "@/config/first-party-api";
import { AiDataConsentBroker } from "@/infrastructure/privacy/ai-data-consent-broker";
import { AiDataConsentRepository } from "@/infrastructure/privacy/ai-data-consent-repository";
import { requestModelDataConsent } from "@/infrastructure/privacy/model-data-consent";
import { PersistedAppStateRepository } from "@/infrastructure/persistence/persisted-app-state";
import { DurablePiSessionPersistence } from "@/infrastructure/persistence/pi-session-persistence";
import { ExpoChangeApprovalAuthority } from "@/infrastructure/security/expo-change-approval-authority";
import { CredentialAccessBroker } from "@/infrastructure/security/credential-access-broker";
import { CredentialVault } from "@/infrastructure/security/credential-vault";
import { DeviceCapabilityAccessBroker } from "@/infrastructure/device/device-capability-access-broker";
import {
  DeviceCapabilityPolicyController,
  DeviceCapabilitySettingsRepository,
} from "@/infrastructure/device/device-capability-settings-repository";
import { ExpoAgentDeviceCapabilities } from "@/infrastructure/device/expo-agent-device-capabilities";
import { ExpoCredentialSecureStringStore } from "@/infrastructure/security/expo-credential-secure-string-store";
import { ExpoSshCommandSessionService } from "@/infrastructure/shell/expo-ssh-command-sessions";
import { sshConnectionInputFromCredential } from "@/infrastructure/shell/ssh-credential-endpoint";
import {
  SerializedOperationCoordinator,
  SshCommandOperationCoordinator,
} from "@/infrastructure/shell/ssh-command-operation-coordinator";
import { ExpoProjectSourceSnapshotService } from "@/infrastructure/sources/expo-project-source-snapshots";
import { ExpoSafetyReportService } from "@/infrastructure/safety/expo-safety-report-service";
import { ModelSafetyPolicy } from "@/infrastructure/safety/model-safety-policy";
import {
  ExpoMcpOAuth,
  McpConnectionRepository,
  McpToolApprovalBroker,
  ProjectMcpServerSource,
} from "@/infrastructure/mcp";
import { SkillMarketPublisherBlocklist } from "@/infrastructure/capabilities/skill-market-publisher-blocklist";

const encryptedDocumentStore = new ExpoEncryptedSqliteDocumentStore();
const protectedMarketDocumentStore = new ExpoEncryptedSqliteDocumentStore({
  namespace: "protected-market",
});
const protectedMarketSkills = new ProtectedMarketSkillRepository(
  protectedMarketDocumentStore,
  (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
);

export function createAppServices(options: {
  externalFetch: typeof fetch;
  firstPartyAuthenticatedFetch: typeof fetch;
  region: DistributionRegion;
}) {
  const {
    externalFetch,
    firstPartyAuthenticatedFetch: appFirstPartyAuthenticatedFetch,
    region,
  } = options;
  const compliance = loadComplianceConfig({ distributionRegion: region });
  const skillMarketPublisherBlocklist = new SkillMarketPublisherBlocklist(
    encryptedDocumentStore,
    `skill-market:publisher-blocklist:v1:${region}`,
  );
  const capabilityCatalogRegion = region;
  const storageNamespace = region === "global" ? undefined : region;

  const liveAgentOutput = new LiveAgentOutputStore();
  const persistedAppState = new PersistedAppStateRepository(
    encryptedDocumentStore,
  );
  const downloadedSkills = new DownloadedSkillRepository(
    encryptedDocumentStore,
  );
  const capabilityCatalog = createAppCapabilityCatalog(region, externalFetch);
  const skillMarket = new SkillMarketClient(
    loadFirstPartyApiConfig(undefined, region),
    {
      fetch: LOCAL_INFERENCE ? appFirstPartyAuthenticatedFetch : externalFetch,
    },
  );
  const skillMarketPublication = new SkillMarketPublicationClient(
    loadFirstPartyApiConfig(undefined, region),
    { fetch: appFirstPartyAuthenticatedFetch },
  );
  function digestBytesSha256(value: Uint8Array) {
    const copied = new Uint8Array(value.byteLength);
    copied.set(value);
    return digest(CryptoDigestAlgorithm.SHA256, copied).then((buffer) =>
      [...new Uint8Array(buffer)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
  }
  const directSkillUrlResolver = new DirectSkillUrlResolver({
    catalog: capabilityCatalog,
    digest: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    digestBytes: digestBytesSha256,
    fetch: externalFetch,
    region: capabilityCatalogRegion,
  });
  const agentThirdPartyCapabilities = new AgentThirdPartyCapabilityBridge();
  const agentSkillMarketPublication = new AgentSkillMarketPublicationBridge();
  const aiDataConsentBroker = new AiDataConsentBroker(
    new AiDataConsentRepository(encryptedDocumentStore, storageNamespace),
    () => `ai-consent-request-${randomUUID()}`,
  );
  const credentialVault = new CredentialVault(
    new ExpoCredentialSecureStringStore(),
    () => `credential-${randomUUID()}`,
  );
  const credentialAccessBroker = new CredentialAccessBroker(
    credentialVault,
    () => `credential-request-${randomUUID()}`,
  );
  const deviceCapabilityPolicies = new DeviceCapabilityPolicyController(
    new DeviceCapabilitySettingsRepository(encryptedDocumentStore),
  );
  const deviceCapabilityAccessBroker = new DeviceCapabilityAccessBroker(
    () => `device-capability-request-${randomUUID()}`,
  );
  const agentDeviceCapabilities = new ExpoAgentDeviceCapabilities({
    approval: deviceCapabilityAccessBroker,
    policies: deviceCapabilityPolicies,
    createOperationId: () => `device-operation-${randomUUID()}`,
  });
  const mcpConnections = new McpConnectionRepository(
    encryptedDocumentStore,
    () => `mcp-${randomUUID()}`,
  );
  const mcpOAuth = new ExpoMcpOAuth(loadOAuthBrokerConfig(undefined, region), {
    fetch: appFirstPartyAuthenticatedFetch,
    storageNamespace,
  });
  const mcpToolApprovalBroker = new McpToolApprovalBroker({
    createRequestId: () => `mcp-approval-${randomUUID()}`,
  });
  const mcpRemoteClientFactory = new OfficialStreamableHttpClientFactory({
    clientName: "BoltPocket Mobile",
    clientVersion: Constants.expoConfig?.version ?? "0.1.0",
  });
  const mcpProxy = new McpProxyService({
    source: thirdPartyMcpEnabled(compliance)
      ? new ProjectMcpServerSource({
          connections: mcpConnections,
          fetch: externalFetch,
          vault: credentialVault,
          oauth: mcpOAuth,
        })
      : { listForProject: async () => [] },
    factory: mcpRemoteClientFactory,
    approval: mcpToolApprovalBroker,
  });
  const sshCommandSessions = new ExpoSshCommandSessionService({
    credentialVault,
  });
  const sshCommandOperations = new SshCommandOperationCoordinator();
  const agentSshCredentialConnection: AgentSshCredentialConnectionPort = {
    async connect(project, credentialId: string, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("aborted");
      const item = (await credentialVault.list()).find(
        (candidate) => candidate.id === credentialId,
      );
      if (!item || !item.projectIds.includes(project.id)) {
        throw new Error(
          translateMessage(
            "runtime.app.ssh.credentialNotAuthorized",
            getCurrentLocale(),
          ),
        );
      }
      const session = await sshCommandOperations.run(
        () =>
          sshCommandSessions.connect(
            project,
            sshConnectionInputFromCredential(item),
          ),
        signal,
      );
      if (signal?.aborted) throw new Error("aborted");
      return session;
    },
  };
  const documentOAuth = new ExpoDocumentOAuth(
    loadOAuthBrokerConfig(undefined, region),
    {
      assertConnectionPermitted: () =>
        assertCloudDocumentConnectorsPermitted(compliance),
      fetch: appFirstPartyAuthenticatedFetch,
      storageNamespace,
    },
  );
  const safetyReports = new ExpoSafetyReportService(
    loadOAuthBrokerConfig(undefined, region),
    {
      appVersion: Constants.expoConfig?.version ?? "unknown",
      fetch: appFirstPartyAuthenticatedFetch,
      platform: Platform.OS === "ios" ? "ios" : "android",
      storageNamespace,
    },
  );
  const modelSafetyPolicy = new ModelSafetyPolicy(
    loadModelSafetyConfig(undefined, region),
    { fetch: externalFetch },
  );
  const googleDocsAuthorization = new BrokerGoogleDocsAuthorization(
    documentOAuth,
  );
  const googleDocsConnections = new ExpoGoogleDocsConnectionService(
    encryptedDocumentStore,
    googleDocsAuthorization,
    expoGoogleDocsCrypto,
    externalFetch,
  );
  const googleSheetsConnections =
    new ExpoGoogleWorkspaceResourceConnectionService({
      kind: "sheets",
      store: encryptedDocumentStore,
      authorization: googleDocsAuthorization,
      crypto: expoGoogleDocsCrypto,
      api: new GoogleSheetsHttpApi(googleDocsAuthorization, externalFetch),
    });
  const googleSlidesConnections =
    new ExpoGoogleWorkspaceResourceConnectionService({
      kind: "slides",
      store: encryptedDocumentStore,
      authorization: googleDocsAuthorization,
      crypto: expoGoogleDocsCrypto,
      api: new GoogleSlidesHttpApi(googleDocsAuthorization, externalFetch),
    });
  const notionConnections = new ExpoNotionConnectionService(
    encryptedDocumentStore,
    documentOAuth,
    expoNotionCrypto,
    externalFetch,
  );
  const agentRuntime = new PiMobileAgentRuntime({
    locale: getCurrentLocale,
    thirdPartyCapabilities: LOCAL_INFERENCE
      ? undefined
      : agentThirdPartyCapabilities,
    skillMarketPublication: LOCAL_INFERENCE
      ? undefined
      : agentSkillMarketPublication,
    sessionPersistence: new DurablePiSessionPersistence(encryptedDocumentStore),
    mcpProxy,
    publicReadFetch: createPublicReadFetch(externalFetch),
    sshProjectShellSessionsProvider: (projectId) =>
      sshCommandSessions.activeForProject(projectId),
    credentialAccess: credentialAccessBroker,
    deviceCapabilities: agentDeviceCapabilities,
    sshCredentialConnection: agentSshCredentialConnection,
    browserControl: appBrowserControlBridge,
    projectPreview: projectPreviewSnapshots,
    projectResourceFiles: projectResourceCache,
    mediaAnalysis: new PiVisionSpecialist({
      locale: getCurrentLocale,
      authorizeModelAccess: async (config, signal) => {
        await modelSafetyPolicy.assertAllowed(config, signal);
        return requestModelDataConsent(
          aiDataConsentBroker,
          config,
          ["message", "attachments"],
          signal,
        );
      },
    }),
    imageGeneration: generatedImagesEnabled(compliance)
      ? new OpenAICompatibleImageGenerationService({
          fetchImpl: externalFetch,
          storage: generatedImageStore,
          authorizeModelAccess: async (config, signal) => {
            await modelSafetyPolicy.assertAllowed(config, signal);
            return requestModelDataConsent(
              aiDataConsentBroker,
              config,
              ["message"],
              signal,
            );
          },
        })
      : undefined,
    videoGeneration: generatedVideoEnabled(compliance)
      ? new OpenAICompatibleVideoGenerationService({
          fetchImpl: externalFetch,
          storage: generatedVideoStore,
          authorizeModelAccess: async (config, dataClasses, signal) => {
            await modelSafetyPolicy.assertAllowed(config, signal);
            return requestModelDataConsent(
              aiDataConsentBroker,
              config,
              dataClasses,
              signal,
            );
          },
        })
      : undefined,
    textDelegation: LOCAL_INFERENCE
      ? undefined
      : new PiTextSpecialist({
          locale: getCurrentLocale,
          authorizeModelAccess: async (config, signal) => {
            await modelSafetyPolicy.assertAllowed(config, signal);
            return requestModelDataConsent(
              aiDataConsentBroker,
              config,
              ["message", "project-context"],
              signal,
            );
          },
        }),
    registryFactory: (input) => {
      const cloudDocumentsEnabled =
        compliance.capabilities.cloudDocumentConnectors;
      const permittedInput = cloudDocumentsEnabled
        ? input
        : {
            ...input,
            connections: [],
            resources: input.resources.filter(
              (resource) =>
                ![
                  "google-doc",
                  "google-sheet",
                  "google-slide",
                  "notion-page",
                ].includes(resource.storage.kind),
            ),
          };
      return createRunConnectorRegistry(
        permittedInput,
        cloudDocumentsEnabled ? googleDocsConnections : undefined,
        cloudDocumentsEnabled ? googleSheetsConnections : undefined,
        cloudDocumentsEnabled ? googleSlidesConnections : undefined,
        cloudDocumentsEnabled ? notionConnections : undefined,
      );
    },
  });
  const agentRunTimeoutMs = getAgentConfig().runTimeoutMs;
  const agentBackgroundExecution = new NativeAgentBackgroundExecution({
    locale: getCurrentLocale,
    nativePlatform: Platform.OS,
  });
  const approvalAuthority = new ExpoChangeApprovalAuthority();
  const nativeTextConnections = new ExpoNativeTextConnectionService();
  const projectSourceSnapshots = new ExpoProjectSourceSnapshotService(
    externalFetch,
  );
  const proposalApplyOperations = new SerializedOperationCoordinator();

  return {
    agentBackgroundExecution,
    agentRunTimeoutMs,
    agentRuntime,
    agentSshCredentialConnection,
    agentSkillMarketPublication,
    agentThirdPartyCapabilities,
    aiDataConsentBroker,
    approvalAuthority,
    capabilityCatalog,
    capabilityCatalogRegion,
    credentialAccessBroker,
    credentialVault,
    deviceCapabilityAccessBroker,
    deviceCapabilityPolicies,
    directSkillUrlResolver,
    documentOAuth,
    downloadedSkills,
    encryptedDocumentStore,
    googleDocsAuthorization,
    googleDocsConnections,
    googleSheetsConnections,
    googleSlidesConnections,
    liveAgentOutput,
    mcpConnections,
    mcpOAuth,
    mcpProxy,
    mcpRemoteClientFactory,
    mcpToolApprovalBroker,
    modelSafetyPolicy,
    nativeTextConnections,
    notionConnections,
    persistedAppState,
    projectSourceSnapshots,
    protectedMarketSkills,
    proposalApplyOperations,
    safetyReports,
    sshCommandOperations,
    sshCommandSessions,
    skillMarket,
    skillMarketPublisherBlocklist,
    skillMarketPublication,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
