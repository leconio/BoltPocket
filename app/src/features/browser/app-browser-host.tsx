import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, type Href } from "expo-router";
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";

import type { AppState as BoltPocketAppState } from "@/domain/app-state";
import { useI18n } from "@/i18n/i18n-provider";
import { useAppStateSelector } from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";
import { downloadBrowserFile } from "@/infrastructure/browser/browser-download";
import {
  appBrowserControlBridge,
  type BrowserControlDriverStatus,
} from "@/infrastructure/browser/browser-control-bridge";
import {
  browserDisplayHost,
  isAgentSafeBrowserUrl,
  normalizeBrowserUrl,
} from "@/infrastructure/browser/browser-url";
import {
  BROWSER_WEBVIEW_ORIGIN_WHITELIST,
  browserExternalDestination,
  browserNavigationDecision,
  isExternalAppUrl,
  shouldPromptForExternalApp,
} from "@/infrastructure/browser/browser-navigation-policy";
import { createIosSafariUserAgent } from "@/infrastructure/browser/browser-user-agent";
import {
  parseBrowserPageFindResult,
  parseBrowserPageInteractionReceipt,
  parseBrowserPageSnapshot,
  parseBrowserPageTextChunk,
} from "@/infrastructure/browser/browser-page-snapshot";
import {
  AGENT_READ_ONLY_INTERACTION_GUARD_SCRIPT,
  BROWSER_PAGE_BRIDGE_SCRIPT,
  createBrowserClickScript,
  createBrowserFindTextScript,
  createBrowserHighlightScript,
  createBrowserLocationWatchEventScript,
  createBrowserNativeResponseScript,
  createBrowserReadTextScript,
  createBrowserScrollScript,
  createBrowserSnapshotScript,
  createBrowserTypeScript,
  parseBrowserWebViewMessage,
  type BrowserNativeWebApiRequest,
} from "@/infrastructure/browser/browser-webview-protocol";
import {
  createBrowserCapabilityGuardScript,
  createBrowserCapabilityUpdateScript,
  createBrowserPageLifecycleScript,
  shouldEnableBrowserNativeBridge,
} from "@/infrastructure/browser/browser-native-capabilities";
import {
  browserNativeBarcodeFormats,
  browserNativeWebApi,
  type BrowserLocationSubscription,
} from "@/infrastructure/browser/browser-native-web-api";
import type { BrowserPermissionName } from "@/infrastructure/browser/browser-native-web-api-model";
import {
  projectPreviewBrowserSettings,
  READ_ONLY_AGENT_BROWSER_SETTINGS,
  type BrowserSettings,
} from "@/infrastructure/browser/browser-settings-repository";
import {
  isProjectPreviewDocumentUrl,
  isProjectPreviewResourceUrl,
} from "@/infrastructure/browser/project-preview-navigation";
import { localizedErrorMessage } from "@/i18n/translate";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ProjectH5CapabilityConsentLedger } from "@/domain/project-h5-capability-consent";
import {
  projectH5NetworkDeclarations,
  type ProjectH5Manifest,
  type ProjectH5Permission,
  type ProjectH5PermissionDeclaration,
} from "@/domain/project-h5-manifest";

import {
  canCreateBrowserTask,
  useBrowserActions,
  useBrowserState,
  type BrowserTask,
} from "./browser-provider";
import { resolveBrowserBackAction } from "./browser-back-action";
import {
  ProjectH5CapabilityPromptSheet,
  ProjectH5NetworkBlockedView,
  ProjectH5NetworkPromptSheet,
  ProjectH5PermissionDetailsSheet,
  type ProjectH5PermissionDisplayState,
} from "./project-h5-permission-sheet";
import {
  BrowserFullscreenExit,
  BrowserFullscreenMenu,
  BrowserHeader,
  BrowserMenuSheet,
  BrowserStartPage,
  BrowserTabStrip,
  BrowserToolbarButton,
} from "./browser-chrome";

const WEB_OPERATION_TIMEOUT_MS = 8_000;
const WEB_PAGE_READY_TIMEOUT_MS = 15_000;
const LOAD_PROGRESS_MINIMUM_DELTA = 0.04;
const LOAD_PROGRESS_THROTTLE_MS = 100;
const IOS_SAFARI_USER_AGENT =
  Platform.OS === "ios"
    ? createIosSafariUserAgent(Platform.Version)
    : undefined;
const EMPTY_BROWSER_NAVIGATION = Object.freeze({
  url: null,
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
});

type PendingWebOperation = {
  taskId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type PendingCapabilityConsent = {
  key: string;
  taskId: string;
  activationVersion: number;
  contentSha256: string;
  manifest: ProjectH5Manifest;
  declaration: ProjectH5PermissionDeclaration;
  resolve: (allowed: boolean) => void;
};

type ActiveCapabilityConsent = Omit<PendingCapabilityConsent, "resolve"> & {
  resolvers: ((allowed: boolean) => void)[];
};

type ActiveNetworkConsent = Readonly<{
  taskId: string;
  activationVersion: number;
  contentSha256: string;
  manifest: ProjectH5Manifest;
}>;

type BrowserShouldStartRequest = Pick<
  WebViewNavigation,
  "url" | "navigationType"
> & { isTopFrame?: boolean };

type ActiveLocationWatch = Readonly<{
  taskId: string;
  watchId: number;
  token: symbol;
  subscription: BrowserLocationSubscription;
}>;

function locationWatchKey(taskId: string, watchId: number) {
  return `${taskId}:${watchId.toString(10)}`;
}

function projectH5ConsentTaskId(taskId: string, activationVersion: number) {
  return `${taskId}@${activationVersion.toString(10)}`;
}

function reactiveNetworkConsentState(
  ledger: ProjectH5CapabilityConsentLedger,
  taskId: string,
  snapshot: Parameters<ProjectH5CapabilityConsentLedger["networkState"]>[1],
  revision: number,
) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("The mini-app consent revision is invalid.");
  }
  return ledger.networkState(taskId, snapshot);
}

function reactiveCapabilityConsentState(
  ledger: ProjectH5CapabilityConsentLedger,
  taskId: string,
  snapshot: Parameters<ProjectH5CapabilityConsentLedger["state"]>[1],
  capability: ProjectH5Permission,
  revision: number,
) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("The mini-app consent revision is invalid.");
  }
  return ledger.state(taskId, snapshot, capability);
}

function nativeBridgeTokenForTask(taskId: string) {
  const match =
    /^browser-([a-f0-9]{8})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{12})$/u.exec(
      taskId,
    );
  return match ? match.slice(1).join("") : undefined;
}

function browserNativeError(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  switch (name) {
    case "NotAllowedError":
      return { name, message: "Permission denied." };
    case "TimeoutError":
      return { name, message: "Location request timed out." };
    case "PositionUnavailableError":
      return { name, message: "Location data is unavailable." };
    case "DataError":
      return { name, message: "The requested data is too large." };
    case "AbortError":
      return { name, message: "The request was cancelled." };
    case "NotSupportedError":
      return { name, message: "This operation is not supported." };
    case "InvalidStateError":
      return { name, message: "The source is not ready." };
    case "TypeError":
      return { name, message: "The request is invalid." };
    default:
      return { name: "UnknownError", message: "Native operation failed." };
  }
}

function sourceForTask(task: BrowserTask) {
  if (!task.navigationRequest) return undefined;
  return { uri: task.navigationRequest.url };
}

function settingsForTask(
  task: BrowserTask,
  settings: BrowserSettings,
): BrowserSettings {
  if (task.source.kind === "agent-web") {
    return READ_ONLY_AGENT_BROWSER_SETTINGS;
  }
  return task.source.kind === "project-preview"
    ? projectPreviewBrowserSettings(
        settings,
        task.source.snapshot.app.permissions,
      )
    : settings;
}

function permissionCapability(name: BrowserPermissionName) {
  switch (name) {
    case "geolocation":
      return "location" as const;
    case "camera":
    case "microphone":
      return name;
    case "clipboard-read":
      return "clipboardRead" as const;
    case "clipboard-write":
      return "clipboardWrite" as const;
  }
}

function nativeRequestCapability(
  request: BrowserNativeWebApiRequest,
): ProjectH5Permission | null {
  switch (request.operation) {
    case "capability-authorize":
      return request.capability;
    case "location-current":
    case "location-watch-start":
      return "location";
    case "clipboard-read-text":
      return "clipboardRead";
    case "clipboard-write-text":
      return "clipboardWrite";
    case "share":
      return "sharing";
    case "orientation-lock":
      return "screenOrientation";
    case "print-html":
      return "printing";
    case "barcode-detect":
      return "barcodeDetection";
    case "location-watch-stop":
    case "orientation-unlock":
    case "permission-query":
      return null;
  }
}

function selectActiveConversationId(state: BoltPocketAppState) {
  return state.activeConversationId;
}

function selectConversationProjectIds(state: BoltPocketAppState) {
  return state.conversationProjectIds;
}

function selectProjects(state: BoltPocketAppState) {
  return state.projects;
}

