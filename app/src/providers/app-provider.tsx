import type { Dispatch, PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useStore } from "zustand";
import {
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";
import { AppState as NativeAppState, Linking, View } from "react-native";

import { LoadingIndicator } from "@/components/loading-indicator";
import { assertThirdPartyMcpPermitted } from "@/config/compliance";

import {
  InvalidProposalError,
  selectChangeProposalHunks,
} from "@/application/change-workflow";
import { estimateConversationContextTokens } from "@/application/conversation-context-usage";
import { partialAssistantMessageFromLiveOutput } from "@/application/live-agent-output";
import { assessSkillCapability } from "@/application/skill-assessment";
import { verifySkillBundleIntegrity } from "@/application/skill-bundle";
import { buildProjectSkillBundleInstallProposal } from "@/application/project-skill-bundle-install";
import type { AgentContextUsage } from "@/application/ports/agent-runtime";
import { ActiveAgentRunRegistry } from "@/application/active-agent-runs";
import { agentSessionIdForConversation } from "@/application/agent-session";
import { applyChangeProposalThroughConnectors } from "@/application/connector-change-workflow";
import {
  advanceConversationCheckpoint,
  createConversationRestoreProposal,
} from "@/application/conversation-checkpoint";
import {
  createProjectDirectoryCreateProposal as buildProjectDirectoryCreateProposal,
  createProjectEntryDeleteProposal as buildProjectEntryDeleteProposal,
  createProjectEntryRenameProposal as buildProjectEntryRenameProposal,
  createProjectFileCreateProposal as buildProjectFileCreateProposal,
  createProjectFileEditProposal as buildProjectFileEditProposal,
  parentProjectDirectory,
  projectResourcePath,
  type ProjectExplorerEntry,
} from "@/application/project-file-manager";
import { workspaceResourceToProjectPreviewFile } from "@/application/project-preview-files";
import type { GoogleWorkspaceConnectionBundle } from "@/application/ports/google-workspace-connections";
import type { GoogleDocsAuthorizedAccount } from "@/application/ports/google-docs-connections";
import type { NotionConnectionBundle } from "@/application/ports/notion-connections";
import type { NativeTextConnectionBundle } from "@/application/ports/native-text-connections";
import type {
  SshEndpointInput,
  TestSshCommandInput,
} from "@/application/ports/ssh-command-sessions";
import type {
  CreateCredentialInput,
  CredentialVaultItem,
  UpdateCredentialInput,
} from "@/application/ports/credential-vault";
import {
  GLOBAL_MCP_SCOPE_ID,
  type McpConnection,
  type McpConnectionInput,
} from "@/application/ports/mcp-connections";
import type { SkillCapability } from "@/application/ports/capability-catalog";
import type { DownloadedSkill } from "@/application/ports/downloaded-skills";
import {
  appReducer,
  getMemoryCatalog,
  getSkillCatalog,
  type AppAction,
  type AppState,
} from "@/domain/app-state";
import { validateEditableLibraryContent } from "@/domain/library-content";
import { useI18n } from "@/i18n/i18n-provider";
import { useAppPalette } from "@/theme/tokens";
import type {
  ChangeProposal,
  ChangeReceipt,
  ChatMessage,
  MemoryItem,
  Project,
  SkillItem,
  WorkspaceResource,
} from "@/domain/models";
import {
  isGeneratedImageAttachment,
  isGeneratedVideoAttachment,
} from "@/domain/models";
import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";
import {
  createProjectWithWorkspace,
  isProjectWorkspaceResource,
  projectWorkspaceConnectionId,
} from "@/domain/project-workspace";
import { validateProjectSkillDocument } from "@/domain/project-skill-document";
import { ExpoSshCommandSessionService } from "@/infrastructure/shell/expo-ssh-command-sessions";
import { shouldPersistAppAction } from "@/infrastructure/persistence/app-state-persistence-policy";
import { LatestValueSaveQueue } from "@/infrastructure/persistence/latest-value-save-queue";
import { restorePersistedAppState } from "@/infrastructure/persistence/persisted-app-state";
import { WorkspaceConnectorSession } from "@/infrastructure/connectors/workspace-connector-session";
import { findSupportedDocumentLinks } from "@/infrastructure/connectors/document-link";
import { projectShellPathForResource } from "@/infrastructure/agent/workspace-project-shell";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import { generatedImageStore } from "@/infrastructure/media/expo-generated-image-store";
import { generatedVideoStore } from "@/infrastructure/media/expo-generated-video-store";
import { isProjectPreviewCandidatePath } from "@/infrastructure/browser/project-preview-policy";
import { DIRECT_SKILL_SOURCE_ID } from "@/infrastructure/capabilities/direct-skill-url";
import { BOLTPOCKET_MARKET_SOURCE } from "@/infrastructure/capabilities/skill-market-client";
import {
  isProtectedMarketDownload,
  PROTECTED_MARKET_SKILL_PLACEHOLDER,
} from "@/infrastructure/capabilities/protected-market-skill-repository";
import { ThirdPartyCapabilityService } from "@/infrastructure/capabilities/third-party-capability-service";
import { ProjectSkillMarketPublicationService } from "@/infrastructure/capabilities/project-skill-market-publication-service";
import { enabledProjectResourcePacks } from "@/domain/builtin-project-resources";
import { CredentialAccessApproval } from "@/features/security/credential-access-approval";
import { AiDataConsentApproval } from "@/features/security/ai-data-consent-approval";
import { McpToolApproval } from "@/features/security/mcp-tool-approval";
import { DeviceCapabilityAccessApproval } from "@/features/security/device-capability-access-approval";
import { useAgentMessaging } from "@/providers/use-agent-messaging";
import { registerDistributionTransitionHandler } from "@/providers/distribution-transition";
import { useRuntimeServices } from "@/providers/runtime-services-provider";
import type { AppServices } from "@/providers/app-services";
import { preloadModelConfig } from "@/infrastructure/model-config";
import {
  createAppStateSelection,
  replaceAppState,
} from "@/stores/app-state-store";
import {
  createMobileStoreRegistry,
  type MobileStoreRegistry,
} from "@/stores/mobile-store-registry";
import type { SessionState } from "@/stores/session-store";

export { createAppStateFieldsSelector } from "@/stores/app-state-store";

type AppActionsContextValue = {
  dispatch: Dispatch<AppAction>;
  createProject: (name: string) => Project;
  sendMessage: (content: string) => Promise<void>;
  retryRun: () => Promise<void>;
  cancelRun: () => void;
  getConversationContextUsage: (
    conversationId: string,
  ) => Promise<AgentContextUsage>;
  deleteConversation: (conversationId: string) => Promise<void>;
  claimConversation: (conversationId: string, projectId: string) => void;
  applyProposal: (
    proposalId: string,
    acceptedHunkIds?: readonly string[],
  ) => Promise<ChangeReceipt>;
  createProjectFileEditProposal: (input: {
    projectId: string;
    resourceId: string;
    after: string;
  }) => ChangeProposal;
  createProjectEntry: (input: {
    projectId: string;
    directory: string;
    name: string;
    kind: "file" | "directory";
  }) => ChangeProposal;
  renameProjectEntry: (input: {
    projectId: string;
    entry: ProjectExplorerEntry;
    name: string;
  }) => ChangeProposal;
  deleteProjectEntry: (input: {
    projectId: string;
    entry: ProjectExplorerEntry;
  }) => ChangeProposal;
  installDownloadedSkill: (input: {
    autoUpdate: boolean;
    capability: SkillCapability;
    projectId?: string;
  }) => Promise<{
    receipt: ChangeReceipt | null;
    updateTracking: "saved" | "unavailable";
  }>;
  updateDownloadedSkill: (
    projectId: string | null,
    skillId: string,
  ) => Promise<"current" | "updated">;
  readProjectFile: (input: {
    projectId: string;
    resourceId: string;
  }) => Promise<WorkspaceResource>;
  createProjectPreview: (input: {
    projectId: string;
    resourceId: string;
  }) => Promise<ProjectPreviewSnapshot>;
  updateGlobalMemory: (memoryId: string, text: string) => void;
  updateGlobalSkill: (skillId: string, content: string) => void;
  createGlobalMemory: (text: string) => MemoryItem;
  createProjectMemory: (input: {
    projectId: string;
    text: string;
  }) => Promise<void>;
  createRestoreProposal: (conversationId?: string) => ChangeProposal;
  connectNativeTextDirectory: (
    projectId?: string,
  ) => Promise<NativeTextConnectionBundle | null>;
  googleWorkspaceAccount: () => Promise<GoogleDocsAuthorizedAccount | null>;
  authorizeGoogleWorkspace: (
    projectId?: string,
    force?: boolean,
  ) => Promise<GoogleDocsAuthorizedAccount | null>;
  connectGoogleWorkspaceResource: (
    resourceUrl: string,
    projectId?: string,
  ) => Promise<GoogleWorkspaceConnectionBundle | null>;
  connectNotionPage: (
    pageUrl: string,
    projectId?: string,
  ) => Promise<NotionConnectionBundle | null>;
  probeSshHostKey: (
    input: SshEndpointInput,
  ) => ReturnType<ExpoSshCommandSessionService["probeHostKey"]>;
  testSshConnection: (
    input: TestSshCommandInput,
  ) => ReturnType<ExpoSshCommandSessionService["testConnection"]>;
  createCredential: (
    input: CreateCredentialInput,
  ) => Promise<CredentialVaultItem>;
  updateCredential: (
    credentialId: string,
    input: UpdateCredentialInput,
  ) => Promise<CredentialVaultItem>;
  removeCredential: (credentialId: string) => Promise<void>;
  authorizeMcpOAuth: (
    serverUrl: string,
  ) => ReturnType<AppServices["mcpOAuth"]["connect"]>;
  createMcpConnection: (input: McpConnectionInput) => Promise<McpConnection>;
  updateMcpConnection: (
    connectionId: string,
    input: McpConnectionInput,
  ) => Promise<McpConnection>;
  removeMcpConnection: (connectionId: string) => Promise<void>;
  probeMcpConnection: (connectionId: string) => Promise<unknown>;
};

const AppActionsContext = createContext<AppActionsContextValue | null>(null);
const MobileStoreRegistryContext = createContext<MobileStoreRegistry | null>(
  null,
);

function waitForInteractionFrame() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 48);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    } else {
      setTimeout(finish, 0);
    }
  });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DOWNLOADED_SKILL_AUTO_UPDATE_TTL_MS = 6 * 60 * 60 * 1_000;

