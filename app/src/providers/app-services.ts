import type { SkillCapability } from "@/application/ports/capability-catalog";
import Constants from "expo-constants";
import {
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";
import { Platform } from "react-native";

import { getAgentConfig } from "@/config/agent";
import {
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
import { ExpoNativeTextConnectionService } from "@/infrastructure/connectors/expo-native-text-connections";
import { createRunConnectorRegistry } from "@/infrastructure/connectors/run-project-connectors";
import { ExpoEncryptedSqliteDocumentStore } from "@/infrastructure/persistence/expo-encrypted-sqlite-store";
import { DownloadedSkillRepository } from "@/infrastructure/capabilities/downloaded-skill-repository";
import { DirectSkillUrlResolver } from "@/infrastructure/capabilities/direct-skill-url";
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
import {
  McpConnectionRepository,
  McpToolApprovalBroker,
  ProjectMcpServerSource,
} from "@/infrastructure/mcp";

const encryptedDocumentStore = new ExpoEncryptedSqliteDocumentStore();
export function createAppServices(options: {
  externalFetch: typeof fetch;
  region: DistributionRegion;
}) {
  const { externalFetch, region } = options;
  const compliance = loadComplianceConfig({ distributionRegion: region });
  const capabilityCatalogRegion = region;
  const storageNamespace = region === "global" ? undefined : region;

  const liveAgentOutput = new LiveAgentOutputStore();
  const persistedAppState = new PersistedAppStateRepository(
    encryptedDocumentStore,
  );
  const downloadedSkills = new DownloadedSkillRepository(
    encryptedDocumentStore,
  );
  const capabilityCatalog = {
    async resolveSkill(
      sourceId: string,
      entryId: string,
      _region: DistributionRegion,
      signal?: AbortSignal,
    ): Promise<SkillCapability> {
      if (sourceId !== "direct-url")
        throw new Error(
          "Import a public GitHub repository or a direct SKILL.md URL.",
        );
      return directSkillUrlResolver.resolve(entryId, signal);
    },
  };
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
  const agentRuntime = new PiMobileAgentRuntime({
    locale: getCurrentLocale,
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
            return requestModelDataConsent(
              aiDataConsentBroker,
              config,
              dataClasses,
              signal,
            );
          },
        })
      : undefined,
    textDelegation: new PiTextSpecialist({
      locale: getCurrentLocale,
      authorizeModelAccess: async (config, signal) => {
        return requestModelDataConsent(
          aiDataConsentBroker,
          config,
          ["message", "project-context"],
          signal,
        );
      },
    }),
    registryFactory: (input) => createRunConnectorRegistry(input),
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
    aiDataConsentBroker,
    approvalAuthority,
    capabilityCatalog,
    capabilityCatalogRegion,
    credentialAccessBroker,
    credentialVault,
    deviceCapabilityAccessBroker,
    deviceCapabilityPolicies,
    directSkillUrlResolver,
    downloadedSkills,
    encryptedDocumentStore,
    liveAgentOutput,
    mcpConnections,
    mcpProxy,
    mcpRemoteClientFactory,
    mcpToolApprovalBroker,
    nativeTextConnections,
    persistedAppState,
    projectSourceSnapshots,
    proposalApplyOperations,
    sshCommandOperations,
    sshCommandSessions,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
