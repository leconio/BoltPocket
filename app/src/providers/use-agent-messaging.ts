import type { MutableRefObject } from "react";
import { useCallback } from "react";
import { useRouter } from "expo-router";

import type {
  ActiveAgentRunRegistry,
  LiveAgentRun,
} from "@/application/active-agent-runs";
import {
  mergeAuthorizedProjectResources,
  mergeProjectConnections,
} from "@/application/agent-run-document-scope";
import { AGENT_TEXT_LIMITS, boundText } from "@/application/bounded-text";
import { AgentExecutionActivityBuilder } from "@/application/agent-execution-activity";
import { createRunInactivityTimeout } from "@/application/run-inactivity-timeout";
import { partialAssistantMessageFromLiveOutput } from "@/application/live-agent-output";
import { appendTextFileAttachmentsToPrompt } from "@/application/chat-file-attachment";
import {
  resolveProjectWorkspaceContext,
  resolveUnboundWorkspaceContext,
} from "@/application/project-workspace-context";
import { hydrateProtectedMarketSkillsForRun } from "@/application/protected-market-skills";
import {
  toAssistantMessage,
  type AgentRunEvent,
} from "@/application/ports/agent-runtime";
import {
  getMemoryCatalog,
  getSkillCatalog,
  type AppAction,
  type AppState,
} from "@/domain/app-state";
import type {
  ChangeReceipt,
  ChatMessage,
  ConnectionItem,
  RetryableAgentRun,
  WorkspaceResource,
} from "@/domain/models";
import { loadImageAttachmentsForAgent } from "@/infrastructure/media/expo-image-attachment-loader";
import { isImageAttachment, isTextFileAttachment } from "@/domain/models";
import { summarizeProjectConnections } from "@/domain/google-workspace-connections";
import { isProjectWorkspaceConnectionId } from "@/domain/project-workspace";
import {
  enabledProjectResourcePacks,
  filterSkillsForEnabledProjectResources,
  projectResourceSkillId,
} from "@/domain/builtin-project-resources";
import { captureConversationSecrets } from "@/infrastructure/security/conversation-secret-capture";
import { findPublicGitHubRepositoryUrl } from "@/infrastructure/sources/public-github-source";
import { findSupportedDocumentLinks } from "@/infrastructure/connectors/document-link";
import { AgentPerformanceProbe } from "@/infrastructure/diagnostics/agent-performance";
import {
  cloudDocumentConnectorsEnabled,
  loadComplianceConfig,
} from "@/config/compliance";
import { localizedErrorMessage } from "@/i18n/translate";
import { useI18n } from "@/i18n/i18n-provider";
import {
  connectorDocumentSkillsForRun,
  mergeRunSkills,
  type PromptDocumentSkillBinding,
} from "@/infrastructure/connectors/document-connector-skills";
import type { CredentialVaultItem } from "@/application/ports/credential-vault";
import {
  loadModelRuntimeConfig,
  loadModelRuntimeConfigByProfile,
} from "@/infrastructure/model-config";
import {
  aiDataCategoriesForMessage,
  requestModelDataConsent,
} from "@/infrastructure/privacy/model-data-consent";
import { useAppServices } from "@/providers/runtime-services-provider";

type SendMessageOptions = {
  request: RetryableAgentRun;
  appendUserMessage: boolean;
};