function activeProjectId(state: AppState) {
  return state.conversationProjectIds[state.activeConversationId] ?? null;
}

function projectFileConversationId(state: AppState, projectId: string) {
  const existing = state.conversationIdsByProject[projectId];
  return existing && state.conversationProjectIds[existing] === projectId
    ? existing
    : createId(`conversation-${projectId}-files`);
}

function byteHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyCompleteSkillBundle(
  capability: SkillCapability,
  failureMessage: string,
) {
  const valid = await verifySkillBundleIntegrity(capability, {
    text: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    bytes: async (value) => {
      const copied = new Uint8Array(value.byteLength);
      copied.set(value);
      return byteHex(await digest(CryptoDigestAlgorithm.SHA256, copied));
    },
  });
  if (!valid) {
    throw new Error(failureMessage);
  }
  return capability.bundle.sha256;
}

function proposalConversationId(
  state: AppState,
  proposal: ChangeProposal,
  mismatchMessage: string,
) {
  const conversationId = proposal.conversationId;
  if (
    !conversationId ||
    state.conversationProjectIds[conversationId] !== proposal.projectId
  ) {
    throw new InvalidProposalError(mismatchMessage);
  }
  return conversationId;
}

function ApprovalOverlays({
  aiDataConsentBroker,
  credentialAccessBroker,
  deviceCapabilityAccessBroker,
  mcpToolApprovalBroker,
  store,
}: {
  aiDataConsentBroker: AppServices["aiDataConsentBroker"];
  credentialAccessBroker: AppServices["credentialAccessBroker"];
  deviceCapabilityAccessBroker: AppServices["deviceCapabilityAccessBroker"];
  mcpToolApprovalBroker: AppServices["mcpToolApprovalBroker"];
  store: MobileStoreRegistry["approval"];
}) {
  const credentialAccess = useStore(store, (state) => state.credentialAccess);
  const mcpTool = useStore(store, (state) => state.mcpTool);
  const aiDataConsent = useStore(store, (state) => state.aiDataConsent);
  const deviceCapability = useStore(store, (state) => state.deviceCapability);

  return (
    <>
      <CredentialAccessApproval
        onApprove={(requestId) => credentialAccessBroker.approve(requestId)}
        onDeny={(requestId) => credentialAccessBroker.deny(requestId)}
        request={credentialAccess}
      />
      <McpToolApproval
        onApprove={(requestId, scope) =>
          mcpToolApprovalBroker.approve(requestId, scope)
        }
        onDeny={(requestId) => mcpToolApprovalBroker.deny(requestId)}
        request={mcpTool}
      />
      <AiDataConsentApproval
        onApprove={(requestId) => aiDataConsentBroker.approve(requestId)}
        onDeny={(requestId) => aiDataConsentBroker.deny(requestId)}
        request={aiDataConsent}
      />
      <DeviceCapabilityAccessApproval
        onApprove={(requestId) =>
          deviceCapabilityAccessBroker.approve(requestId)
        }
        onDeny={(requestId) => deviceCapabilityAccessBroker.deny(requestId)}
        request={deviceCapability}
      />
    </>
  );
}