export function AppBrowserHost() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeConversationId = useAppStateSelector(
    selectActiveConversationId,
    Object.is,
  );
  const conversationProjectIds = useAppStateSelector(
    selectConversationProjectIds,
    Object.is,
  );
  const projects = useAppStateSelector(selectProjects, Object.is);
  const browserMode = useBrowserState((browser) => browser.mode);
  const browserTasks = useBrowserState((browser) => browser.tasks);
  const browserActiveTaskId = useBrowserState(
    (browser) => browser.activeTaskId,
  );
  const browserSettings = useBrowserState((browser) => browser.settings);
  const browserActivationVersion = useBrowserState(
    (browser) => browser.activationVersion,
  );
  const browserGrantVersion = useBrowserState(
    (browser) => browser.grantVersion,
  );
  const browserAgentActivity = useBrowserState(
    (browser) => browser.agentActivity,
  );
  const browserCanCreateTask = useBrowserState(canCreateBrowserTask);
  const browserActions = useBrowserActions();
  const browserActiveTask = useMemo(
    () => browserTasks.find((task) => task.id === browserActiveTaskId) ?? null,
    [browserActiveTaskId, browserTasks],
  );
  const browserNavigation = useMemo(
    () => ({
      mode: browserMode,
      ...(browserActiveTask?.navigation ?? EMPTY_BROWSER_NAVIGATION),
    }),
    [browserActiveTask, browserMode],
  );
  const browser = useMemo(
    () => ({
      ...browserActions,
      mode: browserMode,
      tasks: browserTasks,
      activeTaskId: browserActiveTaskId,
      activeTask: browserActiveTask,
      navigation: browserNavigation,
      navigationRequest: browserActiveTask?.navigationRequest ?? null,
      settings: browserSettings,
      activationVersion: browserActivationVersion,
      grantVersion: browserGrantVersion,
      agentActivity: browserAgentActivity,
      canCreateTask: browserCanCreateTask,
    }),
    [
      browserActions,
      browserActivationVersion,
      browserActiveTask,
      browserActiveTaskId,
      browserAgentActivity,
      browserCanCreateTask,
      browserGrantVersion,
      browserMode,
      browserNavigation,
      browserSettings,
      browserTasks,
    ],
  );
  const webViewRefs = useRef(new Map<string, WebView>());
  const taskPageActivity = useRef(new Map<string, boolean>());
  const nativeAppState = useRef(AppState.currentState);
  const [applicationActive, setApplicationActive] = useState(
    AppState.currentState === "active",
  );
  const locationWatches = useRef(new Map<string, ActiveLocationWatch>());
  const pendingLocationWatches = useRef(new Map<string, symbol>());
  const orientationLockTaskId = useRef<string | null>(null);
  const pendingOperations = useRef(new Map<string, PendingWebOperation>());
  const pageLoadFailures = useRef(new Map<string, string>());
  const operationSequence = useRef(0);
  const browserRef = useRef(browser);
  const reduceMotion = useReducedMotion();
  const surfaceProgress = useSharedValue(browser.mode === "expanded" ? 1 : 0);
  const [address, setAddress] = useState(browser.navigation.url ?? "");
  const [addressFocused, setAddressFocused] = useState(false);
  const loadProgressByTask = useRef(new Map<string, number>());
  const lastProgressCommit = useRef({
    taskId: "",
    progress: 0,
    committedAt: 0,
  });
  const [loadProgress, setLoadProgress] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const blockedUrl = useRef<string | null>(null);
  const blockedDownloadNotice = useRef(false);
  const [projectH5Consent] = useState(
    () => new ProjectH5CapabilityConsentLedger(),
  );
  const activePreviewConsentScope = useRef<{
    taskId: string;
    contentSha256: string;
  } | null>(null);
  const capabilityConsentQueue = useRef<PendingCapabilityConsent[]>([]);
  const startupConsentRequests = useRef(new Set<string>());
  const activeCapabilityConsentRef = useRef<ActiveCapabilityConsent | null>(
    null,
  );
  const [activeCapabilityConsent, setActiveCapabilityConsent] =
    useState<ActiveCapabilityConsent | null>(null);
  const [permissionDetailsTarget, setPermissionDetailsTarget] = useState<
    string | null
  >(null);
  const [consentVersion, setConsentVersion] = useState(0);

  useEffect(() => {
    browserRef.current = browser;
  }, [browser]);

  const activeTaskId = browser.activeTaskId;
  const activePreview =
    browser.activeTask?.source.kind === "project-preview"
      ? browser.activeTask.source.snapshot
      : null;
  const activeConsentTaskId = activeTaskId
    ? projectH5ConsentTaskId(activeTaskId, browser.activationVersion)
    : null;
  const activeNetworkConsentState =
    activeConsentTaskId && activePreview
      ? reactiveNetworkConsentState(
          projectH5Consent,
          activeConsentTaskId,
          activePreview,
          consentVersion,
        )
      : "not-required";
  const activeNetworkConsent: ActiveNetworkConsent | null =
    applicationActive &&
    browser.mode === "expanded" &&
    activeTaskId &&
    activePreview &&
    activeNetworkConsentState === "prompt"
      ? {
          taskId: activeTaskId,
          activationVersion: browser.activationVersion,
          contentSha256: activePreview.contentSha256,
          manifest: activePreview.app,
        }
      : null;
  const activeNetworkDisplayState =
    activeNetworkConsentState === "prompt"
      ? "ask"
      : activeNetworkConsentState === "not-required"
        ? undefined
        : activeNetworkConsentState;
  const activePermissionDetailsTarget =
    activeTaskId && activePreview
      ? `${activeTaskId}:${browser.activationVersion}:${activePreview.contentSha256}`
      : null;
  const permissionDetailsVisible =
    applicationActive &&
    browser.mode === "expanded" &&
    activePermissionDetailsTarget !== null &&
    permissionDetailsTarget === activePermissionDetailsTarget;
  const activeCapabilityConsentVisible = Boolean(
    activeCapabilityConsent &&
    applicationActive &&
    browser.mode === "expanded" &&
    activeCapabilityConsent.taskId === activeTaskId &&
    activeCapabilityConsent.activationVersion === browser.activationVersion &&
    activeCapabilityConsent.contentSha256 === activePreview?.contentSha256,
  );
  const currentUrl = browser.navigation.url;
  const activeProjectId = conversationProjectIds[activeConversationId] ?? null;
  const activeProject = activeProjectId
    ? (projects[activeProjectId] ?? null)
    : null;
  const agentManaged = appBrowserControlBridge.isManaged(
    activeProjectId,
    activeTaskId,
  );
  const agentGranted =
    agentManaged ||
    appBrowserControlBridge.isGranted(activeProjectId, currentUrl);
  const taskOwnerLabels = Object.fromEntries(
    browser.tasks.flatMap((task) => {
      const projectId =
        task.source.kind === "project-preview"
          ? task.source.snapshot.projectId
          : appBrowserControlBridge.managedProjectId(task.id);
      const projectName = projectId ? projects[projectId]?.name : undefined;
      return projectName ? [[task.id, projectName] as const] : [];
    }),
  );

  const restoreBrowserOrientation = useCallback((taskId?: string) => {
    if (taskId && orientationLockTaskId.current !== taskId) return;
    orientationLockTaskId.current = null;
    void browserNativeWebApi.restoreOrientation().catch(() => undefined);
  }, []);

  const bumpConsentVersion = useCallback(() => {
    setConsentVersion((current) => current + 1);
  }, []);

  const isCurrentConsentTarget = useCallback(
    (taskId: string, activationVersion: number, contentSha256: string) => {
      const current = browserRef.current;
      const task = current.tasks.find((candidate) => candidate.id === taskId);
      return Boolean(
        nativeAppState.current === "active" &&
        current.mode === "expanded" &&
        current.activeTaskId === taskId &&
        current.activationVersion === activationVersion &&
        task?.source.kind === "project-preview" &&
        task.source.snapshot.contentSha256 === contentSha256,
      );
    },
    [],
  );

  const drainCapabilityConsentQueue = useCallback(() => {
    if (activeCapabilityConsentRef.current) return;
    while (capabilityConsentQueue.current.length > 0) {
      const next = capabilityConsentQueue.current.shift()!;
      if (
        !isCurrentConsentTarget(
          next.taskId,
          next.activationVersion,
          next.contentSha256,
        )
      ) {
        next.resolve(false);
        continue;
      }
      const task = browserRef.current.tasks.find(
        (candidate) => candidate.id === next.taskId,
      );
      if (task?.source.kind !== "project-preview") {
        next.resolve(false);
        continue;
      }
      const decision = projectH5Consent.state(
        projectH5ConsentTaskId(next.taskId, next.activationVersion),
        task.source.snapshot,
        next.declaration.id,
      );
      if (decision.state === "granted") {
        next.resolve(true);
        continue;
      }
      if (decision.state !== "prompt") {
        next.resolve(false);
        continue;
      }
      const resolvers = [next.resolve];
      if (next.declaration.mode === "session") {
        capabilityConsentQueue.current = capabilityConsentQueue.current.filter(
          (queued) => {
            if (queued.key !== next.key) return true;
            resolvers.push(queued.resolve);
            return false;
          },
        );
      }
      const active: ActiveCapabilityConsent = {
        key: next.key,
        taskId: next.taskId,
        activationVersion: next.activationVersion,
        contentSha256: next.contentSha256,
        declaration: decision.declaration,
        manifest: next.manifest,
        resolvers,
      };
      activeCapabilityConsentRef.current = active;
      setActiveCapabilityConsent(active);
      return;
    }
    setActiveCapabilityConsent(null);
  }, [isCurrentConsentTarget, projectH5Consent]);

  const cancelCapabilityConsents = useCallback(
    (onlyStale = false) => {
      const active = activeCapabilityConsentRef.current;
      if (
        active &&
        (!onlyStale ||
          !isCurrentConsentTarget(
            active.taskId,
            active.activationVersion,
            active.contentSha256,
          ))
      ) {
        activeCapabilityConsentRef.current = null;
        for (const resolve of active.resolvers) resolve(false);
        setActiveCapabilityConsent(null);
      }
      const kept: PendingCapabilityConsent[] = [];
      for (const queued of capabilityConsentQueue.current) {
        if (
          onlyStale &&
          isCurrentConsentTarget(
            queued.taskId,
            queued.activationVersion,
            queued.contentSha256,
          )
        ) {
          kept.push(queued);
        } else {
          queued.resolve(false);
        }
      }
      capabilityConsentQueue.current = kept;
      if (!activeCapabilityConsentRef.current && kept.length > 0) {
        drainCapabilityConsentQueue();
      }
    },
    [drainCapabilityConsentQueue, isCurrentConsentTarget],
  );

  useEffect(() => {
    if (!applicationActive || browser.mode !== "expanded") {
      cancelCapabilityConsents();
      projectH5Consent.revokeAll();
      activePreviewConsentScope.current = null;
      return;
    }
    const nextActiveTarget =
      activeConsentTaskId && activePreview
        ? {
            taskId: activeConsentTaskId,
            contentSha256: activePreview.contentSha256,
          }
        : null;
    const previousActiveTarget = activePreviewConsentScope.current;
    if (
      previousActiveTarget &&
      (previousActiveTarget.taskId !== nextActiveTarget?.taskId ||
        previousActiveTarget.contentSha256 !== nextActiveTarget?.contentSha256)
    ) {
      if (previousActiveTarget.taskId === nextActiveTarget?.taskId) {
        projectH5Consent.revokeContent(
          previousActiveTarget.taskId,
          previousActiveTarget.contentSha256,
        );
      } else {
        projectH5Consent.revokeTask(previousActiveTarget.taskId);
      }
    }
    activePreviewConsentScope.current = nextActiveTarget;
    cancelCapabilityConsents(true);
  }, [
    applicationActive,
    activeConsentTaskId,
    activePreview,
    browser.mode,
    cancelCapabilityConsents,
    projectH5Consent,
  ]);

  const requestProjectCapabilityConsent = useCallback(
    (task: BrowserTask, capability: ProjectH5Permission): Promise<boolean> => {
      if (task.source.kind !== "project-preview") return Promise.resolve(true);
      const snapshot = task.source.snapshot;
      const activationVersion = browserRef.current.activationVersion;
      if (
        !isCurrentConsentTarget(
          task.id,
          activationVersion,
          snapshot.contentSha256,
        )
      ) {
        return Promise.resolve(false);
      }
      const consentTaskId = projectH5ConsentTaskId(task.id, activationVersion);
      const decision = projectH5Consent.state(
        consentTaskId,
        snapshot,
        capability,
      );
      if (decision.state === "denied" || decision.state === "undeclared") {
        return Promise.resolve(false);
      }
      if (decision.state === "granted") return Promise.resolve(true);
      return new Promise((resolve) => {
        const key = `${consentTaskId}:${snapshot.contentSha256}:${capability}`;
        const active = activeCapabilityConsentRef.current;
        if (decision.declaration.mode === "session" && active?.key === key) {
          active.resolvers.push(resolve);
          return;
        }
        capabilityConsentQueue.current.push({
          key,
          taskId: task.id,
          activationVersion,
          contentSha256: snapshot.contentSha256,
          declaration: decision.declaration,
          manifest: snapshot.app,
          resolve,
        });
        drainCapabilityConsentQueue();
      });
    },
    [drainCapabilityConsentQueue, isCurrentConsentTarget, projectH5Consent],
  );

  const finishCapabilityConsent = useCallback(
    (allowed: boolean) => {
      const active = activeCapabilityConsentRef.current;
      if (!active) return;
      activeCapabilityConsentRef.current = null;
      let result = false;
      const task = browserRef.current.tasks.find(
        (candidate) => candidate.id === active.taskId,
      );
      if (
        task?.source.kind === "project-preview" &&
        task.source.snapshot.contentSha256 === active.contentSha256 &&
        isCurrentConsentTarget(
          active.taskId,
          active.activationVersion,
          active.contentSha256,
        )
      ) {
        const consentTaskId = projectH5ConsentTaskId(
          active.taskId,
          active.activationVersion,
        );
        if (allowed) {
          projectH5Consent.grant(
            consentTaskId,
            task.source.snapshot,
            active.declaration,
          );
          result = true;
        } else {
          projectH5Consent.deny(
            consentTaskId,
            task.source.snapshot,
            active.declaration,
          );
        }
      }
      for (const resolve of active.resolvers) resolve(result);
      setActiveCapabilityConsent(null);
      bumpConsentVersion();
      drainCapabilityConsentQueue();
    },
    [
      bumpConsentVersion,
      drainCapabilityConsentQueue,
      isCurrentConsentTarget,
      projectH5Consent,
    ],
  );

  const finishNetworkConsent = (allowed: boolean) => {
    const active = activeNetworkConsent;
    if (!active) return;
    const task = browser.tasks.find(
      (candidate) => candidate.id === active.taskId,
    );
    const checks = [
      nativeAppState.current === "active",
      browser.mode === "expanded",
      browser.activeTaskId === active.taskId,
      browser.activationVersion === active.activationVersion,
      task?.source.kind === "project-preview",
      task?.source.kind === "project-preview" &&
        task.source.snapshot.contentSha256 === active.contentSha256,
    ];
    if (checks.every(Boolean) && task?.source.kind === "project-preview") {
      const consentTaskId = projectH5ConsentTaskId(
        active.taskId,
        active.activationVersion,
      );
      if (allowed) {
        projectH5Consent.grantNetwork(consentTaskId, task.source.snapshot);
      } else {
        projectH5Consent.denyNetwork(consentTaskId, task.source.snapshot);
      }
    }
    bumpConsentVersion();
  };

  const reviewActiveNetworkConsent = () => {
    const task = browserRef.current.activeTask;
    if (task?.source.kind !== "project-preview") return;
    const snapshot = task.source.snapshot;
    projectH5Consent.resetNetwork(
      projectH5ConsentTaskId(task.id, browserRef.current.activationVersion),
      snapshot,
    );
    bumpConsentVersion();
  };

  useEffect(() => {
    const task = browser.activeTask;
    if (
      !applicationActive ||
      browser.mode !== "expanded" ||
      task?.source.kind !== "project-preview"
    ) {
      return;
    }
    const snapshot = task.source.snapshot;
    const consentTaskId = projectH5ConsentTaskId(
      task.id,
      browser.activationVersion,
    );
    const networkState = projectH5Consent.networkState(consentTaskId, snapshot);
    const taskSettings = settingsForTask(task, browser.settings);
    if (
      !taskSettings.autoplayMedia ||
      (networkState !== "not-required" && networkState !== "granted")
    ) {
      return;
    }
    const key = `${consentTaskId}:${snapshot.contentSha256}:autoplayMedia`;
    if (startupConsentRequests.current.has(key)) return;
    const decision = projectH5Consent.state(
      consentTaskId,
      snapshot,
      "autoplayMedia",
    );
    if (decision.state !== "prompt") return;
    startupConsentRequests.current.add(key);
    void requestProjectCapabilityConsent(task, "autoplayMedia").finally(() => {
      startupConsentRequests.current.delete(key);
    });
  }, [
    applicationActive,
    browser.activeTask,
    browser.activationVersion,
    browser.mode,
    browser.settings,
    consentVersion,
    projectH5Consent,
    requestProjectCapabilityConsent,
  ]);

  const minimizeBrowser = useCallback(() => {
    setMenuVisible(false);
    setPermissionDetailsTarget(null);
    setFullscreen(false);
    restoreBrowserOrientation();
    browser.minimize();
  }, [browser, restoreBrowserOrientation, setPermissionDetailsTarget]);

  const toggleFullscreen = useCallback(() => {
    setAddressFocused(false);
    setFullscreen((current) => !current);
  }, []);

  const reloadActiveTask = useCallback(() => {
    const taskId = browserRef.current.activeTaskId;
    if (taskId) webViewRefs.current.get(taskId)?.reload();
  }, []);

  const openH5History = useCallback(() => {
    minimizeBrowser();
    router.push("/h5-history" as Href);
  }, [minimizeBrowser, router]);

  const openActivePermissionDetails = () => {
    setMenuVisible(false);
    setPermissionDetailsTarget(activePermissionDetailsTarget);
  };

  const updateLoadProgress = useCallback(
    (taskId: string, rawProgress: number, force = false) => {
      const progress = Math.max(0, Math.min(1, rawProgress));
      loadProgressByTask.current.set(taskId, progress);
      const current = browserRef.current;
      if (current.mode !== "expanded" || current.activeTaskId !== taskId) {
        return;
      }
      const now = Date.now();
      const last = lastProgressCommit.current;
      if (
        !force &&
        progress < 1 &&
        last.taskId === taskId &&
        Math.abs(progress - last.progress) < LOAD_PROGRESS_MINIMUM_DELTA &&
        now - last.committedAt < LOAD_PROGRESS_THROTTLE_MS
      ) {
        return;
      }
      lastProgressCommit.current = { taskId, progress, committedAt: now };
      setLoadProgress(progress);
    },
    [],
  );

  useEffect(() => {
    const taskId = browser.activeTaskId;
    const progress = taskId ? (loadProgressByTask.current.get(taskId) ?? 0) : 0;
    lastProgressCommit.current = {
      taskId: taskId ?? "",
      progress,
      committedAt: Date.now(),
    };
    setLoadProgress(progress);
  }, [browser.activeTaskId, browser.mode]);

  useEffect(() => {
    restoreBrowserOrientation();
    return () => restoreBrowserOrientation();
  }, [restoreBrowserOrientation]);

  const stopLocationWatch = useCallback((taskId: string, watchId: number) => {
    const key = locationWatchKey(taskId, watchId);
    pendingLocationWatches.current.delete(key);
    const active = locationWatches.current.get(key);
    if (!active) return;
    locationWatches.current.delete(key);
    active.subscription.remove();
  }, []);

  const stopLocationWatchesForTask = useCallback((taskId?: string) => {
    for (const [key, active] of locationWatches.current) {
      if (taskId && active.taskId !== taskId) continue;
      locationWatches.current.delete(key);
      active.subscription.remove();
    }
    for (const key of pendingLocationWatches.current.keys()) {
      if (!taskId || key.startsWith(`${taskId}:`)) {
        pendingLocationWatches.current.delete(key);
      }
    }
  }, []);

  const syncTaskPageActivity = useCallback(
    (forceTaskId?: string) => {
      const current = browserRef.current;
      const appActive = nativeAppState.current === "active";
      for (const task of current.tasks) {
        const active =
          (task.source.kind !== "project-preview" &&
            appBrowserControlBridge.runsWhileHidden(task.id)) ||
          (appActive &&
            current.mode === "expanded" &&
            current.activeTaskId === task.id);
        if (
          forceTaskId !== task.id &&
          taskPageActivity.current.get(task.id) === active
        ) {
          continue;
        }
        taskPageActivity.current.set(task.id, active);
        if (!active) stopLocationWatchesForTask(task.id);
        webViewRefs.current
          .get(task.id)
          ?.injectJavaScript(createBrowserPageLifecycleScript(active));
      }
    },
    [stopLocationWatchesForTask],
  );

  const activePermissionDisplayState = (
    permission: ProjectH5Permission,
  ): ProjectH5PermissionDisplayState => {
    const task = browser.activeTask;
    if (task?.source.kind !== "project-preview") return "disabled";
    const settings = settingsForTask(task, browser.settings);
    if (!settings[permission]) return "disabled";
    if (!activeConsentTaskId) return "ask";
    const state = reactiveCapabilityConsentState(
      projectH5Consent,
      activeConsentTaskId,
      task.source.snapshot,
      permission,
      consentVersion,
    ).state;
    if (state === "granted") return "granted";
    if (state === "denied") return "denied";
    return "ask";
  };

  const resetActivePermissionConsent = (permission: ProjectH5Permission) => {
    const task = browserRef.current.activeTask;
    if (task?.source.kind !== "project-preview") return;
    projectH5Consent.resetCapability(
      projectH5ConsentTaskId(task.id, browserRef.current.activationVersion),
      task.source.snapshot,
      permission,
    );
    stopLocationWatchesForTask(task.id);
    restoreBrowserOrientation(task.id);
    webViewRefs.current
      .get(task.id)
      ?.injectJavaScript(createBrowserPageLifecycleScript(false));
    requestAnimationFrame(() => syncTaskPageActivity(task.id));
    bumpConsentVersion();
  };

  const resetActiveNetworkConsent = () => {
    const task = browserRef.current.activeTask;
    if (task?.source.kind !== "project-preview") return;
    setPermissionDetailsTarget(null);
    projectH5Consent.resetNetwork(
      projectH5ConsentTaskId(task.id, browserRef.current.activationVersion),
      task.source.snapshot,
    );
    bumpConsentVersion();
  };

  useEffect(() => {
    syncTaskPageActivity();
  }, [
    browser.activeTaskId,
    browser.grantVersion,
    browser.mode,
    browser.tasks,
    syncTaskPageActivity,
  ]);

  useEffect(() => {
    for (const task of browserRef.current.tasks) {
      const update = createBrowserCapabilityUpdateScript(
        settingsForTask(task, browser.settings),
      );
      webViewRefs.current.get(task.id)?.injectJavaScript(update);
    }
  }, [browser.settings]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      nativeAppState.current = nextState;
      setApplicationActive(nextState === "active");
      syncTaskPageActivity();
      if (nextState !== "active") {
        setPermissionDetailsTarget(null);
        return;
      }
      for (const task of browserRef.current.tasks) {
        webViewRefs.current
          .get(task.id)
          ?.injectJavaScript(
            createBrowserCapabilityUpdateScript(
              settingsForTask(task, browserRef.current.settings),
            ),
          );
      }
    });
    return () => subscription.remove();
  }, [syncTaskPageActivity]);

  useEffect(() => {
    const next = browser.mode === "expanded" ? 1 : 0;
    surfaceProgress.value = reduceMotion
      ? withTiming(next, { duration: 0 })
      : withSpring(next, { damping: 22, mass: 0.76, stiffness: 220 });
    if (browser.mode !== "expanded") restoreBrowserOrientation();
  }, [browser.mode, reduceMotion, restoreBrowserOrientation, surfaceProgress]);

  const surfaceAnimationStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: (1 - surfaceProgress.value) * (height + spacing.xxl) },
    ],
  }));

  const rejectPendingOperations = useCallback(
    (message: string, taskId?: string) => {
      for (const [requestId, pending] of pendingOperations.current) {
        if (taskId && pending.taskId !== taskId) continue;
        clearTimeout(pending.timeout);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener("abort", pending.onAbort);
        }
        pending.reject(new Error(message));
        pendingOperations.current.delete(requestId);
      }
    },
    [],
  );

  const markTaskLoadFailure = useCallback(
    (taskId: string, message: string) => {
      pageLoadFailures.current.set(taskId, message);
      const task = browserRef.current.tasks.find(
        (candidate) => candidate.id === taskId,
      );
      if (task) {
        browserRef.current.updateNavigation(taskId, {
          ...task.navigation,
          loading: false,
        });
      }
      webViewRefs.current.get(taskId)?.stopLoading();
      rejectPendingOperations(message, taskId);
    },
    [rejectPendingOperations],
  );

  useEffect(
    () => () => {
      rejectPendingOperations(t("browser.runtime.closed"));
      stopLocationWatchesForTask();
    },
    [rejectPendingOperations, stopLocationWatchesForTask, t],
  );

  useEffect(() => {
    const taskIds = new Set(browser.tasks.map((task) => task.id));
    for (const taskId of taskPageActivity.current.keys()) {
      if (!taskIds.has(taskId)) taskPageActivity.current.delete(taskId);
    }
    for (const taskId of loadProgressByTask.current.keys()) {
      if (!taskIds.has(taskId)) loadProgressByTask.current.delete(taskId);
    }
    if (
      orientationLockTaskId.current &&
      !taskIds.has(orientationLockTaskId.current)
    ) {
      restoreBrowserOrientation();
    }
    for (const pending of pendingOperations.current.values()) {
      if (!taskIds.has(pending.taskId)) {
        rejectPendingOperations(
          t("browser.runtime.taskClosed"),
          pending.taskId,
        );
      }
    }
    for (const taskId of pageLoadFailures.current.keys()) {
      if (!taskIds.has(taskId)) pageLoadFailures.current.delete(taskId);
    }
    for (const active of locationWatches.current.values()) {
      if (!taskIds.has(active.taskId)) {
        stopLocationWatchesForTask(active.taskId);
      }
    }
    for (const key of pendingLocationWatches.current.keys()) {
      const taskId = key.slice(0, key.lastIndexOf(":"));
      if (!taskIds.has(taskId)) stopLocationWatchesForTask(taskId);
    }
  }, [
    browser.tasks,
    rejectPendingOperations,
    restoreBrowserOrientation,
    stopLocationWatchesForTask,
    t,
  ]);

  const waitForTaskReady = useCallback(
    (taskId: string, signal?: AbortSignal): Promise<void> =>
      new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => {
          const error = new Error(t("browser.runtime.agentCancelled"));
          error.name = "AbortError";
          finish(error);
        };
        const check = () => {
          const task = browserRef.current.tasks.find(
            (candidate) => candidate.id === taskId,
          );
          if (!task) {
            finish(new Error(t("browser.runtime.taskMissing")));
            return;
          }
          const failure = pageLoadFailures.current.get(taskId);
          if (failure) {
            finish(new Error(failure));
            return;
          }
          if (
            task.navigation.url &&
            !task.navigation.loading &&
            webViewRefs.current.has(taskId)
          ) {
            finish();
            return;
          }
          if (Date.now() - startedAt >= WEB_PAGE_READY_TIMEOUT_MS) {
            finish(new Error(t("browser.runtime.loadTimeout")));
            return;
          }
          timer = setTimeout(check, 80);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        check();
      }),
    [t],
  );

  const runWebOperation = useCallback(
    async (
      taskId: string,
      createScript: (requestId: string) => string,
      signal?: AbortSignal,
    ): Promise<unknown> => {
      await waitForTaskReady(taskId, signal);
      const task = browserRef.current.tasks.find(
        (candidate) => candidate.id === taskId,
      );
      const webView = webViewRefs.current.get(taskId);
      if (!webView || !task?.navigation.url) {
        return Promise.reject(new Error(t("browser.runtime.notReady")));
      }
      if (signal?.aborted) {
        const error = new Error(t("browser.runtime.agentCancelled"));
        error.name = "AbortError";
        return Promise.reject(error);
      }
      const requestId = `browser-request-${Date.now().toString(36)}-${(operationSequence.current += 1).toString(
        36,
      )}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const pending = pendingOperations.current.get(requestId);
          if (!pending) return;
          pendingOperations.current.delete(requestId);
          if (pending.signal && pending.onAbort) {
            pending.signal.removeEventListener("abort", pending.onAbort);
          }
          reject(new Error(t("browser.runtime.operationTimeout")));
        }, WEB_OPERATION_TIMEOUT_MS);
        const pending: PendingWebOperation = {
          taskId,
          resolve,
          reject,
          timeout,
          signal,
        };
        if (signal) {
          pending.onAbort = () => {
            const active = pendingOperations.current.get(requestId);
            if (!active) return;
            pendingOperations.current.delete(requestId);
            clearTimeout(active.timeout);
            const error = new Error(t("browser.runtime.agentCancelled"));
            error.name = "AbortError";
            reject(error);
          };
          signal.addEventListener("abort", pending.onAbort, { once: true });
        }
        pendingOperations.current.set(requestId, pending);
        webView.injectJavaScript(createScript(requestId));
      });
    },
    [t, waitForTaskReady],
  );

  useEffect(() => {
    return appBrowserControlBridge.registerDriver({
      status: (taskId) => {
        const current = browserRef.current;
        const selectedTaskId = taskId ?? current.activeTaskId;
        const task = current.tasks.find(
          (candidate) => candidate.id === selectedTaskId,
        );
        if (!task) {
          return {
            taskId: null,
            mode: "closed",
            url: null,
            title: "",
            canGoBack: false,
            canGoForward: false,
            loading: false,
          } satisfies BrowserControlDriverStatus;
        }
        return {
          taskId: task.id,
          mode: current.mode,
          ...task.navigation,
        } satisfies BrowserControlDriverStatus;
      },
      open: (url) => {
        const current = browserRef.current;
        const taskId = current.newAgentTask(url);
        return {
          taskId,
          mode: current.mode === "closed" ? "minimized" : current.mode,
          url,
          title: "",
          canGoBack: false,
          canGoForward: false,
          loading: true,
        } satisfies BrowserControlDriverStatus;
      },
      openPreview: (snapshot, present) => {
        const current = browserRef.current;
        const taskId = current.newPreviewTask(snapshot, present, true);
        return {
          taskId,
          mode: present
            ? "expanded"
            : current.mode === "closed"
              ? "minimized"
              : current.mode,
          url: snapshot.url,
          title: t("browser.host.localPreview", { name: snapshot.app.title }),
          canGoBack: false,
          canGoForward: false,
          loading: true,
        } satisfies BrowserControlDriverStatus;
      },
      close: (taskId) => {
        setFullscreen(false);
        browserRef.current.closeTask(taskId);
      },
      snapshot: async (taskId, signal) =>
        parseBrowserPageSnapshot(
          await runWebOperation(taskId, createBrowserSnapshotScript, signal),
        ),
      readText: async (taskId, offset, signal) =>
        parseBrowserPageTextChunk(
          await runWebOperation(
            taskId,
            (requestId) => createBrowserReadTextScript(requestId, offset),
            signal,
          ),
        ),
      findText: async (taskId, query, signal) =>
        parseBrowserPageFindResult(
          await runWebOperation(
            taskId,
            (requestId) => createBrowserFindTextScript(requestId, query),
            signal,
          ),
        ),
      click: async (taskId, targetId, revision, signal) =>
        parseBrowserPageInteractionReceipt(
          await runWebOperation(
            taskId,
            (requestId) =>
              createBrowserClickScript(requestId, targetId, revision),
            signal,
          ),
        ),
      type: async (taskId, targetId, revision, text, signal) =>
        parseBrowserPageInteractionReceipt(
          await runWebOperation(
            taskId,
            (requestId) =>
              createBrowserTypeScript(requestId, targetId, revision, text),
            signal,
          ),
        ),
      navigate: async (taskId, url) => {
        browserRef.current.navigate(url, taskId);
      },
      scroll: async (taskId, direction) => {
        await runWebOperation(taskId, (requestId) =>
          createBrowserScrollScript(requestId, direction),
        );
      },
      highlight: async (taskId, targetId) => {
        await runWebOperation(taskId, (requestId) =>
          createBrowserHighlightScript(requestId, targetId),
        );
      },
      back: (taskId) => {
        webViewRefs.current.get(taskId)?.goBack();
      },
      forward: (taskId) => {
        webViewRefs.current.get(taskId)?.goForward();
      },
      reload: (taskId) => {
        webViewRefs.current.get(taskId)?.reload();
      },
    });
  }, [runWebOperation, t]);

  useEffect(() => {
    if (browser.mode !== "expanded") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const action = resolveBrowserBackAction({
          canGoBack: browser.navigation.canGoBack,
          fullscreen,
        });
        switch (action) {
          case "exit-fullscreen":
            setFullscreen(false);
            break;
          case "navigate-back":
            if (activeTaskId) webViewRefs.current.get(activeTaskId)?.goBack();
            break;
          case "minimize":
            minimizeBrowser();
            break;
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [activeTaskId, browser, fullscreen, minimizeBrowser]);

  const confirmDownload = useCallback(
    (candidate: string) => {
      if (!browserRef.current.settings.downloads) {
        if (blockedDownloadNotice.current) return;
        blockedDownloadNotice.current = true;
        Alert.alert(
          t("browser.host.download.disabled"),
          t("browser.host.feature.enableInSettings"),
          [
            {
              text: t("browser.host.understood"),
              onPress: () => {
                blockedDownloadNotice.current = false;
              },
            },
          ],
        );
        return;
      }
      let url: string;
      try {
        url = normalizeBrowserUrl(candidate);
      } catch {
        Alert.alert(
          t("browser.host.download.notAvailable"),
          t("browser.host.download.invalid"),
        );
        return;
      }
      Alert.alert(t("browser.host.download.save"), browserDisplayHost(url), [
        { text: t("browser.host.download.cancel"), style: "cancel" },
        {
          text: t("browser.host.download.continue"),
          onPress: () => {
            void downloadBrowserFile(url).then(
              (file) => {
                Alert.alert(t("browser.host.download.ready"), file.name);
              },
              (error: unknown) => {
                Alert.alert(
                  t("browser.host.download.failed"),
                  localizedErrorMessage(error, t("browser.host.retry")),
                );
              },
            );
          },
        },
      ]);
    },
    [t],
  );

  const respondToNativeRequest = useCallback(
    (
      taskId: string,
      requestId: string,
      response:
        | { ok: true; result: unknown }
        | { ok: false; error: { name: string; message: string } },
    ) => {
      webViewRefs.current
        .get(taskId)
        ?.injectJavaScript(
          createBrowserNativeResponseScript(requestId, response),
        );
    },
    [],
  );

  const emitLocationWatchEvent = useCallback(
    (
      taskId: string,
      watchId: number,
      event:
        | { ok: true; position: unknown }
        | { ok: false; error: { name: string; message: string } },
    ) => {
      webViewRefs.current
        .get(taskId)
        ?.injectJavaScript(
          createBrowserLocationWatchEventScript(watchId, event),
        );
    },
    [],
  );

  const handleNativeApiRequest = useCallback(
    async (taskId: string, request: BrowserNativeWebApiRequest) => {
      const current = browserRef.current;
      const task = current.tasks.find((candidate) => candidate.id === taskId);
      if (!task || !webViewRefs.current.has(taskId)) return;
      const settings = settingsForTask(task, current.settings);
      const rejectPermission = () =>
        respondToNativeRequest(taskId, request.requestId, {
          ok: false,
          error: { name: "NotAllowedError", message: "Permission denied." },
        });

      if (request.operation.startsWith("location-") && !settings.location) {
        rejectPermission();
        return;
      }
      if (
        request.operation === "clipboard-read-text" &&
        !settings.clipboardRead
      ) {
        rejectPermission();
        return;
      }
      if (
        request.operation === "clipboard-write-text" &&
        !settings.clipboardWrite
      ) {
        rejectPermission();
        return;
      }
      if (request.operation === "share" && !settings.sharing) {
        rejectPermission();
        return;
      }
      if (
        (request.operation === "orientation-lock" ||
          request.operation === "orientation-unlock") &&
        !settings.screenOrientation
      ) {
        rejectPermission();
        return;
      }
      if (request.operation === "print-html" && !settings.printing) {
        rejectPermission();
        return;
      }
      if (
        request.operation === "barcode-detect" &&
        !settings.barcodeDetection
      ) {
        rejectPermission();
        return;
      }

      if (request.operation === "capability-authorize") {
        if (
          task.source.kind !== "project-preview" ||
          !settings[request.capability]
        ) {
          rejectPermission();
          return;
        }
        const allowed = await requestProjectCapabilityConsent(
          task,
          request.capability,
        );
        respondToNativeRequest(taskId, request.requestId, {
          ok: true,
          result: allowed,
        });
        return;
      }

      if (request.operation === "permission-query") {
        const capability = permissionCapability(request.permission);
        if (!settings[capability]) {
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: "denied",
          });
          return;
        }
        if (task.source.kind === "project-preview") {
          const consent = projectH5Consent.state(
            projectH5ConsentTaskId(
              task.id,
              browserRef.current.activationVersion,
            ),
            task.source.snapshot,
            capability,
          );
          if (consent.state !== "granted") {
            respondToNativeRequest(taskId, request.requestId, {
              ok: true,
              result: consent.state === "denied" ? "denied" : "prompt",
            });
            return;
          }
        }
        try {
          const permission = await browserNativeWebApi.queryPermission(
            request.permission,
          );
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: permission,
          });
        } catch (error) {
          respondToNativeRequest(taskId, request.requestId, {
            ok: false,
            error: browserNativeError(error),
          });
        }
        return;
      }

      const capability = nativeRequestCapability(request);
      if (
        capability &&
        !(await requestProjectCapabilityConsent(task, capability))
      ) {
        rejectPermission();
        return;
      }

      if (request.operation === "location-current") {
        try {
          const position = await browserNativeWebApi.getCurrentPosition(
            request.options,
          );
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: position,
          });
        } catch (error) {
          respondToNativeRequest(taskId, request.requestId, {
            ok: false,
            error: browserNativeError(error),
          });
        }
        return;
      }

      if (request.operation === "location-watch-start") {
        stopLocationWatch(taskId, request.watchId);
        const key = locationWatchKey(taskId, request.watchId);
        const token = Symbol(key);
        pendingLocationWatches.current.set(key, token);
        try {
          const subscription = await browserNativeWebApi.watchPosition(
            request.options,
            (position) => {
              if (
                pendingLocationWatches.current.get(key) !== token &&
                locationWatches.current.get(key)?.token !== token
              ) {
                return;
              }
              emitLocationWatchEvent(taskId, request.watchId, {
                ok: true,
                position,
              });
            },
            (error) => {
              if (
                pendingLocationWatches.current.get(key) !== token &&
                locationWatches.current.get(key)?.token !== token
              ) {
                return;
              }
              emitLocationWatchEvent(taskId, request.watchId, {
                ok: false,
                error: browserNativeError(error),
              });
            },
          );
          if (pendingLocationWatches.current.get(key) !== token) {
            subscription.remove();
            respondToNativeRequest(taskId, request.requestId, {
              ok: false,
              error: browserNativeError(
                Object.assign(new Error(), { name: "AbortError" }),
              ),
            });
            return;
          }
          pendingLocationWatches.current.delete(key);
          locationWatches.current.set(key, {
            taskId,
            watchId: request.watchId,
            token,
            subscription,
          });
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: { started: true },
          });
        } catch (error) {
          if (pendingLocationWatches.current.get(key) === token) {
            pendingLocationWatches.current.delete(key);
          }
          respondToNativeRequest(taskId, request.requestId, {
            ok: false,
            error: browserNativeError(error),
          });
        }
        return;
      }

      if (request.operation === "location-watch-stop") {
        stopLocationWatch(taskId, request.watchId);
        respondToNativeRequest(taskId, request.requestId, {
          ok: true,
          result: null,
        });
        return;
      }

      if (request.operation === "clipboard-read-text") {
        try {
          const text = await browserNativeWebApi.readClipboardText();
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: text,
          });
        } catch (error) {
          respondToNativeRequest(taskId, request.requestId, {
            ok: false,
            error: browserNativeError(error),
          });
        }
        return;
      }

      try {
        if (request.operation === "clipboard-write-text") {
          await browserNativeWebApi.writeClipboardText(request.text);
        } else if (request.operation === "share") {
          await browserNativeWebApi.share(request.data);
        } else if (request.operation === "orientation-lock") {
          await browserNativeWebApi.lockOrientation(request.lock);
          orientationLockTaskId.current = taskId;
        } else if (request.operation === "orientation-unlock") {
          restoreBrowserOrientation(taskId);
        } else if (request.operation === "print-html") {
          await browserNativeWebApi.printHtml(request.html);
        } else if (request.operation === "barcode-detect") {
          const barcodes = await browserNativeWebApi.scanBarcodes(
            request.dataUrl,
            request.formats,
          );
          respondToNativeRequest(taskId, request.requestId, {
            ok: true,
            result: barcodes,
          });
          return;
        }
        respondToNativeRequest(taskId, request.requestId, {
          ok: true,
          result: null,
        });
      } catch (error) {
        respondToNativeRequest(taskId, request.requestId, {
          ok: false,
          error: browserNativeError(error),
        });
      }
    },
    [
      emitLocationWatchEvent,
      projectH5Consent,
      requestProjectCapabilityConsent,
      respondToNativeRequest,
      restoreBrowserOrientation,
      stopLocationWatch,
    ],
  );

  const onMessage = useCallback(
    (taskId: string, event: WebViewMessageEvent) => {
      let message;
      try {
        message = parseBrowserWebViewMessage(
          event.nativeEvent.data,
          nativeBridgeTokenForTask(taskId),
        );
      } catch {
        return;
      }
      if (message.type === "native-api-request") {
        void handleNativeApiRequest(taskId, message);
        return;
      }
      if (message.type === "download-request") {
        const task = browserRef.current.tasks.find(
          (candidate) => candidate.id === taskId,
        );
        if (task?.source.kind === "project-preview") return;
        confirmDownload(message.url);
        return;
      }
      const pending = pendingOperations.current.get(message.requestId);
      if (!pending || pending.taskId !== taskId) return;
      pendingOperations.current.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    },
    [confirmDownload, handleNativeApiRequest],
  );

  const onNavigationStateChange = useCallback(
    (task: BrowserTask, navigation: WebViewNavigation) => {
      if (
        task.source.kind === "project-preview" &&
        navigation.url !== "about:blank" &&
        !isProjectPreviewDocumentUrl(task, navigation.url)
      ) {
        webViewRefs.current.get(task.id)?.stopLoading();
        return;
      }
      browser.updateNavigation(task.id, {
        url: navigation.url,
        title:
          task.source.kind === "project-preview"
            ? t("browser.host.localPreview", {
                name: task.source.snapshot.app.title,
              })
            : navigation.title,
        canGoBack: navigation.canGoBack,
        canGoForward: navigation.canGoForward,
        loading: navigation.loading,
      });
    },
    [browser, t],
  );

  const submitAddress = () => {
    try {
      const url = browser.navigate(address);
      setAddress(url);
      setAddressFocused(false);
    } catch (error) {
      Alert.alert(
        t("browser.host.open.failed"),
        localizedErrorMessage(error, t("browser.host.open.inputRequired")),
      );
    }
  };

  const toggleAgentGrant = () => {
    setMenuVisible(false);
    if (!activeProject || !currentUrl) {
      Alert.alert(
        t("browser.host.agent.couldNotAuthorize"),
        t("browser.host.agent.noProjectPage"),
      );
      return;
    }
    if (agentManaged) {
      Alert.alert(
        t("browser.host.agent.temporaryTitle"),
        t("browser.host.agent.temporaryDetail"),
      );
      return;
    }
    if (agentGranted) {
      appBrowserControlBridge.revoke(activeProject.id, currentUrl);
      return;
    }
    if (!isAgentSafeBrowserUrl(currentUrl)) {
      Alert.alert(
        t("browser.host.agent.couldNotAuthorize"),
        t("browser.host.agent.invalidUrl"),
      );
      return;
    }
    Alert.alert(
      t("browser.host.agent.grantConfirm"),
      t("browser.host.agent.grantDetail", {
        host: browserDisplayHost(currentUrl),
        project: activeProject.name,
      }),
      [
        { text: t("browser.host.agent.cancel"), style: "cancel" },
        {
          text: t("browser.host.agent.allow"),
          onPress: () =>
            appBrowserControlBridge.grant(activeProject.id, currentUrl),
        },
      ],
    );
  };

  const requestExternalApp = (url: string) => {
    if (blockedUrl.current) return;
    blockedUrl.current = url;
    const clearPendingUrl = () => {
      if (blockedUrl.current === url) blockedUrl.current = null;
    };
    if (!browserRef.current.settings.externalApps) {
      Alert.alert(
        t("browser.host.external.disabled"),
        t("browser.host.feature.enableInSettings"),
        [
          {
            text: t("browser.host.understood"),
            onPress: clearPendingUrl,
          },
        ],
        { cancelable: true, onDismiss: clearPendingUrl },
      );
      return;
    }
    Alert.alert(
      t("browser.host.external.prompt"),
      browserExternalDestination(url),
      [
        {
          text: t("browser.host.agent.cancel"),
          style: "cancel",
          onPress: clearPendingUrl,
        },
        {
          text: t("browser.host.external.open"),
          onPress: () => {
            void Linking.openURL(url)
              .catch(() =>
                Alert.alert(
                  t("browser.host.open.failed"),
                  t("browser.host.external.noApp"),
                ),
              )
              .finally(clearPendingUrl);
          },
        },
      ],
      { cancelable: true, onDismiss: clearPendingUrl },
    );
  };

  const openExternal = () => {
    if (currentUrl) requestExternalApp(currentUrl);
  };

  const blockExternalNavigation = (
    task: BrowserTask,
    request: Pick<BrowserShouldStartRequest, "url" | "navigationType">,
  ) => {
    const currentTask = browserRef.current.tasks.find(
      (candidate) => candidate.id === task.id,
    );
    if (currentTask?.navigation.loading) {
      markTaskLoadFailure(task.id, t("browser.runtime.externalAppRequired"));
    }
    if (
      shouldPromptForExternalApp({
        platform:
          Platform.OS === "ios"
            ? "ios"
            : Platform.OS === "android"
              ? "android"
              : "other",
        agentManaged: Boolean(
          appBrowserControlBridge.managedProjectId(task.id),
        ),
        navigationType: request.navigationType,
      })
    ) {
      requestExternalApp(request.url);
    }
  };

  const shouldStartLoad = (
    task: BrowserTask,
    request: BrowserShouldStartRequest,
  ) => {
    if (request.url === "about:blank") return true;
    if (task.source.kind === "project-preview") {
      if (
        request.isTopFrame === false
          ? isProjectPreviewResourceUrl(task, request.url)
          : isProjectPreviewDocumentUrl(task, request.url)
      ) {
        return true;
      }
      if (isExternalAppUrl(request.url)) {
        blockExternalNavigation(task, request);
      }
      return false;
    }
    const decision = browserNavigationDecision(request.url);
    if (decision === "allow-web") return true;
    if (decision === "prompt-external-app") {
      blockExternalNavigation(task, request);
    }
    return false;
  };

  if (browser.mode === "closed") return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        accessibilityElementsHidden={browser.mode !== "expanded"}
        importantForAccessibility={
          browser.mode === "expanded" ? "auto" : "no-hide-descendants"
        }
        pointerEvents={browser.mode === "expanded" ? "auto" : "none"}
        style={[
          styles.browserSurface,
          { backgroundColor: palette.background },
          surfaceAnimationStyle,
        ]}
      >
        <SafeAreaView edges={["top"]} mode="margin" style={styles.flex}>
          {!fullscreen ? (
            <>
              <BrowserHeader
                address={address}
                addressFocused={addressFocused}
                agentGranted={agentGranted}
                agentLabel={
                  activePreview
                    ? t("browser.host.isolatedPreview")
                    : (browser.agentActivity ??
                      t("browser.host.agent.access", {
                        project:
                          activeProject?.name ?? t("browser.host.project"),
                      }))
                }
                currentUrl={currentUrl}
                loading={browser.navigation.loading}
                onAddressBlur={() => setAddressFocused(false)}
                onAddressChange={setAddress}
                onAddressFocus={() => {
                  setAddress(currentUrl ?? "");
                  setAddressFocused(true);
                }}
                onAddressSubmit={submitAddress}
                onMenu={() => setMenuVisible(true)}
                onMinimize={minimizeBrowser}
                palette={palette}
                previewLabel={
                  activePreview
                    ? t("browser.host.localPreview", {
                        name: activePreview.displayPath,
                      })
                    : undefined
                }
              />

              <BrowserTabStrip
                activeTaskId={activeTaskId}
                canCreateTask={browser.canCreateTask}
                onCloseTask={browser.closeTask}
                onNewTask={() => {
                  try {
                    browser.newTask();
                  } catch (error) {
                    Alert.alert(
                      t("browser.host.newPage.failed"),
                      localizedErrorMessage(error, t("browser.host.retry")),
                    );
                  }
                }}
                onSelectTask={browser.expandTask}
                ownerLabels={taskOwnerLabels}
                palette={palette}
                tasks={browser.tasks}
              />
            </>
          ) : null}

          {browser.navigation.loading ? (
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: palette.border },
              ]}
            >
              <View
                style={[
                  styles.progressValue,
                  {
                    backgroundColor: palette.accent,
                    width: `${Math.max(4, loadProgress * 100)}%`,
                  },
                ]}
              />
            </View>
          ) : null}

          <View style={styles.webContent}>
            {browser.tasks.map((task) => {
              if (!task.navigationRequest) return null;
              const baseTaskSettings = settingsForTask(task, browser.settings);
              const previewSnapshot =
                task.source.kind === "project-preview"
                  ? task.source.snapshot
                  : null;
              const projectPreview = previewSnapshot !== null;
              const taskConsentId =
                previewSnapshot && task.id === activeTaskId
                  ? activeConsentTaskId
                  : null;
              const networkConsentState = previewSnapshot
                ? taskConsentId
                  ? reactiveNetworkConsentState(
                      projectH5Consent,
                      taskConsentId,
                      previewSnapshot,
                      consentVersion,
                    )
                  : previewSnapshot.app.network?.length
                    ? "prompt"
                    : "not-required"
                : "not-required";
              const networkLoadAllowed =
                networkConsentState === "not-required" ||
                networkConsentState === "granted";
              const autoplayConsentState = previewSnapshot
                ? taskConsentId
                  ? reactiveCapabilityConsentState(
                      projectH5Consent,
                      taskConsentId,
                      previewSnapshot,
                      "autoplayMedia",
                      consentVersion,
                    ).state
                  : "prompt"
                : "granted";
              const taskSettings =
                projectPreview &&
                baseTaskSettings.autoplayMedia &&
                autoplayConsentState !== "granted"
                  ? { ...baseTaskSettings, autoplayMedia: false }
                  : baseTaskSettings;
              const nativeSessionAllowed = (
                capability:
                  | "airPlay"
                  | "fullscreenMedia"
                  | "pictureInPicture"
                  | "protectedMedia",
              ) =>
                !previewSnapshot ||
                (taskConsentId !== null &&
                  reactiveCapabilityConsentState(
                    projectH5Consent,
                    taskConsentId,
                    previewSnapshot,
                    capability,
                    consentVersion,
                  ).state === "granted");
              const nativeTaskSettings = projectPreview
                ? {
                    ...taskSettings,
                    airPlay:
                      taskSettings.airPlay && nativeSessionAllowed("airPlay"),
                    fullscreenMedia:
                      taskSettings.fullscreenMedia &&
                      nativeSessionAllowed("fullscreenMedia"),
                    pictureInPicture:
                      taskSettings.pictureInPicture &&
                      nativeSessionAllowed("pictureInPicture"),
                    protectedMedia:
                      taskSettings.protectedMedia &&
                      nativeSessionAllowed("protectedMedia"),
                  }
                : taskSettings;
              const nativeBridgeEnabled = shouldEnableBrowserNativeBridge(
                Platform.OS,
                projectPreview,
              );
              const androidNativeFallback = Platform.OS === "android";
              const appOwnedNativeFallback =
                androidNativeFallback || projectPreview;
              const nativeBridgeToken = nativeBridgeEnabled
                ? nativeBridgeTokenForTask(task.id)
                : null;
              const beforeContentScript = [
                task.source.kind === "agent-web" ||
                (task.source.kind === "project-preview" &&
                  task.source.agentOwned)
                  ? AGENT_READ_ONLY_INTERACTION_GUARD_SCRIPT
                  : "",
                createBrowserCapabilityGuardScript(
                  taskSettings,
                  {
                    capabilityConsent: projectPreview,
                    location: appOwnedNativeFallback,
                    clipboardText: appOwnedNativeFallback,
                    permissions: nativeBridgeEnabled,
                    sharing: nativeBridgeEnabled,
                    screenOrientation: nativeBridgeEnabled,
                    printing: nativeBridgeEnabled,
                    barcodeFormats: nativeBridgeEnabled
                      ? browserNativeBarcodeFormats
                      : [],
                  },
                  nativeBridgeToken,
                  (task.source.kind !== "project-preview" &&
                    appBrowserControlBridge.runsWhileHidden(task.id)) ||
                    (applicationActive &&
                      browser.mode === "expanded" &&
                      browser.activeTaskId === task.id),
                ),
              ]
                .filter(Boolean)
                .join("\n");
              return (
                <View
                  accessibilityElementsHidden={task.id !== activeTaskId}
                  importantForAccessibility={
                    task.id === activeTaskId ? "auto" : "no-hide-descendants"
                  }
                  key={task.id}
                  pointerEvents={task.id === activeTaskId ? "auto" : "none"}
                  style={[
                    styles.webTask,
                    task.id !== activeTaskId && styles.webTaskHidden,
                  ]}
                >
                  {networkLoadAllowed ? (
                    <WebView
                      allowFileAccess={false}
                      allowFileAccessFromFileURLs={false}
                      allowUniversalAccessFromFileURLs={false}
                      allowsBackForwardNavigationGestures
                      allowsAirPlayForMediaPlayback={nativeTaskSettings.airPlay}
                      allowsFullscreenVideo={nativeTaskSettings.fullscreenMedia}
                      allowsInlineMediaPlayback
                      allowsPictureInPictureMediaPlayback={
                        nativeTaskSettings.pictureInPicture
                      }
                      allowsProtectedMedia={nativeTaskSettings.protectedMedia}
                      cacheEnabled={task.source.kind !== "project-preview"}
                      domStorageEnabled
                      geolocationEnabled={taskSettings.location}
                      incognito={
                        Platform.OS === "ios" &&
                        task.source.kind === "project-preview"
                      }
                      injectedJavaScript={BROWSER_PAGE_BRIDGE_SCRIPT}
                      injectedJavaScriptBeforeContentLoaded={
                        beforeContentScript
                      }
                      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={
                        false
                      }
                      javaScriptCanOpenWindowsAutomatically={
                        taskSettings.popups
                      }
                      javaScriptEnabled
                      key={`${task.id}:${JSON.stringify(nativeTaskSettings)}`}
                      mediaCapturePermissionGrantType={
                        !taskSettings.camera && !taskSettings.microphone
                          ? "deny"
                          : "grantIfSameHostElsePrompt"
                      }
                      mediaPlaybackRequiresUserAction={
                        !taskSettings.autoplayMedia
                      }
                      mixedContentMode="never"
                      nativeConfig={
                        Platform.OS === "android"
                          ? {
                              props: {
                                boltpocketAllowsFileDownloads:
                                  taskSettings.downloads,
                                boltpocketAllowsCamera: taskSettings.camera,
                                boltpocketAllowsMicrophone: taskSettings.microphone,
                                boltpocketAllowsLocation: taskSettings.location,
                                boltpocketAllowsFileSelection:
                                  taskSettings.fileSelection,
                              },
                            }
                          : undefined
                      }
                      onContentProcessDidTerminate={() =>
                        webViewRefs.current.get(task.id)?.reload()
                      }
                      onFileDownload={(event) => {
                        if (!taskSettings.downloads) return;
                        confirmDownload(event.nativeEvent.downloadUrl);
                      }}
                      onError={() => {
                        markTaskLoadFailure(
                          task.id,
                          t("browser.runtime.loadFailed"),
                        );
                      }}
                      onLoadEnd={() => {
                        updateLoadProgress(task.id, 1, true);
                        syncTaskPageActivity(task.id);
                      }}
                      onLoadProgress={(event) => {
                        const progress = event.nativeEvent.progress;
                        updateLoadProgress(task.id, progress);
                      }}
                      onLoadStart={() => {
                        pageLoadFailures.current.delete(task.id);
                        rejectPendingOperations(
                          t("browser.runtime.navigating"),
                          task.id,
                        );
                        stopLocationWatchesForTask(task.id);
                        restoreBrowserOrientation(task.id);
                        updateLoadProgress(task.id, 0, true);
                      }}
                      onMessage={(event) => onMessage(task.id, event)}
                      onNavigationStateChange={(navigation) =>
                        onNavigationStateChange(task, navigation)
                      }
                      onOpenWindow={(event) => {
                        if (!taskSettings.popups) return;
                        const targetUrl = event.nativeEvent.targetUrl;
                        try {
                          browser.newTask(normalizeBrowserUrl(targetUrl));
                        } catch (error) {
                          if (isExternalAppUrl(targetUrl)) {
                            requestExternalApp(targetUrl);
                          } else {
                            Alert.alert(
                              t("browser.host.newPage.openFailed"),
                              localizedErrorMessage(
                                error,
                                t("browser.host.retry"),
                              ),
                            );
                          }
                        }
                      }}
                      onShouldStartLoadWithRequest={(request) =>
                        shouldStartLoad(task, request)
                      }
                      originWhitelist={BROWSER_WEBVIEW_ORIGIN_WHITELIST}
                      pullToRefreshEnabled
                      ref={(webView) => {
                        if (webView) {
                          webViewRefs.current.set(task.id, webView);
                          syncTaskPageActivity(task.id);
                        } else {
                          webViewRefs.current.delete(task.id);
                          taskPageActivity.current.delete(task.id);
                        }
                      }}
                      setSupportMultipleWindows={taskSettings.popups}
                      sharedCookiesEnabled={
                        task.source.kind !== "project-preview"
                      }
                      source={sourceForTask(task)}
                      startInLoadingState
                      style={{ backgroundColor: palette.surface }}
                      thirdPartyCookiesEnabled={
                        task.source.kind !== "project-preview"
                      }
                      userAgent={
                        task.source.kind !== "project-preview"
                          ? IOS_SAFARI_USER_AGENT
                          : undefined
                      }
                    />
                  ) : task.id === activeTaskId ? (
                    <ProjectH5NetworkBlockedView
                      onReview={reviewActiveNetworkConsent}
                      palette={palette}
                    />
                  ) : null}
                </View>
              );
            })}
            {!browser.navigationRequest ? (
              <BrowserStartPage palette={palette} />
            ) : null}
            {fullscreen ? (
              activePreview ? (
                <BrowserFullscreenMenu
                  onPress={() => setMenuVisible(true)}
                  palette={palette}
                />
              ) : (
                <BrowserFullscreenExit
                  onPress={() => setFullscreen(false)}
                  palette={palette}
                />
              )
            ) : null}
          </View>

          {!fullscreen ? (
            <View
              style={[
                styles.toolbar,
                {
                  backgroundColor: palette.background,
                  borderTopColor: palette.border,
                  paddingBottom: Math.max(spacing.xs, insets.bottom),
                },
              ]}
            >
              <BrowserToolbarButton
                disabled={!browser.navigation.canGoBack}
                icon="chevron-back"
                label={t("browser.host.toolbar.back")}
                onPress={() => {
                  if (activeTaskId)
                    webViewRefs.current.get(activeTaskId)?.goBack();
                }}
                palette={palette}
              />
              <BrowserToolbarButton
                disabled={!browser.navigation.canGoForward}
                icon="chevron-forward"
                label={t("browser.host.toolbar.forward")}
                onPress={() => {
                  if (activeTaskId)
                    webViewRefs.current.get(activeTaskId)?.goForward();
                }}
                palette={palette}
              />
              <BrowserToolbarButton
                disabled={!currentUrl}
                icon={browser.navigation.loading ? "close" : "refresh"}
                label={t(
                  browser.navigation.loading
                    ? "browser.host.toolbar.stop"
                    : "browser.host.toolbar.refresh",
                )}
                onPress={() =>
                  activeTaskId
                    ? browser.navigation.loading
                      ? webViewRefs.current.get(activeTaskId)?.stopLoading()
                      : reloadActiveTask()
                    : undefined
                }
                palette={palette}
              />
            </View>
          ) : null}
        </SafeAreaView>

        <BrowserMenuSheet
          agentGranted={agentGranted}
          agentManaged={agentManaged}
          currentUrl={currentUrl}
          fullscreen={fullscreen}
          onClose={() => setMenuVisible(false)}
          onH5History={openH5History}
          onOpenExternal={openExternal}
          onPermissions={openActivePermissionDetails}
          onReload={reloadActiveTask}
          onToggleAgentGrant={toggleAgentGrant}
          onToggleFullscreen={toggleFullscreen}
          palette={palette}
          projectPreview={Boolean(activePreview)}
          visible={menuVisible}
        />
        <ProjectH5CapabilityPromptSheet
          appTitle={
            activeCapabilityConsent?.manifest.title ??
            t("browser.task.projectPreview")
          }
          declaration={activeCapabilityConsent?.declaration ?? null}
          manifest={activeCapabilityConsent?.manifest ?? null}
          onAllow={() => finishCapabilityConsent(true)}
          onDeny={() => finishCapabilityConsent(false)}
          palette={palette}
          visible={activeCapabilityConsentVisible}
        />
        <ProjectH5NetworkPromptSheet
          appTitle={
            activeNetworkConsent?.manifest.title ??
            t("browser.task.projectPreview")
          }
          declarations={
            activeNetworkConsent
              ? projectH5NetworkDeclarations(activeNetworkConsent.manifest)
              : []
          }
          onAllow={() => finishNetworkConsent(true)}
          onDeny={() => finishNetworkConsent(false)}
          palette={palette}
          visible={Boolean(activeNetworkConsent)}
        />
        {activePreview ? (
          <ProjectH5PermissionDetailsSheet
            manifest={activePreview.app}
            networkState={activeNetworkDisplayState}
            onClose={() => setPermissionDetailsTarget(null)}
            onResetNetwork={resetActiveNetworkConsent}
            onResetPermission={resetActivePermissionConsent}
            palette={palette}
            permissionState={activePermissionDisplayState}
            title={activePreview.app.title}
            visible={permissionDetailsVisible}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  browserSurface: {
    bottom: 0,
    elevation: 12,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  progressTrack: { height: 2 },
  progressValue: { height: 2 },
  webContent: { flex: 1, overflow: "hidden" },
  webTask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  webTaskHidden: { opacity: 0 },
  toolbar: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-around",
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
});