type ApplyProposal = (
  proposalId: string,
  acceptedHunkIds?: readonly string[],
) => Promise<ChangeReceipt>;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAgentMessaging({
  activeRunsRef,
  applyProposalRef,
  dispatch,
  ensureConversationProject,
  flushPersistence,
  persistenceReady,
  setCredentialVaultItems,
  getState,
}: {
  activeRunsRef: MutableRefObject<ActiveAgentRunRegistry>;
  applyProposalRef: MutableRefObject<ApplyProposal | null>;
  dispatch: (action: AppAction) => void;
  ensureConversationProject: (conversationId: string) => string;
  flushPersistence: () => Promise<void>;
  persistenceReady: MutableRefObject<boolean>;
  setCredentialVaultItems: (items: CredentialVaultItem[]) => void;
  getState: () => AppState;
}) {
  const {
    aiDataConsentBroker,
    agentBackgroundExecution,
    agentRunTimeoutMs,
    agentRuntime,
    capabilityCatalogRegion,
    credentialVault,
    downloadedSkills,
    nativeTextConnections,
    liveAgentOutput,
    googleDocsConnections,
    googleDocsAuthorization,
    googleSheetsConnections,
    googleSlidesConnections,
    modelSafetyPolicy,
    mcpConnections,
    projectSourceSnapshots,
    notionConnections,
    protectedMarketSkills,
    skillMarket,
    skillMarketPublisherBlocklist,
    sshCommandOperations,
    sshCommandSessions,
  } = useAppServices();
  const { locale, t } = useI18n();
  const router = useRouter();
  const clearLiveOutputAfterStateCommit = useCallback(
    (conversationId: string, runId: string) => {
      setTimeout(() => liveAgentOutput.clear(conversationId, runId), 0);
    },
    [liveAgentOutput],
  );
  const cancelRun = useCallback(() => {
    const conversationId = getState().activeConversationId;
    const liveSnapshot = liveAgentOutput.snapshot(conversationId);
    const run = activeRunsRef.current.abort(conversationId, "cancelled");
    if (!run) return;
    const cancelledAt = Date.now();
    activeRunsRef.current.release(conversationId, run.controller);
    dispatch({
      type: "run/cancel",
      runId: run.runId,
      conversationId,
      partialMessage: partialAssistantMessageFromLiveOutput(
        liveSnapshot,
        "cancelled",
        cancelledAt,
      ),
      cancelledAt: new Date(cancelledAt).toISOString(),
    });
    clearLiveOutputAfterStateCommit(conversationId, run.runId);
    void agentBackgroundExecution
      .syncActiveConversations(activeRunsRef.current.conversationIds())
      .catch(() => undefined);
  }, [
    activeRunsRef,
    agentBackgroundExecution,
    clearLiveOutputAfterStateCommit,
    dispatch,
    getState,
    liveAgentOutput,
  ]);

  const sendMessage = useCallback(
    async (rawContent: string, options?: SendMessageOptions) => {
      const snapshot = getState();
      if (snapshot.isHydrating) return;
      const cloudDocumentsEnabled = cloudDocumentConnectorsEnabled(
        loadComplianceConfig(),
      );
      const attachments = [
        ...(options?.request.attachments ?? snapshot.draftAttachments),
      ];
      const imageAttachments = attachments.filter(isImageAttachment);
      const textFileAttachments = attachments.filter(isTextFileAttachment);
      let content =
        rawContent.trim() ||
        (attachments.length > 0
          ? t("runtime.messaging.attachment.defaultPrompt")
          : "");
      if (!content) return;
      const conversationId =
        options?.request.conversationId ?? snapshot.activeConversationId;
      if (
        !Object.hasOwn(snapshot.conversationProjectIds, conversationId) ||
        !Object.hasOwn(snapshot.messagesByConversation, conversationId)
      ) {
        return;
      }
      if (
        snapshot.autoApplyingProposalIds.some(
          (proposalId) =>
            snapshot.proposals[proposalId]?.conversationId === conversationId,
        )
      ) {
        return;
      }
      let messageProjectId = Object.hasOwn(
        snapshot.conversationProjectIds,
        conversationId,
      )
        ? (snapshot.conversationProjectIds[conversationId] ?? null)
        : null;
      const existingRun = activeRunsRef.current.get(conversationId);
      const pendingDocumentLinks = cloudDocumentsEnabled
        ? findSupportedDocumentLinks(content)
        : [];
      if (
        !existingRun &&
        !messageProjectId &&
        pendingDocumentLinks.length > 0
      ) {
        messageProjectId = ensureConversationProject(conversationId);
      }
      if (
        !existingRun &&
        messageProjectId &&
        pendingDocumentLinks.some((link) => link.provider !== "notion")
      ) {
        const googleSession = await googleDocsAuthorization
          .restore()
          .catch(() => null);
        if (!googleSession) {
          router.push({
            pathname: "/connections/google-docs",
            params: {
              projectId: messageProjectId,
              resumeConversationId: conversationId,
            },
          });
          return;
        }
      }
      const selectedModelProfileId =
        snapshot.conversationModelProfileIds[conversationId];
      const modelConfig = selectedModelProfileId
        ? await loadModelRuntimeConfigByProfile(selectedModelProfileId)
        : await loadModelRuntimeConfig();
      const categories = aiDataCategoriesForMessage({
        hasAttachments: attachments.length > 0,
        hasProjectContext: Boolean(messageProjectId),
        hasPendingDocumentLinks: pendingDocumentLinks.length > 0,
        hasConnectedDocuments: Boolean(
          messageProjectId &&
          Object.values(snapshot.resources).some(
            (resource) =>
              resource.projectId === messageProjectId &&
              [
                "google-doc",
                "google-sheet",
                "google-slide",
                "notion-page",
              ].includes(resource.storage.kind),
          ),
        ),
      });
      if (existingRun && options) return;
      // The native background host is started before the reducer publishes the
      // run. Ignore a second tap during that short window instead of treating
      // it as steering a session that does not exist yet.
      if (
        existingRun &&
        snapshot.activeRunsByConversation[conversationId]?.runId !==
          existingRun.runId
      ) {
        return;
      }
      const reservedRun: LiveAgentRun | null = existingRun
        ? null
        : {
            runId: createId("run"),
            conversationId,
            controller: new AbortController(),
            termination: null,
          };
      if (reservedRun) {
        const reservation = activeRunsRef.current.reserve(reservedRun);
        if (!reservation.accepted) {
          dispatch(
            reservation.reason === "capacity"
              ? { type: "run/capacity-rejected", conversationId }
              : {
                  type: "run/rejected",
                  conversationId,
                  message: t("runtime.messaging.run.alreadyRunning"),
                },
          );
          return;
        }
        // Start native protection before publishing the run, but do not await
        // it: iOS grants background time opportunistically and some native
        // hosts resolve start only after their service is fully attached. A
        // foreground conversation must remain usable while that happens.
        void agentBackgroundExecution
          .syncActiveConversations(activeRunsRef.current.conversationIds())
          .catch(() => undefined);
      }
      const releaseReservation = () => {
        if (!reservedRun) return;
        activeRunsRef.current.release(conversationId, reservedRun.controller);
        void agentBackgroundExecution
          .syncActiveConversations(activeRunsRef.current.conversationIds())
          .catch(() => undefined);
      };
      const captured = captureConversationSecrets(content, locale);
      if (captured.captures.length > 0) {
        const created: CredentialVaultItem[] = [];
        try {
          const duplicateLabels = new Map<string, number>();
          for (const capture of captured.captures) {
            const occurrence = (duplicateLabels.get(capture.label) ?? 0) + 1;
            duplicateLabels.set(capture.label, occurrence);
            created.push(
              await credentialVault.create({
                label: `${capture.label}${occurrence > 1 ? ` ${occurrence}` : ""}`,
                kind: capture.kind,
                ...(capture.kind === "ssh" && capture.secret.kind === "ssh"
                  ? { sshAuthentication: capture.secret.authentication }
                  : {}),
                ...(capture.kind === "api-token"
                  ? { apiAuthentication: "bearer" as const }
                  : {}),
                projectIds: messageProjectId ? [messageProjectId] : [],
                source: "conversation",
                secret: capture.secret,
              }),
            );
          }
          content = captured.redactedContent;
          setCredentialVaultItems(await credentialVault.list());
        } catch {
          for (const item of created) {
            await credentialVault.remove(item.id).catch(() => undefined);
          }
          dispatch({
            type: "storage/fail",
            message: t("runtime.messaging.credential.saveFailed"),
          });
          releaseReservation();
          return;
        }
      }
      const agentPrompt = appendTextFileAttachmentsToPrompt(
        content,
        textFileAttachments,
      );

      if (existingRun) {
        try {
          await modelSafetyPolicy.assertAllowed(
            modelConfig,
            existingRun.controller.signal,
          );
          const consented = await requestModelDataConsent(
            aiDataConsentBroker,
            modelConfig,
            categories,
            existingRun.controller.signal,
          );
          if (!consented) return;
          const runtimeImageAttachments =
            await loadImageAttachmentsForAgent(imageAttachments);
          await agentRuntime.steer(
            conversationId,
            agentPrompt,
            runtimeImageAttachments,
          );
          dispatch({
            type: "run/steer-queued",
            runId: existingRun.runId,
            conversationId,
            message: {
              id: createId("user-steer"),
              role: "user",
              content,
              attachments,
            },
          });
          liveAgentOutput.update(conversationId, existingRun.runId, {
            status: t("runtime.messaging.steer.queued"),
          });
        } catch (error) {
          liveAgentOutput.update(conversationId, existingRun.runId, {
            status: t("runtime.messaging.steer.failed", {
              error: localizedErrorMessage(
                error,
                t("runtime.messaging.steer.retry"),
              ),
            }),
          });
        }
        return;
      }

      if (!reservedRun) return;
      const { runId, controller } = reservedRun;
      let terminalDispatched = false;
      let performanceProbe: AgentPerformanceProbe | undefined;
      let performanceOutcome: "completed" | "failed" | "cancelled" = "failed";
      const runStartedAt = Date.now();
      const liveActivity = new AgentExecutionActivityBuilder();
      const request: RetryableAgentRun = options?.request
        ? { ...options.request, content, retryReason: "failed" }
        : {
            conversationId,
            content,
            attachments,
            requiresAttachmentReselection: false,
            retryReason: "failed",
          };
      const userMessage: ChatMessage | undefined =
        options?.appendUserMessage === false
          ? undefined
          : {
              id: `user-${runId}`,
              role: "user",
              content,
              attachments,
            };
      const partialAssistantMessage = (
        status: "failed" | "cancelled" | "interrupted",
        unfinishedToolStatus: "failed" | "cancelled",
      ): ChatMessage | undefined => {
        const activity = liveActivity.finish({ unfinishedToolStatus });
        if (activity.length === 0) return undefined;
        return {
          id: `assistant-${runId}-partial`,
          role: "assistant",
          content: "",
          execution: {
            status,
            durationMs: Math.max(0, Date.now() - runStartedAt),
            activity,
          },
        };
      };
      const releaseLiveRun = () => {
        const released = activeRunsRef.current.release(
          conversationId,
          controller,
        );
        if (!released) return;
        void agentBackgroundExecution
          .syncActiveConversations(activeRunsRef.current.conversationIds())
          .catch(() => undefined);
      };
      const finishAbortedRun = () => {
        if (terminalDispatched) return;
        terminalDispatched = true;
        performanceOutcome =
          reservedRun.termination === "timeout" ? "failed" : "cancelled";
        if (reservedRun.termination === "timeout") {
          dispatch({
            type: "run/fail",
            runId,
            conversationId,
            message: t("runtime.messaging.run.timeout"),
            partialMessage: partialAssistantMessage("failed", "failed"),
            failedAt: new Date().toISOString(),
          });
        } else if (reservedRun.termination === "interrupted") {
          dispatch({
            type: "run/interrupted",
            runId,
            conversationId,
            partialMessage: partialAssistantMessage("interrupted", "cancelled"),
            interruptedAt: new Date().toISOString(),
          });
        } else {
          dispatch({
            type: "run/cancel",
            runId,
            conversationId,
            partialMessage: partialAssistantMessage("cancelled", "cancelled"),
            cancelledAt: new Date().toISOString(),
          });
        }
        clearLiveOutputAfterStateCommit(conversationId, runId);
        releaseLiveRun();
      };
      const runInactivityTimeout = createRunInactivityTimeout({
        timeoutMs: agentRunTimeoutMs,
        onTimeout: () => {
          if (controller.signal.aborted) return;
          reservedRun.termination = "timeout";
          controller.abort();
          finishAbortedRun();
        },
      });
      liveAgentOutput.start(
        conversationId,
        runId,
        t("runtime.messaging.status.connecting"),
        runStartedAt,
      );
      dispatch({
        type: "run/start",
        runId,
        conversationId,
        ...(userMessage ? { message: userMessage } : {}),
        request,
      });
      if (
        getState().activeRunsByConversation[conversationId]?.runId !== runId
      ) {
        liveAgentOutput.clear(conversationId, runId);
        releaseLiveRun();
        dispatch({
          type: "run/rejected",
          conversationId,
          message: t("runtime.messaging.run.stateChanged"),
        });
        return;
      }
      performanceProbe = new AgentPerformanceProbe();
      runInactivityTimeout.touch();

      try {
        await modelSafetyPolicy.assertAllowed(modelConfig, controller.signal);
        const consented = await requestModelDataConsent(
          aiDataConsentBroker,
          modelConfig,
          categories,
          controller.signal,
        );
        if (!consented) {
          terminalDispatched = true;
          performanceOutcome = "cancelled";
          dispatch({
            type: "run/cancel",
            runId,
            conversationId,
            cancelledAt: new Date().toISOString(),
          });
          clearLiveOutputAfterStateCommit(conversationId, runId);
          return;
        }
        try {
          if (persistenceReady.current) await flushPersistence();
        } catch {
          terminalDispatched = true;
          dispatch({
            type: "run/fail",
            runId,
            conversationId,
            message: t("runtime.messaging.persistence.startFailed"),
            failedAt: new Date().toISOString(),
          });
          clearLiveOutputAfterStateCommit(conversationId, runId);
          return;
        }
        if (controller.signal.aborted) {
          finishAbortedRun();
          return;
        }
        const originatingProjectId = messageProjectId;
        const baseProject = originatingProjectId
          ? (getState().projects[originatingProjectId] ?? null)
          : null;
        const documentLinks = pendingDocumentLinks;
        if (documentLinks.length > 0 && !baseProject) {
          throw new Error(t("runtime.messaging.connection.projectRequired"));
        }
        const newlyAuthorizedConnections: ConnectionItem[] = [];
        const newlyAuthorizedResources: WorkspaceResource[] = [];
        const documentSkillBindings: PromptDocumentSkillBinding[] = [];
        for (const link of documentLinks) {
          const googleLabels = {
            "google-docs": t("runtime.messaging.connection.googleDocs"),
            "google-sheets": t("runtime.messaging.connection.googleSheets"),
            "google-slides": t("runtime.messaging.connection.googleSlides"),
          } as const;
          liveAgentOutput.update(conversationId, runId, {
            status:
              link.provider === "notion"
                ? t("runtime.messaging.connection.notion")
                : googleLabels[link.provider],
          });
          const bundle =
            link.provider === "google-docs"
              ? await googleDocsConnections.connect(baseProject!, link.url)
              : link.provider === "google-sheets"
                ? await googleSheetsConnections.connect(baseProject!, link.url)
                : link.provider === "google-slides"
                  ? await googleSlidesConnections.connect(
                      baseProject!,
                      link.url,
                    )
                  : await notionConnections.connect(baseProject!, link.url);
          if (!bundle) {
            throw new Error(
              t("runtime.messaging.connection.authorizationCancelled"),
            );
          }
          const focusedResourceId = bundle.focusedResourceId;
          if (
            !focusedResourceId ||
            !bundle.resources.some(
              (resource) =>
                resource.id === focusedResourceId &&
                resource.connectionId === bundle.connection.id &&
                resource.projectId === baseProject!.id,
            )
          ) {
            throw new Error(t("runtime.messaging.connection.bindingFailed"));
          }
          documentSkillBindings.push({
            ...link,
            connectorId: bundle.connection.id,
            resourceId: focusedResourceId,
          });
          newlyAuthorizedConnections.push(bundle.connection);
          newlyAuthorizedResources.push(...bundle.resources);
          dispatch({ type: "connection/upsert", ...bundle });
        }
        const publicRepository = findPublicGitHubRepositoryUrl(content);
        const githubMcpConfigured = publicRepository
          ? (await mcpConnections.list()).some(
              (connection) =>
                connection.enabled &&
                `${connection.name} ${connection.serverUrl}`
                  .toLocaleLowerCase("en-US")
                  .includes("github"),
            )
          : false;
        if (publicRepository && !githubMcpConfigured && baseProject) {
          try {
            const imported = await projectSourceSnapshots.importSource({
              project: baseProject,
              source: {
                kind: "github-public",
                url: publicRepository.url,
              },
              locale,
              signal: controller.signal,
              onProgress(progress) {
                runInactivityTimeout.touch();
                const status = {
                  inspect: t("runtime.messaging.source.inspect"),
                  acquire: t("runtime.messaging.source.acquire"),
                  extract: t("runtime.messaging.source.extract"),
                  store: t("runtime.messaging.source.store"),
                }[progress];
                liveAgentOutput.update(conversationId, runId, {
                  status,
                });
              },
            });
            for (const bundle of imported.bundles) {
              dispatch({ type: "connection/upsert", ...bundle });
            }
            liveAgentOutput.update(conversationId, runId, {
              status: imported.cached
                ? t("runtime.messaging.source.cached", {
                    source: imported.sourceLabel,
                    version: imported.versionLabel,
                  })
                : t("runtime.messaging.source.imported", {
                    source: imported.sourceLabel,
                    version: imported.versionLabel,
                  }),
            });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            liveAgentOutput.update(conversationId, runId, {
              status: t("runtime.messaging.source.fallback"),
            });
          }
        }
        const authorizedResourceIds = new Set(
          [...Object.values(getState().resources), ...newlyAuthorizedResources]
            .filter((resource) => resource.projectId === originatingProjectId)
            .map((resource) => resource.id),
        );
        const startedWithSsh = Boolean(
          originatingProjectId &&
          sshCommandSessions.activeForProject(originatingProjectId).length > 0,
        );
        const executeRun = async () => {
          if (controller.signal.aborted) {
            finishAbortedRun();
            return;
          }
          const scopedResources = resourcesPermittedForDistribution(
            baseProject
              ? mergeAuthorizedProjectResources({
                  current: Object.values(getState().resources),
                  justConnected: newlyAuthorizedResources,
                  projectId: baseProject.id,
                  authorizedResourceIds,
                })
              : [],
            cloudDocumentsEnabled,
          );
          const refreshedResources =
            await nativeTextConnections.refresh(scopedResources);
          if (refreshedResources.length > 0) {
            dispatch({
              type: "resources/refreshed",
              resources: refreshedResources,
            });
          }
          const memoryCatalog = getMemoryCatalog(getState());
          const skillCatalog = getSkillCatalog(getState(), locale);
          const resolvedWorkspaceContext = baseProject
            ? resolveProjectWorkspaceContext({
                project: baseProject,
                resources: refreshedResources,
                memories: memoryCatalog,
                skills: skillCatalog,
                enabledById: getState().skillEnabledById,
                projectEnabledById:
                  getState().projectSkillEnabledByProjectId[baseProject.id],
              })
            : resolveUnboundWorkspaceContext({
                memories: memoryCatalog,
                skills: skillCatalog,
                enabledById: getState().skillEnabledById,
              });
          const protectedHydration = baseProject
            ? await hydrateProtectedMarketSkillsForRun({
                authorize: async (download) => {
                  const [detail, status] = await Promise.all([
                    skillMarket.loadDetail(
                      download.catalogId,
                      capabilityCatalogRegion,
                    ),
                    skillMarket.checkExecution(
                      download.catalogId,
                      download.revision,
                      download.sha256,
                      capabilityCatalogRegion,
                    ),
                  ]);
                  if (
                    detail.summary.id !== download.catalogId ||
                    (await skillMarketPublisherBlocklist.isBlocked(
                      detail.summary.publisherId,
                    ))
                  ) {
                    throw new Error("This Skill publisher is blocked.");
                  }
                  if (!status.allowed) {
                    throw new Error(
                      "This Skill version is no longer available.",
                    );
                  }
                },
                downloads: await downloadedSkills.list(),
                repository: protectedMarketSkills,
                skills: resolvedWorkspaceContext.skills,
              })
            : {
                protectedSkillCount: 0,
                protectedSkillIds: [] as string[],
                skills: resolvedWorkspaceContext.skills,
              };
          const workspaceContext = {
            ...resolvedWorkspaceContext,
            skills: protectedHydration.skills,
          };
          const runConnections =
            baseProject && cloudDocumentsEnabled
              ? mergeProjectConnections({
                  current: Object.values(getState().connections),
                  justConnected: newlyAuthorizedConnections,
                  projectId: baseProject.id,
                })
              : [];
          const connectorSkills =
            baseProject && cloudDocumentsEnabled
              ? connectorDocumentSkillsForRun({
                  projectId: baseProject.id,
                  connections: runConnections,
                  bindings: documentSkillBindings,
                })
              : [];
          const enabledResourcePacks = baseProject
            ? enabledProjectResourcePacks(
                getState().projectResourcePackEnabledByProjectId,
                baseProject.id,
              )
            : [];
          const runSkills = mergeRunSkills(
            filterSkillsForEnabledProjectResources(
              workspaceContext?.skills ?? [],
              enabledResourcePacks.map((pack) => pack.id),
            ),
            connectorSkills,
          );
          const project = baseProject
            ? {
                ...baseProject,
                instructions:
                  workspaceContext?.instructions ?? baseProject.instructions,
                memoryCount: workspaceContext?.memories.length ?? 0,
                skillCount: runSkills.length,
                connectionCount: cloudDocumentsEnabled
                  ? summarizeProjectConnections(
                      Object.values(getState().connections).filter(
                        (connection) =>
                          !isProjectWorkspaceConnectionId(connection.id),
                      ),
                      baseProject.id,
                    ).length
                  : 0,
                resourceCount: refreshedResources.length,
              }
            : null;
          const onRunEvent = (event: AgentRunEvent) => {
            if (controller.signal.aborted) return;
            runInactivityTimeout.touch();
            if (event.type === "model-activity") {
              performanceProbe?.recordModelDelta(0);
              return;
            }
            if (event.type === "assistant-text") {
              liveActivity.appendText(event.content);
              liveAgentOutput.update(conversationId, runId, {
                activity: liveActivity.snapshot(),
              });
              performanceProbe?.recordUiFlush();
              return;
            }
            if (event.type === "collaboration-updated") {
              liveAgentOutput.updateCollaboration(
                conversationId,
                runId,
                event.task,
              );
              return;
            }
            if (event.type === "tool-started") {
              performanceProbe?.recordToolEvent();
              liveActivity.startTool(event.toolCallId, event.label);
            } else if (event.type === "tool-completed") {
              performanceProbe?.recordToolEvent();
              liveActivity.completeTool(
                event.toolCallId,
                event.label,
                event.outcome,
                Date.now(),
                event.failureReason,
              );
            } else if (event.type === "context-maintenance") {
              if (event.phase === "started") {
                liveActivity.startContextMaintenance(event.operation);
              } else {
                liveActivity.completeContextMaintenance(
                  event.operation,
                  event.phase,
                  event.tokensBefore,
                  event.tokensAfter,
                );
              }
            }
            liveAgentOutput.update(conversationId, runId, {
              activity: liveActivity.snapshot(),
              status: boundText(
                event.type === "status" || event.type === "context-maintenance"
                  ? event.label
                  : event.type === "tool-started"
                    ? event.label
                    : t("runtime.messaging.tool.status", {
                        label: event.label,
                        outcome: t(
                          event.outcome === "failed"
                            ? "runtime.messaging.tool.failed"
                            : event.outcome === "staged"
                              ? "runtime.messaging.tool.staged"
                              : "runtime.messaging.tool.complete",
                        ),
                      }),
                AGENT_TEXT_LIMITS.statusCharacters,
              ),
            });
            performanceProbe?.recordUiFlush();
          };
          let output;
          try {
            output = await agentRuntime.run(
              {
                runId,
                conversationId,
                modelProfileId:
                  getState().conversationModelProfileIds[conversationId],
                prompt: agentPrompt,
                project,
                memories: workspaceContext?.memories ?? [],
                skills: runSkills,
                protectedSkillIds: protectedHydration.protectedSkillIds,
                resources: refreshedResources,
                resourcePacks: baseProject
                  ? enabledResourcePacks.map((pack) => ({
                      id: pack.id,
                      skillId: projectResourceSkillId(pack.id),
                      name: pack.name,
                      description: pack.description,
                      version: pack.version,
                      license: pack.license,
                      fileCount: pack.files.length,
                    }))
                  : [],
                connections: runConnections,
                attachments:
                  await loadImageAttachmentsForAgent(imageAttachments),
              },
              controller.signal,
              onRunEvent,
            );
          } finally {
            if (protectedHydration.protectedSkillCount > 0) {
              await agentRuntime.releaseConversationResources(conversationId);
            }
          }
          runInactivityTimeout.cancel();
          if (controller.signal.aborted) {
            finishAbortedRun();
            return;
          }
          performanceProbe?.recordModelDelta(output.content.length);
          const completedActivity = output.activity?.length
            ? output.activity
            : liveActivity.finish();
          dispatch({
            type: "run/complete",
            runId,
            conversationId,
            message: toAssistantMessage(
              runId,
              {
                ...output,
                ...(completedActivity.length
                  ? { activity: completedActivity }
                  : {}),
              },
              {
                status: "completed",
                durationMs: Math.max(0, Date.now() - runStartedAt),
              },
            ),
            proposal: output.proposal
              ? {
                  ...output.proposal,
                  conversationId,
                }
              : undefined,
          });
          clearLiveOutputAfterStateCommit(conversationId, runId);
          terminalDispatched = true;
          if (output.proposal) {
            dispatch({
              type: "proposal/auto-apply-start",
              proposalId: output.proposal.id,
            });
            try {
              const apply = applyProposalRef.current;
              if (!apply) {
                throw new Error(
                  t("runtime.messaging.proposal.executorUnavailable"),
                );
              }
              await apply(output.proposal.id);
            } catch (error) {
              const applied =
                getState().proposals[output.proposal.id]?.status === "applied";
              dispatch({
                type: "proposal/auto-apply-failed",
                proposalId: output.proposal.id,
                message: applied
                  ? localizedErrorMessage(
                      error,
                      t("runtime.messaging.proposal.appliedReceiptFailed"),
                    )
                  : t("runtime.messaging.proposal.autoApplyFailed"),
              });
            }
          }
          // Keep the native background lease until the final conversation
          // state (and any automatic apply result) is durably queued. The
          // outer finally still releases the lease if persistence fails.
          if (persistenceReady.current) await flushPersistence();
          performanceOutcome = "completed";
          releaseLiveRun();
        };
        if (startedWithSsh) {
          await sshCommandOperations.run(executeRun, controller.signal);
        } else {
          await executeRun();
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          finishAbortedRun();
        } else {
          terminalDispatched = true;
          dispatch({
            type: "run/fail",
            runId,
            conversationId,
            message: localizedErrorMessage(
              error,
              t("runtime.messaging.run.failed"),
            ),
            partialMessage: partialAssistantMessage("failed", "failed"),
            failedAt: new Date().toISOString(),
          });
          clearLiveOutputAfterStateCommit(conversationId, runId);
        }
      } finally {
        runInactivityTimeout.cancel();
        performanceProbe?.finish(performanceOutcome);
        releaseLiveRun();
      }
    },
    [
      activeRunsRef,
      agentBackgroundExecution,
      agentRunTimeoutMs,
      agentRuntime,
      aiDataConsentBroker,
      applyProposalRef,
      capabilityCatalogRegion,
      clearLiveOutputAfterStateCommit,
      credentialVault,
      dispatch,
      downloadedSkills,
      ensureConversationProject,
      flushPersistence,
      googleDocsAuthorization,
      googleDocsConnections,
      googleSheetsConnections,
      googleSlidesConnections,
      liveAgentOutput,
      locale,
      mcpConnections,
      modelSafetyPolicy,
      nativeTextConnections,
      notionConnections,
      persistenceReady,
      projectSourceSnapshots,
      protectedMarketSkills,
      skillMarket,
      skillMarketPublisherBlocklist,
      setCredentialVaultItems,
      getState,
      router,
      sshCommandOperations,
      sshCommandSessions,
      t,
    ],
  );

  const retryRun = useCallback(async () => {
    const snapshot = getState();
    const retryable = snapshot.retryableRun;
    if (
      !retryable ||
      snapshot.isRunning ||
      retryable.conversationId !== snapshot.activeConversationId
    ) {
      return;
    }
    if (retryable.requiresAttachmentReselection) {
      dispatch({ type: "draft/change", value: retryable.content });
      dispatch({
        type: "run/retry-dismiss",
        conversationId: retryable.conversationId,
      });
      return;
    }
    await sendMessage(retryable.content, {
      request: retryable,
      appendUserMessage: false,
    });
  }, [dispatch, getState, sendMessage]);

  return { cancelRun, retryRun, sendMessage };
}
const CLOUD_DOCUMENT_STORAGE_KINDS = new Set([
  "google-doc",
  "google-sheet",
  "google-slide",
  "notion-page",
]);

function resourcesPermittedForDistribution(
  resources: readonly WorkspaceResource[],
  cloudDocumentsEnabled: boolean,
) {
  return cloudDocumentsEnabled
    ? [...resources]
    : resources.filter(
        (resource) => !CLOUD_DOCUMENT_STORAGE_KINDS.has(resource.storage.kind),
      );
}