export function AppProvider({ children }: PropsWithChildren) {
  const { locale, t } = useI18n();
  const palette = useAppPalette();
  const runtimeServices = useRuntimeServices();
  const services = runtimeServices.application;
  const { abortRegionOperations } = runtimeServices;
  const {
    aiDataConsentBroker,
    agentRuntime,
    agentSkillMarketPublication,
    agentThirdPartyCapabilities,
    agentBackgroundExecution,
    approvalAuthority,
    credentialAccessBroker,
    credentialVault,
    deviceCapabilityAccessBroker,
    capabilityCatalog,
    capabilityCatalogRegion,
    documentOAuth,
    downloadedSkills,
    directSkillUrlResolver,
    googleDocsConnections,
    googleDocsAuthorization,
    googleSheetsConnections,
    googleSlidesConnections,
    notionConnections,
    nativeTextConnections,
    liveAgentOutput,
    mcpConnections,
    mcpOAuth,
    mcpProxy,
    mcpRemoteClientFactory,
    mcpToolApprovalBroker,
    persistedAppState,
    projectSourceSnapshots,
    protectedMarketSkills,
    proposalApplyOperations,
    sshCommandOperations,
    sshCommandSessions,
    skillMarketPublication,
  } = services;
  const [storeRegistry] = useState(createMobileStoreRegistry);
  const {
    app: stateStore,
    approval: approvalStore,
    session: sessionStore,
  } = storeRegistry;
  const getHydrationSnapshot = useCallback(
    () => stateStore.getState().isHydrating,
    [stateStore],
  );
  const isHydrating = useSyncExternalStore(
    stateStore.subscribe,
    getHydrationSnapshot,
    getHydrationSnapshot,
  );
  const downloadedSkillsLoading = useStore(
    sessionStore,
    (state) => state.downloadedSkillsLoading,
  );
  const setCredentialVaultItems = useCallback(
    (credentialVaultItems: Awaited<ReturnType<typeof credentialVault.list>>) =>
      sessionStore.setState({ credentialVaultItems }),
    [credentialVault, sessionStore],
  );
  const setMcpConnectionItems = useCallback(
    (mcpConnectionItems: Awaited<ReturnType<typeof mcpConnections.list>>) =>
      sessionStore.setState({ mcpConnectionItems }),
    [mcpConnections, sessionStore],
  );
  const setDownloadedSkillItems = useCallback(
    (downloadedSkillItems: Awaited<ReturnType<typeof downloadedSkills.list>>) =>
      sessionStore.setState({ downloadedSkillItems }),
    [downloadedSkills, sessionStore],
  );
  const persistenceReady = useRef(false);
  const persistenceErrorMessage = useRef<string | null>(null);
  const lastNativeAppState = useRef(NativeAppState.currentState);
  const appStateGeneration = useRef(0);
  const applyingProposalIds = useRef(new Set<string>());
  const updatingDownloadedSkillKeys = useRef(new Set<string>());
  const initialSkillAutoUpdateStarted = useRef(false);
  const skillAutoUpdateLastStartedAt = useRef(0);
  const skillAutoUpdateOperation = useRef<Promise<void> | null>(null);
  const applyProposalRef = useRef<
    AppActionsContextValue["applyProposal"] | null
  >(null);
  const sshCommandRecovery = useRef<AbortController | null>(null);
  const activeRuns = useRef(new ActiveAgentRunRegistry());
  const publishState = useCallback(
    (nextState: AppState) => {
      replaceAppState(stateStore, nextState);
    },
    [stateStore],
  );

  const reduceAction = useCallback(
    (action: AppAction) => {
      const nextState = appReducer(stateStore.getState(), action);
      publishState(nextState);
      return nextState;
    },
    [publishState, stateStore],
  );

  const [persistenceSaveQueue] = useState(
    () =>
      new LatestValueSaveQueue<AppState>({
        beforeSave: waitForInteractionFrame,
        save(nextState) {
          return persistedAppState.save(nextState);
        },
      }),
  );

  const enqueuePersistence = useCallback(
    (nextState: AppState) =>
      persistenceSaveQueue.enqueue(nextState).then(
        () => {
          if (
            !persistenceErrorMessage.current ||
            stateStore.getState().storageError !==
              persistenceErrorMessage.current
          ) {
            return;
          }
          persistenceErrorMessage.current = null;
          reduceAction({ type: "storage/ready" });
        },
        (error: unknown) => {
          const message = t("runtime.app.storage.saveFailed");
          if (
            persistenceErrorMessage.current !== message ||
            stateStore.getState().storageError !== message
          ) {
            persistenceErrorMessage.current = message;
            reduceAction({ type: "storage/fail", message });
          }
          throw error;
        },
      ),
    [persistenceSaveQueue, reduceAction, stateStore, t],
  );

  const commitAction = useCallback(
    (action: AppAction, persist = true) => {
      const nextState = reduceAction(action);
      if (
        persist &&
        persistenceReady.current &&
        shouldPersistAppAction(action)
      ) {
        void enqueuePersistence(nextState).catch(() => undefined);
      }
      return nextState;
    },
    [enqueuePersistence, reduceAction],
  );

  const dispatch = useCallback(
    (action: AppAction) => {
      commitAction(action);
    },
    [commitAction],
  );

  const flushPersistence = useCallback(async () => {
    await persistenceSaveQueue.flush();
    await persistedAppState.flush();
  }, [persistedAppState, persistenceSaveQueue]);

  useEffect(() => {
    const unsubscribe = credentialAccessBroker.subscribe((credentialAccess) =>
      approvalStore.setState({ credentialAccess }),
    );
    return () => {
      unsubscribe();
    };
  }, [approvalStore, credentialAccessBroker]);

  useEffect(() => {
    const unsubscribe = aiDataConsentBroker.subscribe((aiDataConsent) =>
      approvalStore.setState({ aiDataConsent }),
    );
    return () => unsubscribe();
  }, [aiDataConsentBroker, approvalStore]);

  useEffect(() => {
    const unsubscribe = mcpToolApprovalBroker.subscribe((mcpTool) =>
      approvalStore.setState({ mcpTool }),
    );
    return () => unsubscribe();
  }, [approvalStore, mcpToolApprovalBroker]);

  useEffect(() => {
    const unsubscribe = deviceCapabilityAccessBroker.subscribe(
      (deviceCapability) => approvalStore.setState({ deviceCapability }),
    );
    return () => unsubscribe();
  }, [approvalStore, deviceCapabilityAccessBroker]);

  useEffect(() => {
    if (isHydrating) return;
    void Promise.allSettled([
      preloadModelConfig(),
      aiDataConsentBroker.listGrants(),
    ]);
  }, [aiDataConsentBroker, isHydrating]);

  useEffect(() => {
    const completeOAuth = (url: string | null) => {
      if (!url?.startsWith("boltpocket://oauth/")) return;
      const completion = url.startsWith("boltpocket://oauth/mcp/complete")
        ? mcpOAuth.completeFromUrl(url)
        : url.startsWith("boltpocket://oauth/complete")
          ? documentOAuth.completeFromUrl(url)
          : null;
      if (!completion) return;
      void completion.catch((error) => {
        if (__DEV__) {
          console.warn("[BoltPocket:oauth] callback completion failed", {
            name: error instanceof Error ? error.name : "UnknownError",
            reason:
              error instanceof Error ? error.message : "Unknown OAuth failure.",
          });
        }
      });
    };
    void Linking.getInitialURL()
      .then(completeOAuth)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) =>
      completeOAuth(url),
    );
    return () => subscription.remove();
  }, [documentOAuth, mcpOAuth]);

  const shutdownPromise = useRef<Promise<void> | null>(null);
  const shutdownApplication = useCallback(() => {
    abortRegionOperations();
    if (shutdownPromise.current) return shutdownPromise.current;
    for (const run of activeRuns.current.abortAll("interrupted")) {
      activeRuns.current.release(run.conversationId, run.controller);
    }
    credentialAccessBroker.denyAll();
    deviceCapabilityAccessBroker.denyAll();
    mcpToolApprovalBroker.denyAll();
    aiDataConsentBroker.denyAll();
    liveAgentOutput.clearAll();
    sshCommandRecovery.current?.abort();
    const pendingPersistence = persistenceReady.current
      ? enqueuePersistence(stateStore.getState()).catch(() => undefined)
      : Promise.resolve();
    shutdownPromise.current = (async () => {
      await agentRuntime.dispose().catch(() => undefined);
      await agentBackgroundExecution.stop().catch(() => undefined);
      await pendingPersistence;
      await flushPersistence().catch(() => undefined);
      await sshCommandOperations
        .run(() => sshCommandSessions.disconnectAll())
        .catch(() => undefined);
    })();
    return shutdownPromise.current;
  }, [
    abortRegionOperations,
    agentBackgroundExecution,
    agentRuntime,
    aiDataConsentBroker,
    credentialAccessBroker,
    deviceCapabilityAccessBroker,
    enqueuePersistence,
    flushPersistence,
    liveAgentOutput,
    mcpToolApprovalBroker,
    sshCommandOperations,
    sshCommandSessions,
    stateStore,
  ]);
  const shutdownApplicationRef = useRef(shutdownApplication);

  useEffect(() => {
    shutdownApplicationRef.current = shutdownApplication;
  }, [shutdownApplication]);

  useLayoutEffect(
    () => registerDistributionTransitionHandler(shutdownApplication),
    [shutdownApplication],
  );

  useEffect(
    () => () => {
      void shutdownApplicationRef.current();
    },
    [],
  );

  useEffect(
    () =>
      agentBackgroundExecution.subscribeToExpiration(() => {
        const runs = activeRuns.current.abortAll("interrupted");
        for (const run of runs) {
          const liveSnapshot = liveAgentOutput.snapshot(run.conversationId);
          const interruptedAt = Date.now();
          activeRuns.current.release(run.conversationId, run.controller);
          dispatch({
            type: "run/interrupted",
            runId: run.runId,
            conversationId: run.conversationId,
            partialMessage: partialAssistantMessageFromLiveOutput(
              liveSnapshot,
              "interrupted",
              interruptedAt,
            ),
            interruptedAt: new Date(interruptedAt).toISOString(),
          });
          liveAgentOutput.clear(run.conversationId, run.runId);
        }
      }),
    [agentBackgroundExecution, dispatch, liveAgentOutput],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const persisted = await persistedAppState.load();
        if (!active) return;
        if (persisted) {
          dispatch({
            type: "state/restore",
            state: restorePersistedAppState(stateStore.getState(), persisted),
          });
        } else {
          dispatch({ type: "state/hydration-complete" });
        }
        persistenceReady.current = true;
      } catch (error) {
        if (__DEV__) {
          console.warn("[BoltPocket:persistence] state load failed", {
            name: error instanceof Error ? error.name : "UnknownError",
            reason:
              error instanceof Error ? error.message : "Unknown load failure.",
          });
        }
        if (!active) return;
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.historyReadFailed"),
        });
        dispatch({ type: "state/hydration-complete" });
      }

      const [
        nativeResult,
        googleDocsResult,
        googleSheetsResult,
        googleSlidesResult,
        notionResult,
        sourceResult,
        sshResult,
        credentialResult,
        mcpResult,
        downloadedSkillResult,
      ] = await Promise.allSettled([
        nativeTextConnections.load(),
        googleDocsConnections.load(),
        googleSheetsConnections.load(),
        googleSlidesConnections.load(),
        notionConnections.load(),
        projectSourceSnapshots.load(),
        sshCommandOperations.run(async () => {
          try {
            return await sshCommandSessions.load(
              Object.values(stateStore.getState().projects),
            );
          } catch (error) {
            await sshCommandSessions.disconnectAll().catch(() => undefined);
            throw error;
          }
        }),
        credentialVault.list(),
        mcpConnections.list(),
        downloadedSkills.list(),
      ]);
      if (!active) return;
      if (nativeResult.status === "fulfilled") {
        for (const bundle of nativeResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.nativeConnectionsRestoreFailed"),
        });
      }
      if (googleDocsResult.status === "fulfilled") {
        for (const bundle of googleDocsResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.googleDocsRestoreFailed"),
        });
      }
      if (googleSheetsResult.status === "fulfilled") {
        for (const bundle of googleSheetsResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.googleSheetsRestoreFailed"),
        });
      }
      if (googleSlidesResult.status === "fulfilled") {
        for (const bundle of googleSlidesResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.googleSlidesRestoreFailed"),
        });
      }
      if (notionResult.status === "fulfilled") {
        for (const bundle of notionResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.notionRestoreFailed"),
        });
      }
      if (sourceResult.status === "fulfilled") {
        for (const bundle of sourceResult.value) {
          dispatch({ type: "connection/upsert", ...bundle });
        }
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.projectSourcesRestoreFailed"),
        });
      }
      if (sshResult.status === "rejected") {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.sshConfigRestoreFailed"),
        });
      }
      if (credentialResult.status === "fulfilled") {
        setCredentialVaultItems(credentialResult.value);
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.credentialVaultReadFailed"),
        });
      }
      sessionStore.setState({ credentialVaultLoading: false });
      if (mcpResult.status === "fulfilled") {
        setMcpConnectionItems(mcpResult.value);
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.mcpConnectionsReadFailed"),
        });
      }
      sessionStore.setState({ mcpConnectionsLoading: false });
      if (downloadedSkillResult.status === "fulfilled") {
        setDownloadedSkillItems(downloadedSkillResult.value);
      } else {
        dispatch({
          type: "storage/fail",
          message: t("runtime.app.storage.downloadedSkillsReadFailed"),
        });
      }
      sessionStore.setState({ downloadedSkillsLoading: false });
    })();
    return () => {
      active = false;
    };
  }, [
    credentialVault,
    dispatch,
    downloadedSkills,
    googleDocsConnections,
    googleSheetsConnections,
    googleSlidesConnections,
    mcpConnections,
    nativeTextConnections,
    notionConnections,
    persistedAppState,
    projectSourceSnapshots,
    sessionStore,
    setCredentialVaultItems,
    setDownloadedSkillItems,
    setMcpConnectionItems,
    sshCommandOperations,
    sshCommandSessions,
    stateStore,
    t,
  ]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (next) => {
      const previous = lastNativeAppState.current;
      lastNativeAppState.current = next;
      if (next === "active" && previous === "active") return;
      const generation = ++appStateGeneration.current;
      sshCommandRecovery.current?.abort();
      sshCommandRecovery.current = null;
      if (next !== "active") {
        credentialAccessBroker.denyAll();
        deviceCapabilityAccessBroker.denyAll();
        void mcpProxy.closeAll();
        if (persistenceReady.current) {
          void enqueuePersistence(stateStore.getState()).catch(() => undefined);
        }
        void flushPersistence().catch(() => undefined);
        return;
      }
      const controller = new AbortController();
      sshCommandRecovery.current = controller;
      const isCurrentRecovery = () =>
        !controller.signal.aborted &&
        appStateGeneration.current === generation &&
        lastNativeAppState.current === "active";
      void sshCommandOperations
        .run(async () => {
          try {
            if (!isCurrentRecovery()) return;
            await sshCommandSessions.disconnectAll();
            if (!isCurrentRecovery()) {
              await sshCommandSessions.disconnectAll().catch(() => undefined);
              return;
            }
            await sshCommandSessions.load(
              Object.values(stateStore.getState().projects),
            );
          } catch {
            await sshCommandSessions.disconnectAll().catch(() => undefined);
            if (!isCurrentRecovery()) return;
            dispatch({
              type: "storage/fail",
              message: t("runtime.app.storage.sshSessionRestoreFailed"),
            });
          }
        }, controller.signal)
        .catch(() => undefined)
        .finally(() => {
          if (sshCommandRecovery.current === controller) {
            sshCommandRecovery.current = null;
          }
        });
    });
    return () => subscription.remove();
  }, [
    credentialAccessBroker,
    deviceCapabilityAccessBroker,
    dispatch,
    enqueuePersistence,
    flushPersistence,
    mcpProxy,
    sshCommandOperations,
    sshCommandSessions,
    stateStore,
    t,
  ]);

  const createProject = useCallback(
    (name: string) => {
      const bundle = createProjectWithWorkspace({
        id: `project-${randomUUID()}`,
        locale,
        name,
      });
      const nextState = commitAction({ type: "project/created", ...bundle });
      if (nextState.projects[bundle.project.id] !== bundle.project) {
        throw new Error(t("runtime.app.project.initFailed"));
      }
      return bundle.project;
    },
    [commitAction, locale, t],
  );

  const ensureConversationProject = useCallback(
    (conversationId: string) => {
      const currentProjectId =
        stateStore.getState().conversationProjectIds[conversationId];
      if (currentProjectId) return currentProjectId;
      if (currentProjectId !== null) {
        throw new Error(t("runtime.app.workspace.conversationMissing"));
      }
      const project = createProject(t("runtime.app.workspace.defaultName"));
      const claimed = commitAction({
        type: "conversation/claim-project",
        conversationId,
        projectId: project.id,
      });
      if (claimed.conversationProjectIds[conversationId] !== project.id) {
        throw new Error(t("runtime.app.workspace.scopeFailed"));
      }
      return project.id;
    },
    [commitAction, createProject, stateStore, t],
  );

  const { cancelRun, retryRun, sendMessage } = useAgentMessaging({
    activeRunsRef: activeRuns,
    applyProposalRef,
    dispatch,
    ensureConversationProject,
    flushPersistence,
    persistenceReady,
    setCredentialVaultItems,
    getState: stateStore.getState,
  });

  const applyProposal = useCallback(
    async (proposalId: string, acceptedHunkIds?: readonly string[]) => {
      if (!persistenceReady.current) {
        throw new InvalidProposalError(
          t("runtime.app.proposal.historyUnavailable"),
        );
      }
      const initialSnapshot = stateStore.getState();
      const initialProposal = initialSnapshot.proposals[proposalId];
      if (!initialProposal) {
        throw new InvalidProposalError(t("runtime.app.proposal.missing"));
      }
      if (initialProposal.status !== "pending") {
        throw new InvalidProposalError(t("runtime.app.proposal.notPending"));
      }
      const selectedHunkIds = selectChangeProposalHunks(
        initialProposal,
        acceptedHunkIds ?? initialProposal.hunks.map((hunk) => hunk.id),
      ).hunks.map((hunk) => hunk.id);
      proposalConversationId(
        initialSnapshot,
        initialProposal,
        t("runtime.app.proposal.projectConversationMismatch"),
      );
      if (applyingProposalIds.current.has(proposalId)) {
        throw new InvalidProposalError(t("runtime.app.proposal.applying"));
      }
      applyingProposalIds.current.add(proposalId);
      try {
        return await proposalApplyOperations.run(async () => {
          const current = stateStore.getState();
          const proposalToApply = current.proposals[proposalId];
          if (!proposalToApply || proposalToApply.status !== "pending") {
            throw new InvalidProposalError(t("runtime.app.proposal.stale"));
          }
          proposalConversationId(
            current,
            proposalToApply,
            t("runtime.app.proposal.projectConversationMismatch"),
          );
          const executeApply = async () => {
            const snapshot = stateStore.getState();
            const changeProposal = snapshot.proposals[proposalId];
            if (!changeProposal || changeProposal.status !== "pending") {
              throw new InvalidProposalError(t("runtime.app.proposal.stale"));
            }
            const selectedChangeProposal = selectChangeProposalHunks(
              changeProposal,
              selectedHunkIds,
            );
            const owningConversationId = proposalConversationId(
              snapshot,
              selectedChangeProposal,
              t("runtime.app.proposal.projectConversationMismatch"),
            );
            const project = snapshot.projects[selectedChangeProposal.projectId];
            if (!project) {
              throw new InvalidProposalError(
                t("runtime.app.proposal.projectMissing"),
              );
            }
            const connectorSession = new WorkspaceConnectorSession({
              project,
              resources: Object.values(snapshot.resources),
              connections: Object.values(snapshot.connections),
              readOnly: false,
              googleDocs: googleDocsConnections,
              googleSheets: googleSheetsConnections,
              googleSlides: googleSlidesConnections,
              notion: notionConnections,
            });
            const result = await applyChangeProposalThroughConnectors({
              proposal: selectedChangeProposal,
              resources: snapshot.resources,
              receiptId: createId("receipt"),
              conversationId: owningConversationId,
              appliedAt: new Date().toISOString(),
              registry: connectorSession.registry,
              approvalAuthority,
            });
            const conversationId = result.receipt.conversationId;
            const checkpoint = advanceConversationCheckpoint({
              checkpoint: snapshot.conversationCheckpoints[conversationId],
              checkpointId: createId("checkpoint"),
              conversationId,
              projectId: selectedChangeProposal.projectId,
              createdAt: result.receipt.appliedAt,
              receipt: result.receipt,
              beforeResources: snapshot.resources,
              afterResources: result.resources,
            });
            const appliedTargets = result.receipt.changes.length;
            const message: ChatMessage = {
              id: createId("assistant-change"),
              role: "assistant",
              content:
                selectedChangeProposal.kind === "restore"
                  ? t("runtime.app.proposal.restoreComplete", {
                      count: appliedTargets,
                    })
                  : t("runtime.app.proposal.applyComplete", {
                      count: appliedTargets,
                    }),
            };
            const nextState = commitAction(
              {
                type: "proposal/applied",
                proposalId,
                resources: result.resources,
                receipt: result.receipt,
                checkpoint,
                message,
              },
              false,
            );
            return { nextState, receipt: result.receipt };
          };
          const applied = await executeApply();
          try {
            await enqueuePersistence(applied.nextState);
            await flushPersistence();
          } catch {
            throw new Error(t("runtime.app.proposal.persistenceFailed"));
          }
          return applied.receipt;
        });
      } finally {
        applyingProposalIds.current.delete(proposalId);
      }
    },
    [
      approvalAuthority,
      commitAction,
      enqueuePersistence,
      flushPersistence,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      notionConnections,
      proposalApplyOperations,
      stateStore,
      t,
    ],
  );
  useEffect(() => {
    applyProposalRef.current = applyProposal;
    return () => {
      if (applyProposalRef.current === applyProposal) {
        applyProposalRef.current = null;
      }
    };
  }, [applyProposal]);

  const createRestoreProposal = useCallback(
    (conversationId?: string) => {
      const snapshot = stateStore.getState();
      const resolvedConversationId =
        conversationId ?? snapshot.activeConversationId;
      const checkpoint =
        snapshot.conversationCheckpoints[resolvedConversationId];
      if (!checkpoint) {
        throw new InvalidProposalError(
          t("runtime.app.proposal.restorePointMissing"),
        );
      }

      const restoreProposal = createConversationRestoreProposal({
        checkpoint,
        resources: snapshot.resources,
        proposalId: createId("restore"),
        createdAt: new Date().toISOString(),
        locale,
      });
      dispatch({ type: "proposal/restore-created", proposal: restoreProposal });
      return restoreProposal;
    },
    [dispatch, locale, stateStore, t],
  );

  const createProjectFileEditProposal = useCallback(
    (input: { projectId: string; resourceId: string; after: string }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      if (!project) throw new Error(t("runtime.app.file.projectMissing"));
      const resource = snapshot.resources[input.resourceId];
      if (!resource || resource.projectId !== project.id) {
        throw new Error(t("runtime.app.file.missing"));
      }
      const conversationId = projectFileConversationId(snapshot, project.id);
      const proposalId = createId("manual-file");
      const proposal = buildProjectFileEditProposal({
        projectId: project.id,
        conversationId,
        resource,
        after: input.after,
        connectorLabel:
          snapshot.connections[resource.connectionId]?.name ??
          resource.connectionId,
        proposalId,
        hunkId: `${proposalId}-content`,
        createdAt: new Date().toISOString(),
        locale,
      });
      const nextState = commitAction({
        type: "proposal/manual-created",
        proposal,
      });
      if (nextState.proposals[proposal.id] !== proposal) {
        throw new Error(t("runtime.app.projectFile.proposalChanged"));
      }
      return proposal;
    },
    [commitAction, locale, stateStore, t],
  );

  const registerManualFileProposal = useCallback(
    (proposal: ChangeProposal) => {
      const nextState = commitAction({
        type: "proposal/manual-created",
        proposal,
      });
      if (nextState.proposals[proposal.id] !== proposal) {
        throw new Error(t("runtime.app.projectFile.proposalChanged"));
      }
      return proposal;
    },
    [commitAction, t],
  );

  const createProjectEntry = useCallback(
    (input: {
      projectId: string;
      directory: string;
      name: string;
      kind: "file" | "directory";
    }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      if (!project) throw new Error(t("runtime.app.file.projectMissing"));
      const path = projectResourcePath(input.directory, input.name, input.kind);
      const collision = Object.values(snapshot.resources).some(
        (resource) =>
          resource.projectId === project.id &&
          (resource.path === path ||
            resource.path.startsWith(`${path}/`) ||
            path.startsWith(`${resource.path}/`)),
      );
      if (collision) throw new Error(`目标已存在：${path}`);
      const proposalId = createId("manual-file");
      const common = {
        projectId: project.id,
        conversationId: projectFileConversationId(snapshot, project.id),
        path,
        connectorLabel:
          snapshot.connections[projectWorkspaceConnectionId(project.id)]
            ?.name ?? projectWorkspaceConnectionId(project.id),
        proposalId,
        hunkId: `${proposalId}-content`,
        createdAt: new Date().toISOString(),
        locale,
      };
      return registerManualFileProposal(
        input.kind === "directory"
          ? buildProjectDirectoryCreateProposal(common)
          : buildProjectFileCreateProposal({ ...common, content: "" }),
      );
    },
    [locale, registerManualFileProposal, stateStore, t],
  );

  const renameProjectEntry = useCallback(
    (input: {
      projectId: string;
      entry: ProjectExplorerEntry;
      name: string;
    }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      if (!project) throw new Error(t("runtime.app.file.projectMissing"));
      const proposalId = createId("manual-file");
      return registerManualFileProposal(
        buildProjectEntryRenameProposal({
          projectId: project.id,
          conversationId: projectFileConversationId(snapshot, project.id),
          entry: input.entry,
          destinationPath: projectResourcePath(
            parentProjectDirectory(input.entry.path),
            input.name,
            input.entry.kind,
          ),
          resources: Object.values(snapshot.resources),
          connectorLabel:
            snapshot.connections[projectWorkspaceConnectionId(project.id)]
              ?.name ?? projectWorkspaceConnectionId(project.id),
          proposalId,
          createdAt: new Date().toISOString(),
          locale,
        }),
      );
    },
    [locale, registerManualFileProposal, stateStore, t],
  );

  const deleteProjectEntry = useCallback(
    (input: { projectId: string; entry: ProjectExplorerEntry }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      if (!project) throw new Error(t("runtime.app.file.projectMissing"));
      const proposalId = createId("manual-file");
      return registerManualFileProposal(
        buildProjectEntryDeleteProposal({
          projectId: project.id,
          conversationId: projectFileConversationId(snapshot, project.id),
          entry: input.entry,
          resources: Object.values(snapshot.resources),
          connectorLabel:
            snapshot.connections[projectWorkspaceConnectionId(project.id)]
              ?.name ?? projectWorkspaceConnectionId(project.id),
          proposalId,
          createdAt: new Date().toISOString(),
          locale,
        }),
      );
    },
    [locale, registerManualFileProposal, stateStore, t],
  );

  const persistDownloadedSkill = useCallback(
    async (item: DownloadedSkill) => {
      await downloadedSkills.save(item);
      setDownloadedSkillItems(await downloadedSkills.list());
    },
    [downloadedSkills, setDownloadedSkillItems],
  );

  const installDownloadedSkill = useCallback(
    async (input: {
      autoUpdate: boolean;
      capability: SkillCapability;
      projectId?: string;
    }) => {
      const snapshot = stateStore.getState();
      const project = input.projectId
        ? snapshot.projects[input.projectId]
        : undefined;
      if (input.projectId && !project)
        throw new Error(t("runtime.app.skillDownload.projectMissing"));
      const protectedMarketDownload =
        input.capability.source.id === BOLTPOCKET_MARKET_SOURCE.id;
      if (protectedMarketDownload && project) {
        throw new Error(t("market.detail.globalOnly"));
      }
      const path = `skills/${input.capability.id}/SKILL.md`;
      const validation = validateProjectSkillDocument(
        path,
        input.capability.skillDocument,
      );
      if (!validation.valid) throw new Error(validation.reason);
      const assessment = assessSkillCapability({
        capability: input.capability,
        connectedMcpServerUrls: sessionStore
          .getState()
          .mcpConnectionItems.filter((item) => item.enabled)
          .map((item) => item.serverUrl),
        locale,
      });
      if (assessment.status === "unsupported") {
        throw new Error(t("runtime.app.skillDownload.unsupported"));
      }
      await verifyCompleteSkillBundle(
        input.capability,
        t("runtime.app.skillDownload.integrityFailed"),
      );
      if (!project) {
        if (input.capability.bundle.files.length !== 1) {
          throw new Error(t("library.capabilities.completePackageProjectOnly"));
        }
        if (
          getSkillCatalog(snapshot, locale).some(
            (skill) => skill.id === input.capability.id,
          )
        ) {
          throw new Error(t("runtime.app.skillDownload.duplicate"));
        }
        const skill: SkillItem = {
          id: input.capability.id,
          name: validation.document.title ?? input.capability.id,
          description: validation.document.description ?? "",
          content: protectedMarketDownload
            ? PROTECTED_MARKET_SKILL_PLACEHOLDER
            : validation.document.body,
          risk: validation.document.risk ?? input.capability.risk,
          enabled: false,
          scope: "global",
          projectIds: [],
        };
        const timestamp = new Date().toISOString();
        const downloadRecord: DownloadedSkill = {
          // Protected market instructions stay encrypted until an enabled
          // Agent run needs them; background update checks must not decrypt
          // the payload merely to compare its current bytes.
          autoUpdate: false,
          catalogId: input.capability.source.entryId,
          installedAt: timestamp,
          projectId: null,
          resourcePath: path,
          revision: input.capability.revision,
          sha256: input.capability.sha256,
          skillId: input.capability.id,
          sourceId: input.capability.source.id,
          updatedAt: timestamp,
        };
        if (protectedMarketDownload) {
          await protectedMarketSkills.save(input.capability);
          try {
            await persistDownloadedSkill(downloadRecord);
            const installed = commitAction({
              type: "skill/create-global",
              skill,
            });
            if (!installed.customGlobalSkills[skill.id]) {
              throw new Error(t("runtime.app.globalSkill.createFailed"));
            }
          } catch (error) {
            await Promise.allSettled([
              downloadedSkills.remove(null, skill.id),
              protectedMarketSkills.remove(downloadRecord),
            ]);
            setDownloadedSkillItems(
              await downloadedSkills.list().catch(() => []),
            );
            throw error;
          }
          return { receipt: null, updateTracking: "saved" as const };
        }
        const installed = commitAction({ type: "skill/create-global", skill });
        if (!installed.customGlobalSkills[skill.id]) {
          throw new Error(t("runtime.app.globalSkill.createFailed"));
        }
        const updateTracking = await persistDownloadedSkill(
          downloadRecord,
        ).then(
          () => "saved" as const,
          () => "unavailable" as const,
        );
        return { receipt: null, updateTracking };
      }
      if (
        Object.values(snapshot.resources).some(
          (resource) =>
            resource.projectId === project.id &&
            resource.path.startsWith(`skills/${input.capability.id}/`),
        )
      ) {
        throw new Error(t("runtime.app.skillDownload.duplicate"));
      }
      const conversationId = projectFileConversationId(snapshot, project.id);
      const proposalId = createId("skill-install");
      const connectorId = projectWorkspaceConnectionId(project.id);
      const proposal = buildProjectSkillBundleInstallProposal({
        capability: input.capability,
        projectId: project.id,
        conversationId,
        connectorLabel: snapshot.connections[connectorId]?.name ?? connectorId,
        proposalId,
        createdAt: new Date().toISOString(),
        locale,
      });
      const staged = commitAction({
        type: "proposal/capability-created",
        proposal,
      });
      if (staged.proposals[proposal.id] !== proposal) {
        throw new Error(t("runtime.app.skillDownload.stageFailed"));
      }
      const receipt = await applyProposal(proposal.id);
      if (assessment.status === "partial") {
        commitAction({
          type: "skill/set-enabled",
          scope: "project",
          projectId: project.id,
          skillId: input.capability.id,
          enabled: false,
        });
      }
      const timestamp = new Date().toISOString();
      if (input.capability.bundle.files.length !== 1) {
        return { receipt, updateTracking: "unavailable" as const };
      }
      const updateTracking = await persistDownloadedSkill({
        autoUpdate: input.autoUpdate,
        catalogId: input.capability.source.entryId,
        installedAt: timestamp,
        projectId: project.id,
        resourcePath: path,
        revision: input.capability.revision,
        sha256: input.capability.sha256,
        skillId: input.capability.id,
        sourceId: input.capability.source.id,
        updatedAt: timestamp,
      }).then(
        () => "saved" as const,
        () => "unavailable" as const,
      );
      return { receipt, updateTracking };
    },
    [
      applyProposal,
      commitAction,
      downloadedSkills,
      locale,
      persistDownloadedSkill,
      protectedMarketSkills,
      setDownloadedSkillItems,
      sessionStore,
      stateStore,
      t,
    ],
  );

  const updateDownloadedSkill = useCallback(
    async (projectId: string | null, skillId: string) => {
      const operationKey = `${projectId ?? "inventory"}:${skillId}`;
      if (updatingDownloadedSkillKeys.current.has(operationKey)) {
        throw new Error(t("runtime.app.skillDownload.updating"));
      }
      updatingDownloadedSkillKeys.current.add(operationKey);
      try {
        const record = (await downloadedSkills.list()).find(
          (item) => item.projectId === projectId && item.skillId === skillId,
        );
        if (!record)
          throw new Error(t("runtime.app.skillDownload.notDownloaded"));
        const capability = await capabilityCatalog.resolveSkill(
          record.sourceId,
          record.catalogId,
          capabilityCatalogRegion,
        );
        const validation = validateProjectSkillDocument(
          record.resourcePath,
          capability.skillDocument,
        );
        if (!validation.valid) throw new Error(validation.reason);
        const assessment = assessSkillCapability({
          capability,
          connectedMcpServerUrls: sessionStore
            .getState()
            .mcpConnectionItems.filter((item) => item.enabled)
            .map((item) => item.serverUrl),
          locale,
        });
        if (assessment.status === "unsupported") {
          throw new Error(t("runtime.app.skillDownload.updateUnsupported"));
        }
        await verifyCompleteSkillBundle(
          capability,
          t("runtime.app.skillDownload.integrityFailed"),
        );
        const snapshot = stateStore.getState();
        if (projectId === null) {
          const skill = snapshot.customGlobalSkills[skillId];
          if (!skill) {
            await downloadedSkills.remove(null, skillId);
            setDownloadedSkillItems(await downloadedSkills.list());
            throw new Error(t("runtime.app.skillDownload.resourceMissing"));
          }
          if (isProtectedMarketDownload(record)) {
            if (
              skill.content !== PROTECTED_MARKET_SKILL_PLACEHOLDER ||
              capability.id !== skillId ||
              capability.source.id !== record.sourceId ||
              capability.source.entryId !== record.catalogId
            ) {
              throw new Error(t("runtime.app.skillDownload.integrityFailed"));
            }
            if (
              record.revision === capability.revision &&
              record.sha256 === capability.sha256
            ) {
              return "current" as const;
            }
            const nextRecord = {
              ...record,
              revision: capability.revision,
              sha256: capability.sha256,
              updatedAt: new Date().toISOString(),
            };
            await protectedMarketSkills.save(capability);
            try {
              await persistDownloadedSkill(nextRecord);
            } catch (error) {
              await protectedMarketSkills
                .remove(nextRecord)
                .catch(() => undefined);
              throw error;
            }
            await protectedMarketSkills.remove(record).catch(() => undefined);
            return "updated" as const;
          }
          if (skill.content === validation.document.body) {
            if (
              record.revision !== capability.revision ||
              record.sha256 !== capability.sha256
            ) {
              await persistDownloadedSkill({
                ...record,
                revision: capability.revision,
                sha256: capability.sha256,
                updatedAt: new Date().toISOString(),
              });
            }
            return "current" as const;
          }
          const nextState = commitAction({
            type: "skill/update-global",
            skillId,
            content: validation.document.body,
          });
          if (
            nextState.customGlobalSkills[skillId]?.content !==
            validation.document.body
          ) {
            throw new Error(t("runtime.app.globalSkill.saveFailed"));
          }
          await persistDownloadedSkill({
            ...record,
            revision: capability.revision,
            sha256: capability.sha256,
            updatedAt: new Date().toISOString(),
          });
          return "updated" as const;
        }
        const resource = Object.values(snapshot.resources).find(
          (item) =>
            item.projectId === projectId && item.path === record.resourcePath,
        );
        if (!resource) {
          await downloadedSkills.remove(projectId, skillId);
          setDownloadedSkillItems(await downloadedSkills.list());
          throw new Error(t("runtime.app.skillDownload.resourceMissing"));
        }
        if (resource.content === capability.skillDocument) {
          if (
            record.revision !== capability.revision ||
            record.sha256 !== capability.sha256
          ) {
            await persistDownloadedSkill({
              ...record,
              revision: capability.revision,
              sha256: capability.sha256,
              updatedAt: new Date().toISOString(),
            });
          }
          return "current" as const;
        }
        const proposal = createProjectFileEditProposal({
          projectId,
          resourceId: resource.id,
          after: capability.skillDocument,
        });
        await applyProposal(proposal.id);
        if (assessment.status === "partial") {
          commitAction({
            type: "skill/set-enabled",
            scope: "project",
            projectId,
            skillId,
            enabled: false,
          });
        }
        await persistDownloadedSkill({
          ...record,
          revision: capability.revision,
          sha256: capability.sha256,
          updatedAt: new Date().toISOString(),
        });
        return "updated" as const;
      } finally {
        updatingDownloadedSkillKeys.current.delete(operationKey);
      }
    },
    [
      applyProposal,
      capabilityCatalog,
      capabilityCatalogRegion,
      commitAction,
      createProjectFileEditProposal,
      downloadedSkills,
      locale,
      persistDownloadedSkill,
      protectedMarketSkills,
      sessionStore,
      setDownloadedSkillItems,
      stateStore,
      t,
    ],
  );

  const runDownloadedSkillAutoUpdates = useCallback(async () => {
    const now = Date.now();
    if (skillAutoUpdateOperation.current) {
      await skillAutoUpdateOperation.current;
      return;
    }
    if (
      now - skillAutoUpdateLastStartedAt.current <
      DOWNLOADED_SKILL_AUTO_UPDATE_TTL_MS
    ) {
      return;
    }
    skillAutoUpdateLastStartedAt.current = now;
    const operation = (async () => {
      const records = await downloadedSkills.list().catch(() => []);
      for (const item of records) {
        if (!item.autoUpdate) continue;
        const snapshot = stateStore.getState();
        const content = isProtectedMarketDownload(item)
          ? await protectedMarketSkills.load(item).catch(() => null)
          : item.projectId === null
            ? snapshot.customGlobalSkills[item.skillId]?.content
            : Object.values(snapshot.resources).find(
                (candidate) =>
                  candidate.projectId === item.projectId &&
                  candidate.path === item.resourcePath,
              )?.content;
        if (!content) continue;
        const currentSha256 = await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          content,
        ).catch(() => null);
        if (currentSha256 !== item.sha256) continue;
        await updateDownloadedSkill(item.projectId, item.skillId).catch(
          () => undefined,
        );
      }
    })();
    skillAutoUpdateOperation.current = operation;
    try {
      await operation;
    } finally {
      if (skillAutoUpdateOperation.current === operation) {
        skillAutoUpdateOperation.current = null;
      }
    }
  }, [
    downloadedSkills,
    protectedMarketSkills,
    stateStore,
    updateDownloadedSkill,
  ]);

  useEffect(() => {
    if (
      downloadedSkillsLoading ||
      isHydrating ||
      initialSkillAutoUpdateStarted.current
    ) {
      return;
    }
    initialSkillAutoUpdateStarted.current = true;
    void runDownloadedSkillAutoUpdates();
  }, [downloadedSkillsLoading, runDownloadedSkillAutoUpdates, isHydrating]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next === "active") void runDownloadedSkillAutoUpdates();
    });
    return () => subscription.remove();
  }, [runDownloadedSkillAutoUpdates]);

  const createProjectMemory = useCallback(
    async (input: { projectId: string; text: string }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      if (!project)
        throw new Error(t("runtime.app.projectMemory.projectMissing"));
      const memory = validateEditableLibraryContent("memory", input.text)
        .replace(/\s+/gu, " ")
        .trim();
      const resource = Object.values(snapshot.resources).find(
        (candidate) =>
          candidate.projectId === project.id &&
          candidate.path === "MEMORY.md" &&
          isProjectWorkspaceResource(candidate),
      );
      if (!resource)
        throw new Error(t("runtime.app.projectMemory.fileMissing"));
      const after = `${resource.content.trimEnd()}\n- ${memory}\n`;
      const proposal = createProjectFileEditProposal({
        projectId: project.id,
        resourceId: resource.id,
        after,
      });
      await applyProposal(proposal.id);
    },
    [applyProposal, createProjectFileEditProposal, stateStore, t],
  );

  const readProjectFile = useCallback(
    async (input: { projectId: string; resourceId: string }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      const resource = snapshot.resources[input.resourceId];
      if (!project || !resource || resource.projectId !== project.id) {
        throw new Error(t("runtime.app.file.missing"));
      }

      const connectorSession = new WorkspaceConnectorSession({
        project,
        resources: Object.values(snapshot.resources),
        connections: Object.values(snapshot.connections),
        readOnly: true,
        googleDocs: googleDocsConnections,
        googleSheets: googleSheetsConnections,
        googleSlides: googleSlidesConnections,
        notion: notionConnections,
      });
      const matchingRefs = (
        await connectorSession.registry.listResources(project.id)
      ).filter(
        (ref) =>
          ref.resourceId === resource.id &&
          ref.connectorId === resource.connectionId,
      );
      if (matchingRefs.length !== 1) {
        throw new Error(t("runtime.app.connector.referenceMissing"));
      }
      const read = await connectorSession.registry.read(matchingRefs[0]!);
      if (
        read.ref.projectId !== project.id ||
        read.ref.resourceId !== resource.id ||
        read.ref.connectorId !== resource.connectionId
      ) {
        throw new Error(t("runtime.app.connector.contentMismatch"));
      }

      const current = stateStore.getState().resources[resource.id];
      if (
        !current ||
        current.projectId !== resource.projectId ||
        current.connectionId !== resource.connectionId ||
        current.path !== resource.path ||
        current.version !== resource.version ||
        current.storage.kind !== resource.storage.kind
      ) {
        throw new Error(t("runtime.app.file.changed"));
      }
      const refreshed: WorkspaceResource = {
        ...current,
        content: read.text,
        version: read.version,
        storage:
          (current.storage.kind === "google-doc" ||
            current.storage.kind === "google-sheet" ||
            current.storage.kind === "google-slide" ||
            current.storage.kind === "notion-page") &&
          typeof read.metadata.writable === "boolean"
            ? {
                ...current.storage,
                writable: read.metadata.writable,
                ...(typeof read.metadata.trashable === "boolean"
                  ? { trashable: read.metadata.trashable }
                  : {}),
                ...(typeof read.metadata.restorable === "boolean"
                  ? { restorable: read.metadata.restorable }
                  : {}),
                ...(typeof read.metadata.trashed === "boolean"
                  ? { trashed: read.metadata.trashed }
                  : {}),
              }
            : current.storage,
      };
      const nextState = commitAction({
        type: "resources/refreshed",
        resources: [refreshed],
      });
      const accepted = nextState.resources[resource.id];
      if (
        accepted?.content !== read.text ||
        accepted.version !== read.version
      ) {
        throw new Error(t("runtime.app.file.connectionChanged"));
      }
      return accepted;
    },
    [
      commitAction,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      notionConnections,
      stateStore,
      t,
    ],
  );

  const createProjectPreview = useCallback(
    async (input: { projectId: string; resourceId: string }) => {
      const snapshot = stateStore.getState();
      const project = snapshot.projects[input.projectId];
      const entry = snapshot.resources[input.resourceId];
      if (!project || !entry || entry.projectId !== project.id) {
        throw new Error(t("runtime.app.preview.missing"));
      }
      if (!/\.html?$/iu.test(entry.path)) {
        throw new Error(t("runtime.app.preview.htmlOnly"));
      }
      const entryShellPath = projectShellPathForResource(entry);
      const separator = entry.path.lastIndexOf("/");
      const resourceRoot = separator < 0 ? "" : entry.path.slice(0, separator);
      const rootPrefix = resourceRoot ? `${resourceRoot}/` : "";
      const candidates = Object.values(snapshot.resources).filter(
        (resource) =>
          resource.projectId === project.id &&
          resource.connectionId === entry.connectionId &&
          (resourceRoot ? resource.path.startsWith(rootPrefix) : true) &&
          isProjectPreviewCandidatePath(
            entryShellPath,
            projectShellPathForResource(resource),
          ),
      );
      if (candidates.length > 512) {
        throw new Error(t("runtime.app.preview.tooManyFiles"));
      }
      const connectorSession = new WorkspaceConnectorSession({
        project,
        resources: Object.values(snapshot.resources),
        connections: Object.values(snapshot.connections),
        readOnly: true,
        googleDocs: googleDocsConnections,
        googleSheets: googleSheetsConnections,
        googleSlides: googleSlidesConnections,
        notion: notionConnections,
      });
      const refs = await connectorSession.registry.listResources(project.id);
      const refsByResourceId = new Map(
        refs.map((ref) => [`${ref.connectorId}\0${ref.resourceId}`, ref]),
      );
      const refreshed: WorkspaceResource[] = [];
      for (const candidate of candidates) {
        const ref = refsByResourceId.get(
          `${candidate.connectionId}\0${candidate.id}`,
        );
        if (!ref) {
          throw new Error(
            t("runtime.app.preview.fileReferenceMissing", {
              path: candidate.path,
            }),
          );
        }
        const read = await connectorSession.registry.read(ref);
        refreshed.push({
          ...candidate,
          content: read.text,
          version: read.version,
        });
      }
      if (refreshed.length) {
        commitAction({ type: "resources/refreshed", resources: refreshed });
      }
      return projectPreviewSnapshots.create({
        projectId: project.id,
        entryPath: entryShellPath,
        enabledResourcePackIds: enabledProjectResourcePacks(
          snapshot.projectResourcePackEnabledByProjectId,
          project.id,
        ).map((pack) => pack.id),
        files: refreshed.map((resource) =>
          workspaceResourceToProjectPreviewFile(
            resource,
            projectShellPathForResource(resource),
          ),
        ),
      });
    },
    [
      commitAction,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      notionConnections,
      stateStore,
      t,
    ],
  );

  const connectNativeTextDirectory = useCallback(
    async (projectId?: string) => {
      const snapshot = stateStore.getState();
      const resolvedProjectId = projectId ?? activeProjectId(snapshot);
      const project = resolvedProjectId
        ? snapshot.projects[resolvedProjectId]
        : undefined;
      if (!project) {
        throw new Error(t("runtime.app.connection.native.projectRequired"));
      }
      const bundle = await nativeTextConnections.connect(project);
      if (bundle) dispatch({ type: "connection/upsert", ...bundle });
      return bundle;
    },
    [dispatch, nativeTextConnections, stateStore, t],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      const snapshot = stateStore.getState();
      if (!Object.hasOwn(snapshot.conversationProjectIds, conversationId)) {
        throw new Error(t("runtime.app.conversation.missing"));
      }
      if (
        snapshot.autoApplyingProposalIds.some(
          (proposalId) =>
            snapshot.proposals[proposalId]?.conversationId === conversationId,
        )
      ) {
        throw new Error(t("runtime.app.conversation.deleteWhileWriting"));
      }
      const run = activeRuns.current.abort(conversationId, "cancelled");
      if (run) {
        activeRuns.current.release(conversationId, run.controller);
        liveAgentOutput.clear(conversationId, run.runId);
        void agentBackgroundExecution
          .syncActiveConversations(activeRuns.current.conversationIds())
          .catch(() => undefined);
      }
      const attachments = (
        snapshot.messagesByConversation[conversationId] ?? []
      ).flatMap((message) => message.attachments ?? []);
      await agentRuntime.deleteConversation(conversationId);
      mcpToolApprovalBroker.clearSession(
        agentSessionIdForConversation(conversationId),
      );
      await generatedImageStore.delete(
        attachments.filter(isGeneratedImageAttachment),
      );
      await generatedVideoStore.delete(
        attachments.filter(isGeneratedVideoAttachment),
      );
      commitAction({
        type: "conversation/delete",
        conversationId,
        replacementConversationId: `conversation-${randomUUID()}`,
      });
      await flushPersistence();
    },
    [
      agentBackgroundExecution,
      agentRuntime,
      commitAction,
      flushPersistence,
      liveAgentOutput,
      mcpToolApprovalBroker,
      stateStore,
      t,
    ],
  );

  const getConversationContextUsage = useCallback(
    (conversationId: string) => {
      const snapshot = stateStore.getState();
      return agentRuntime.contextUsage(conversationId, {
        ...(snapshot.conversationModelProfileIds[conversationId]
          ? {
              modelProfileId:
                snapshot.conversationModelProfileIds[conversationId],
            }
          : {}),
        estimatedUsedTokens: estimateConversationContextTokens(
          snapshot.messagesByConversation[conversationId] ?? [],
        ),
      });
    },
    [agentRuntime, stateStore],
  );

  const claimConversation = useCallback(
    (conversationId: string, projectId: string) => {
      const before = stateStore.getState();
      if (before.conversationProjectIds[conversationId] !== null) {
        throw new Error(t("runtime.app.claim.quickOnly"));
      }
      if (before.activeRunsByConversation[conversationId]) {
        throw new Error(t("runtime.app.claim.waitForRun"));
      }
      const after = commitAction({
        type: "conversation/claim-project",
        conversationId,
        projectId,
      });
      if (after.conversationProjectIds[conversationId] !== projectId) {
        throw new Error(t("runtime.app.claim.failed"));
      }
    },
    [commitAction, stateStore, t],
  );

  const connectGoogleWorkspaceResource = useCallback(
    async (resourceUrl: string, projectId?: string) => {
      const snapshot = stateStore.getState();
      const resolvedProjectId = projectId ?? activeProjectId(snapshot);
      const project = resolvedProjectId
        ? snapshot.projects[resolvedProjectId]
        : undefined;
      if (!project) {
        throw new Error(t("runtime.app.connection.google.projectRequired"));
      }
      const [link] = findSupportedDocumentLinks(resourceUrl, 1);
      if (!link || link.provider === "notion") {
        throw new Error(t("runtime.app.connection.google.linkRequired"));
      }
      const bundle =
        link.provider === "google-docs"
          ? await googleDocsConnections.connect(project, link.url)
          : link.provider === "google-sheets"
            ? await googleSheetsConnections.connect(project, link.url)
            : await googleSlidesConnections.connect(project, link.url);
      if (bundle) dispatch({ type: "connection/upsert", ...bundle });
      return bundle;
    },
    [
      dispatch,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      stateStore,
      t,
    ],
  );

  const googleWorkspaceAccount = useCallback(async () => {
    const session = await googleDocsAuthorization.restore();
    return session?.account ?? null;
  }, [googleDocsAuthorization]);

  const authorizeGoogleWorkspace = useCallback(
    async (projectId?: string, force = false) => {
      const snapshot = stateStore.getState();
      const resolvedProjectId = projectId ?? activeProjectId(snapshot);
      const project = resolvedProjectId
        ? snapshot.projects[resolvedProjectId]
        : undefined;
      if (!project) {
        throw new Error(
          t("runtime.app.connection.google.authorizationProjectRequired"),
        );
      }
      const session = await googleDocsAuthorization.connect(force);
      if (!session) return null;
      const bundles = await Promise.all([
        googleDocsConnections.connectAccount(project, session.account),
        googleSheetsConnections.connectAccount(project, session.account),
        googleSlidesConnections.connectAccount(project, session.account),
      ]);
      for (const bundle of bundles) {
        dispatch({ type: "connection/upsert", ...bundle });
      }
      return session.account;
    },
    [
      dispatch,
      googleDocsAuthorization,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      stateStore,
      t,
    ],
  );

  const connectNotionPage = useCallback(
    async (pageUrl: string, projectId?: string) => {
      const snapshot = stateStore.getState();
      const resolvedProjectId = projectId ?? activeProjectId(snapshot);
      const project = resolvedProjectId
        ? snapshot.projects[resolvedProjectId]
        : undefined;
      if (!project) {
        throw new Error(t("runtime.app.connection.notion.projectRequired"));
      }
      const bundle = await notionConnections.connect(project, pageUrl);
      if (bundle) dispatch({ type: "connection/upsert", ...bundle });
      return bundle;
    },
    [dispatch, notionConnections, stateStore, t],
  );

  const updateGlobalMemory = useCallback(
    (memoryId: string, rawText: string) => {
      const text = validateEditableLibraryContent("memory", rawText);
      const memory = getMemoryCatalog(stateStore.getState()).find(
        (candidate) =>
          candidate.id === memoryId && candidate.scope === "global",
      );
      if (!memory) throw new Error(t("runtime.app.globalMemory.missing"));
      const nextState = commitAction({
        type: "memory/update-global",
        memoryId,
        text,
      });
      if (
        getMemoryCatalog(nextState).find(
          (candidate) => candidate.id === memoryId,
        )?.text !== text
      ) {
        throw new Error(t("runtime.app.globalMemory.saveFailed"));
      }
    },
    [commitAction, stateStore, t],
  );

  const createGlobalMemory = useCallback(
    (rawText: string) => {
      const memory: MemoryItem = {
        id: `global-memory-${randomUUID()}`,
        text: validateEditableLibraryContent("memory", rawText),
        scope: "global",
        source: t("library.screen.memory.source.manual"),
        sourceMessage: { key: "library.screen.memory.source.manual" },
        projectIds: [],
        pinned: true,
      };
      const nextState = commitAction({ type: "memory/create-global", memory });
      const accepted = nextState.customGlobalMemories[memory.id];
      if (!accepted)
        throw new Error(t("runtime.app.globalMemory.createFailed"));
      return accepted;
    },
    [commitAction, t],
  );

  const updateGlobalSkill = useCallback(
    (skillId: string, rawContent: string) => {
      const content = validateEditableLibraryContent("skill", rawContent);
      const skill = getSkillCatalog(stateStore.getState(), locale).find(
        (candidate) => candidate.id === skillId && candidate.scope === "global",
      );
      if (!skill) throw new Error(t("runtime.app.globalSkill.missing"));
      const nextState = commitAction({
        type: "skill/update-global",
        skillId,
        content,
      });
      if (
        getSkillCatalog(nextState, locale).find(
          (candidate) => candidate.id === skillId,
        )?.content !== content
      ) {
        throw new Error(t("runtime.app.globalSkill.saveFailed"));
      }
    },
    [commitAction, locale, stateStore, t],
  );

  const probeSshHostKey = useCallback(
    (input: SshEndpointInput) => sshCommandSessions.probeHostKey(input),
    [sshCommandSessions],
  );

  const testSshConnection = useCallback(
    (input: TestSshCommandInput) =>
      sshCommandOperations.run(() => sshCommandSessions.testConnection(input)),
    [sshCommandOperations, sshCommandSessions],
  );

  const createCredential = useCallback(
    async (input: CreateCredentialInput) => {
      const item = await credentialVault.create(input);
      setCredentialVaultItems(await credentialVault.list());
      return item;
    },
    [credentialVault, setCredentialVaultItems],
  );

  const updateCredential = useCallback(
    async (credentialId: string, input: UpdateCredentialInput) => {
      credentialAccessBroker.denyCredential(credentialId);
      const item = await credentialVault.update(credentialId, input);
      setCredentialVaultItems(await credentialVault.list());
      await mcpProxy.closeAll();
      await sshCommandOperations
        .run(() => sshCommandSessions.invalidateCredential(credentialId, false))
        .catch(() =>
          dispatch({
            type: "storage/fail",
            message: t("runtime.app.credential.updatedSshInvalidated"),
          }),
        );
      return item;
    },
    [
      credentialAccessBroker,
      credentialVault,
      dispatch,
      mcpProxy,
      setCredentialVaultItems,
      sshCommandOperations,
      sshCommandSessions,
      t,
    ],
  );

  const removeCredential = useCallback(
    async (credentialId: string) => {
      credentialAccessBroker.denyCredential(credentialId);
      await credentialVault.remove(credentialId);
      setCredentialVaultItems(await credentialVault.list());
      await mcpProxy.closeAll();
      await sshCommandOperations
        .run(() => sshCommandSessions.invalidateCredential(credentialId, true))
        .catch(() =>
          dispatch({
            type: "storage/fail",
            message: t("runtime.app.credential.deletedSshCleanup"),
          }),
        );
    },
    [
      credentialAccessBroker,
      credentialVault,
      dispatch,
      mcpProxy,
      setCredentialVaultItems,
      sshCommandOperations,
      sshCommandSessions,
      t,
    ],
  );

  const createMcpConnection = useCallback(
    async (input: McpConnectionInput) => {
      assertThirdPartyMcpPermitted();
      try {
        const connection = await mcpConnections.create(input);
        setMcpConnectionItems(await mcpConnections.list());
        return connection;
      } catch (error) {
        if (input.authentication.kind === "oauth") {
          await mcpOAuth
            .disconnect(input.authentication.authorizationId)
            .catch(() => undefined);
        }
        throw error;
      }
    },
    [mcpConnections, mcpOAuth, setMcpConnectionItems],
  );

  const authorizeMcpOAuth = useCallback(
    (serverUrl: string) => {
      assertThirdPartyMcpPermitted();
      return mcpOAuth.connect(serverUrl);
    },
    [mcpOAuth],
  );

  const updateMcpConnection = useCallback(
    async (connectionId: string, input: McpConnectionInput) => {
      if (input.enabled) assertThirdPartyMcpPermitted();
      await mcpProxy.closeAll();
      const previous = (await mcpConnections.list()).find(
        (candidate) => candidate.id === connectionId,
      );
      const replacingOAuth =
        previous?.authentication.kind === "oauth" &&
        (input.authentication.kind !== "oauth" ||
          input.authentication.authorizationId !==
            previous.authentication.authorizationId);
      const introducedOAuth =
        input.authentication.kind === "oauth" &&
        (previous?.authentication.kind !== "oauth" ||
          input.authentication.authorizationId !==
            previous.authentication.authorizationId);
      try {
        const connection = await mcpConnections.update(connectionId, input);
        if (replacingOAuth) {
          // An expired or unreachable authorization must not block replacing
          // the local connection with a freshly completed OAuth session.
          await mcpOAuth
            .disconnect(previous.authentication.authorizationId)
            .catch(() => undefined);
        }
        setMcpConnectionItems(await mcpConnections.list());
        return connection;
      } catch (error) {
        if (introducedOAuth && input.authentication.kind === "oauth") {
          await mcpOAuth
            .disconnect(input.authentication.authorizationId)
            .catch(() => undefined);
        }
        setMcpConnectionItems(await mcpConnections.list());
        throw error;
      }
    },
    [mcpConnections, mcpOAuth, mcpProxy, setMcpConnectionItems],
  );

  const removeMcpConnection = useCallback(
    async (connectionId: string) => {
      await mcpProxy.closeAll();
      const connection = (await mcpConnections.list()).find(
        (candidate) => candidate.id === connectionId,
      );
      if (connection?.authentication.kind === "oauth") {
        // Remote revocation is best-effort: an unavailable broker must not
        // make a broken connection impossible to remove from the device.
        await mcpOAuth
          .disconnect(connection.authentication.authorizationId)
          .catch(() => undefined);
      }
      await mcpConnections.remove(connectionId);
      setMcpConnectionItems(await mcpConnections.list());
    },
    [mcpConnections, mcpOAuth, mcpProxy, setMcpConnectionItems],
  );

  const probeMcpConnection = useCallback(
    async (connectionId: string) => {
      assertThirdPartyMcpPermitted();
      const connection = (await mcpConnections.list()).find(
        (candidate) => candidate.id === connectionId,
      );
      if (!connection) throw new Error(t("runtime.app.mcp.notFound"));
      return mcpProxy.execute(GLOBAL_MCP_SCOPE_ID, {
        action: "list",
        serverId: connectionId,
        limit: 50,
        refresh: true,
      });
    },
    [mcpConnections, mcpProxy, t],
  );

  useEffect(() => {
    const service = new ThirdPartyCapabilityService({
      locale,
      createAssessmentId: () => `third-party-assessment-${randomUUID()}`,
      digest: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
      resolveSkill: (url, signal) =>
        directSkillUrlResolver.resolve(url, signal),
      skillAssessment: (capability, projectId) =>
        assessSkillCapability({
          capability,
          connectedMcpServerUrls: sessionStore
            .getState()
            .mcpConnectionItems.filter((item) => item.enabled)
            .map((item) => item.serverUrl),
          locale,
        }),
      skillExists: (projectId, skillId) =>
        Object.values(stateStore.getState().resources).some(
          (resource) =>
            resource.projectId === projectId &&
            resource.path === `skills/${skillId}/SKILL.md`,
        ),
      installSkill: async (capability, projectId) => {
        const installed = await installDownloadedSkill({
          autoUpdate: capability.source.id !== DIRECT_SKILL_SOURCE_ID,
          capability,
          projectId,
        });
        return {
          receiptId: installed.receipt?.id,
          updateTracking: installed.updateTracking,
        };
      },
      listMcpConnections: () => mcpConnections.list(),
      connectMcp: (server, signal) =>
        mcpRemoteClientFactory.connect(server, signal),
      authorizeMcpOAuth,
      disconnectMcpOAuth: (authorizationId) =>
        mcpOAuth.disconnect(authorizationId),
      createMcpConnection,
      probeMcpConnection,
      removeMcpConnection,
    });
    return agentThirdPartyCapabilities.bind(service);
  }, [
    agentThirdPartyCapabilities,
    authorizeMcpOAuth,
    createMcpConnection,
    directSkillUrlResolver,
    installDownloadedSkill,
    locale,
    mcpConnections,
    mcpOAuth,
    mcpRemoteClientFactory,
    probeMcpConnection,
    removeMcpConnection,
    sessionStore,
    stateStore,
  ]);

  useEffect(
    () =>
      agentSkillMarketPublication.bind(
        new ProjectSkillMarketPublicationService({
          client: skillMarketPublication,
          resources: (projectId) =>
            Object.values(stateStore.getState().resources).filter(
              (resource) =>
                resource.projectId === projectId &&
                isProjectWorkspaceResource(resource),
            ),
        }),
      ),
    [agentSkillMarketPublication, skillMarketPublication, stateStore],
  );

  const value = useMemo<AppActionsContextValue>(
    () => ({
      dispatch,
      createProject,
      sendMessage,
      retryRun,
      cancelRun,
      getConversationContextUsage,
      deleteConversation,
      claimConversation,
      applyProposal,
      createProjectFileEditProposal,
      createProjectEntry,
      renameProjectEntry,
      deleteProjectEntry,
      installDownloadedSkill,
      updateDownloadedSkill,
      readProjectFile,
      createProjectPreview,
      updateGlobalMemory,
      updateGlobalSkill,
      createGlobalMemory,
      createProjectMemory,
      createRestoreProposal,
      connectNativeTextDirectory,
      googleWorkspaceAccount,
      authorizeGoogleWorkspace,
      connectGoogleWorkspaceResource,
      connectNotionPage,
      probeSshHostKey,
      testSshConnection,
      createCredential,
      updateCredential,
      removeCredential,
      authorizeMcpOAuth,
      createMcpConnection,
      updateMcpConnection,
      removeMcpConnection,
      probeMcpConnection,
    }),
    [
      applyProposal,
      cancelRun,
      claimConversation,
      connectGoogleWorkspaceResource,
      authorizeGoogleWorkspace,
      googleWorkspaceAccount,
      connectNotionPage,
      connectNativeTextDirectory,
      createProject,
      createGlobalMemory,
      createCredential,
      authorizeMcpOAuth,
      createMcpConnection,
      createProjectFileEditProposal,
      createProjectEntry,
      renameProjectEntry,
      deleteProjectEntry,
      installDownloadedSkill,
      updateDownloadedSkill,
      createProjectMemory,
      createRestoreProposal,
      deleteConversation,
      dispatch,
      getConversationContextUsage,
      probeSshHostKey,
      testSshConnection,
      probeMcpConnection,
      removeMcpConnection,
      removeCredential,
      readProjectFile,
      createProjectPreview,
      retryRun,
      sendMessage,
      updateCredential,
      updateMcpConnection,
      updateGlobalMemory,
      updateGlobalSkill,
    ],
  );

  return (
    <MobileStoreRegistryContext.Provider value={storeRegistry}>
      <AppActionsContext.Provider value={value}>
        {isHydrating ? (
          <View
            style={{
              alignItems: "center",
              flex: 1,
              justifyContent: "center",
            }}
          >
            <LoadingIndicator
              accessibilityLabel={t("runtime.app.hydration.loading")}
              palette={palette}
              style={{ flex: 1 }}
              variant="screen"
            />
          </View>
        ) : (
          children
        )}
        <ApprovalOverlays
          aiDataConsentBroker={aiDataConsentBroker}
          credentialAccessBroker={credentialAccessBroker}
          deviceCapabilityAccessBroker={deviceCapabilityAccessBroker}
          mcpToolApprovalBroker={mcpToolApprovalBroker}
          store={approvalStore}
        />
      </AppActionsContext.Provider>
    </MobileStoreRegistryContext.Provider>
  );
}

export function useAppActions() {
  const value = useContext(AppActionsContext);
  if (!value) {
    throw new Error("useAppActions must be used inside AppProvider");
  }
  return value;
}

function useMobileStoreRegistry() {
  const registry = useContext(MobileStoreRegistryContext);
  if (!registry) {
    throw new Error("Store hooks must be used inside AppProvider");
  }
  return registry;
}

export function useAppStateSnapshot() {
  const store = useMobileStoreRegistry().app;
  return useCallback(() => store.getState(), [store]);
}

export function useAppStateSelector<Selection>(
  selector: (state: AppState) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean = Object.is,
) {
  const store = useMobileStoreRegistry().app;
  const selectionStore = useMemo(
    () => createAppStateSelection(store, selector, isEqual),
    [isEqual, selector, store],
  );
  return useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getSnapshot,
  );
}

export function useSessionStateSelector<Selection>(
  selector: (state: SessionState) => Selection,
) {
  return useStore(useMobileStoreRegistry().session, selector);
}

export function shallowEqualAppStateSelection<
  Selection extends Readonly<Record<string, unknown>>,
>(left: Selection, right: Selection) {
  if (Object.is(left, right)) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.hasOwn(right, key) &&
      Object.is(left[key as keyof Selection], right[key as keyof Selection]),
  );
}
