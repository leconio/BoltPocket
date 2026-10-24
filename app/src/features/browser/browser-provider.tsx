import { randomUUID } from "expo-crypto";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useI18n } from "@/i18n/i18n-provider";

import type {
  BrowserDriverStatus,
  BrowserSurfaceMode,
} from "@/application/ports/browser-control";
import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";
import { clearBrowserWebsiteData } from "@boltpocket/expo-browser-data";
import { appBrowserControlBridge } from "@/infrastructure/browser/browser-control-bridge";
import {
  BROWSER_CAPABILITY_KEYS,
  BrowserSettingsRepository,
  ISOLATED_PREVIEW_BROWSER_SETTINGS,
  type BrowserCapabilityKey,
  type BrowserSettings,
} from "@/infrastructure/browser/browser-settings-repository";
import { projectPreviewSnapshots } from "@/infrastructure/browser/expo-project-preview-snapshots";
import {
  BrowserSystemPermissionDeniedError,
  isBrowserSystemPermissionKey,
  requestBrowserSystemPermission,
} from "@/infrastructure/browser/browser-system-permissions";
import {
  normalizeBrowserInput,
  normalizeBrowserUrl,
} from "@/infrastructure/browser/browser-url";
import { ExpoEncryptedSqliteDocumentStore } from "@/infrastructure/persistence/expo-encrypted-sqlite-store";

import { resolveOpenProjectPreviewTask } from "./project-preview-task";

export type BrowserNavigationRequest = { id: number; url: string };

export type BrowserTaskSource =
  | { kind: "web" }
  | { kind: "agent-web" }
  | {
      kind: "project-preview";
      snapshot: ProjectPreviewSnapshot;
      agentOwned: boolean;
    };

export type BrowserTask = {
  id: string;
  createdAt: number;
  source: BrowserTaskSource;
  navigation: Omit<BrowserDriverStatus, "mode">;
  navigationRequest: BrowserNavigationRequest | null;
};

type BrowserContextValue = {
  mode: BrowserSurfaceMode;
  tasks: BrowserTask[];
  activeTaskId: string | null;
  activeTask: BrowserTask | null;
  navigation: BrowserDriverStatus;
  navigationRequest: BrowserNavigationRequest | null;
  settings: BrowserSettings;
  settingsLoading: boolean;
  settingsError: string | null;
  activationVersion: number;
  grantVersion: number;
  agentActivity: string | null;
  canCreateTask: boolean;
  open: (url?: string) => string;
  newTask: (url?: string) => string;
  newAgentTask: (url: string) => string;
  newPreviewTask: (
    snapshot: ProjectPreviewSnapshot,
    present: boolean,
    agentOwned?: boolean,
  ) => string;
  minimize: () => void;
  expand: () => void;
  expandTask: (taskId: string) => void;
  close: () => void;
  closeTask: (taskId: string) => void;
  clearData: () => Promise<void>;
  navigate: (input: string, taskId?: string) => string;
  updateNavigation: (
    taskId: string,
    status: Omit<BrowserDriverStatus, "mode">,
  ) => void;
  setCapability: (
    capability: BrowserCapabilityKey,
    enabled: boolean,
  ) => Promise<void>;
};

export type BrowserState = Pick<
  BrowserContextValue,
  | "mode"
  | "tasks"
  | "activeTaskId"
  | "settings"
  | "settingsLoading"
  | "settingsError"
  | "activationVersion"
  | "grantVersion"
  | "agentActivity"
>;

export type BrowserActions = Pick<
  BrowserContextValue,
  | "open"
  | "newTask"
  | "newAgentTask"
  | "newPreviewTask"
  | "minimize"
  | "expand"
  | "expandTask"
  | "close"
  | "closeTask"
  | "clearData"
  | "navigate"
  | "updateNavigation"
  | "setCapability"
>;

const MAX_BROWSER_TASKS = 8;

export function canCreateBrowserTask(state: BrowserState) {
  return state.tasks.length < MAX_BROWSER_TASKS;
}
const RELOAD_REQUIRED_CAPABILITIES: readonly BrowserCapabilityKey[] = [
  "autoplayMedia",
  "pictureInPicture",
  "airPlay",
];
const BrowserStoreContext = createContext<StoreApi<BrowserState> | null>(null);
const BrowserActionsContext = createContext<BrowserActions | null>(null);
const settingsRepository = new BrowserSettingsRepository(
  new ExpoEncryptedSqliteDocumentStore(),
);

const emptyNavigation: Omit<BrowserDriverStatus, "mode"> = {
  url: null,
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

function createBrowserStore() {
  return createStore<BrowserState>()(() => ({
    mode: "closed",
    tasks: [],
    activeTaskId: null,
    settings: ISOLATED_PREVIEW_BROWSER_SETTINGS,
    settingsLoading: true,
    settingsError: null,
    activationVersion: 0,
    grantVersion: 0,
    agentActivity: null,
  }));
}

type BrowserStateUpdate<Value> = Value | ((current: Value) => Value);

function updateBrowserField<Key extends keyof BrowserState>(
  store: StoreApi<BrowserState>,
  key: Key,
  update: BrowserStateUpdate<BrowserState[Key]>,
) {
  const current = store.getState()[key];
  const next =
    typeof update === "function"
      ? (update as (value: BrowserState[Key]) => BrowserState[Key])(current)
      : update;
  if (Object.is(current, next)) return;
  store.setState({ [key]: next } as Pick<BrowserState, Key>);
}

function createBrowserTask(
  navigationRequest: BrowserNavigationRequest | null,
  source: BrowserTaskSource,
): BrowserTask {
  return {
    id: `browser-${randomUUID()}`,
    createdAt: Date.now(),
    source,
    navigation: navigationRequest
      ? { ...emptyNavigation, url: navigationRequest.url, loading: true }
      : emptyNavigation,
    navigationRequest,
  };
}

export function BrowserProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const [store] = useState(createBrowserStore);
  const setMode = useCallback(
    (update: BrowserStateUpdate<BrowserSurfaceMode>) => {
      store.setState((state) => {
        const next = typeof update === "function" ? update(state.mode) : update;
        if (next === state.mode) return state;
        const crossesVisibleSession =
          state.mode === "expanded" || next === "expanded";
        return {
          mode: next,
          activationVersion:
            state.activationVersion + (crossesVisibleSession ? 1 : 0),
        };
      });
    },
    [store],
  );
  const setTasks = useCallback(
    (update: BrowserStateUpdate<BrowserTask[]>) =>
      updateBrowserField(store, "tasks", update),
    [store],
  );
  const setSettings = useCallback(
    (update: BrowserStateUpdate<BrowserSettings>) =>
      updateBrowserField(store, "settings", update),
    [store],
  );
  const setSettingsLoading = useCallback(
    (update: BrowserStateUpdate<boolean>) =>
      updateBrowserField(store, "settingsLoading", update),
    [store],
  );
  const setSettingsError = useCallback(
    (update: BrowserStateUpdate<string | null>) =>
      updateBrowserField(store, "settingsError", update),
    [store],
  );
  const setGrantVersion = useCallback(
    (update: BrowserStateUpdate<number>) =>
      updateBrowserField(store, "grantVersion", update),
    [store],
  );
  const setAgentActivity = useCallback(
    (update: BrowserStateUpdate<string | null>) =>
      updateBrowserField(store, "agentActivity", update),
    [store],
  );
  const navigationSequence = useRef(0);
  const tasksRef = useRef<BrowserTask[]>([]);
  const activeTaskIdRef = useRef<string | null>(null);
  const settingsRef = useRef<BrowserSettings>(
    ISOLATED_PREVIEW_BROWSER_SETTINGS,
  );
  const settingsWriteQueue = useRef(Promise.resolve());

  const replaceTasks = useCallback(
    (update: (current: BrowserTask[]) => BrowserTask[]) => {
      const current = tasksRef.current;
      const next = update(current);
      if (next === current) return current;
      tasksRef.current = next;
      setTasks(next);
      return next;
    },
    [setTasks],
  );

  const replaceActiveTaskId = useCallback(
    (taskId: string | null) => {
      if (activeTaskIdRef.current === taskId) return;
      activeTaskIdRef.current = taskId;
      store.setState((state) => ({
        activeTaskId: taskId,
        activationVersion: state.activationVersion + 1,
      }));
    },
    [store],
  );

  useEffect(() => {
    let active = true;
    void settingsRepository.load().then(
      (stored) => {
        if (!active) return;
        settingsRef.current = stored;
        setSettings(stored);
        setSettingsLoading(false);
      },
      () => {
        if (!active) return;
        setSettingsError(t("browser.provider.settings.readFailed"));
        setSettingsLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [setSettings, setSettingsError, setSettingsLoading, t]);

  useEffect(
    () =>
      appBrowserControlBridge.subscribeGrants(() =>
        setGrantVersion((value) => value + 1),
      ),
    [setGrantVersion],
  );

  useEffect(
    () => appBrowserControlBridge.subscribeActivity(setAgentActivity),
    [setAgentActivity],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") appBrowserControlBridge.clearGrants();
    });
    return () => subscription.remove();
  }, []);

  const nextNavigationRequest = useCallback((url: string) => {
    return {
      id: (navigationSequence.current += 1),
      url,
    };
  }, []);

  const newTask = useCallback(
    (url?: string) => {
      if (tasksRef.current.length >= MAX_BROWSER_TASKS) {
        throw new Error(
          t("browser.provider.maxTasks", { count: MAX_BROWSER_TASKS }),
        );
      }
      const request = url
        ? nextNavigationRequest(normalizeBrowserUrl(url))
        : null;
      const task = createBrowserTask(request, { kind: "web" });
      replaceTasks((current) => [...current, task]);
      replaceActiveTaskId(task.id);
      setMode("expanded");
      return task.id;
    },
    [nextNavigationRequest, replaceActiveTaskId, replaceTasks, setMode, t],
  );

  const newAgentTask = useCallback(
    (url: string) => {
      if (tasksRef.current.length >= MAX_BROWSER_TASKS) {
        throw new Error(
          t("browser.provider.maxTasks", { count: MAX_BROWSER_TASKS }),
        );
      }
      const request = nextNavigationRequest(normalizeBrowserUrl(url));
      const task = createBrowserTask(request, { kind: "agent-web" });
      const hadActiveTask = Boolean(activeTaskIdRef.current);
      replaceTasks((current) => [...current, task]);
      if (!hadActiveTask) replaceActiveTaskId(task.id);
      setMode((current) => (current === "closed" ? "minimized" : current));
      return task.id;
    },
    [nextNavigationRequest, replaceActiveTaskId, replaceTasks, setMode, t],
  );

  const newPreviewTask = useCallback(
    (
      snapshot: ProjectPreviewSnapshot,
      present: boolean,
      agentOwned = false,
    ) => {
      const resolution = resolveOpenProjectPreviewTask(
        tasksRef.current,
        snapshot,
        agentOwned,
      );
      if (
        resolution?.task.source.kind === "project-preview" &&
        resolution.replaceSnapshot
      ) {
        const request = nextNavigationRequest(snapshot.url);
        const previousSnapshot = resolution.task.source.snapshot;
        replaceTasks((current) =>
          current.map((task) =>
            task.id === resolution.task.id
              ? {
                  ...task,
                  source: {
                    kind: "project-preview",
                    snapshot,
                    agentOwned: true,
                  },
                  navigation: {
                    ...emptyNavigation,
                    url: snapshot.url,
                    loading: true,
                  },
                  navigationRequest: request,
                }
              : task,
          ),
        );
        if (previousSnapshot.id !== snapshot.id) {
          void Promise.resolve(
            projectPreviewSnapshots.release(previousSnapshot.id),
          ).catch(() => undefined);
        }
      } else if (resolution?.task.source.kind === "project-preview") {
        if (resolution.task.source.snapshot.id !== snapshot.id) {
          void Promise.resolve(
            projectPreviewSnapshots.release(snapshot.id),
          ).catch(() => undefined);
        }
      }
      if (resolution) {
        const hadActiveTask = Boolean(activeTaskIdRef.current);
        if (present || !hadActiveTask) replaceActiveTaskId(resolution.task.id);
        setMode((current) =>
          present ? "expanded" : current === "closed" ? "minimized" : current,
        );
        return resolution.task.id;
      }
      if (tasksRef.current.length >= MAX_BROWSER_TASKS) {
        throw new Error(
          t("browser.provider.maxTasks", { count: MAX_BROWSER_TASKS }),
        );
      }
      const request = nextNavigationRequest(snapshot.url);
      const task = createBrowserTask(request, {
        kind: "project-preview",
        snapshot,
        agentOwned,
      });
      const hadActiveTask = Boolean(activeTaskIdRef.current);
      replaceTasks((current) => [...current, task]);
      if (present || !hadActiveTask) replaceActiveTaskId(task.id);
      setMode((current) =>
        present ? "expanded" : current === "closed" ? "minimized" : current,
      );
      return task.id;
    },
    [nextNavigationRequest, replaceActiveTaskId, replaceTasks, setMode, t],
  );

  const navigate = useCallback(
    (input: string, taskId = activeTaskIdRef.current ?? "") => {
      if (!taskId || !tasksRef.current.some((task) => task.id === taskId)) {
        throw new Error(t("browser.provider.taskMissing"));
      }
      const task = tasksRef.current.find(
        (candidate) => candidate.id === taskId,
      )!;
      if (task.source.kind === "project-preview") {
        throw new Error(t("browser.provider.localPreviewNavigationBlocked"));
      }
      const url = normalizeBrowserInput(input);
      const request = nextNavigationRequest(url);
      replaceTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                navigation: { ...task.navigation, url, loading: true },
                navigationRequest: request,
              }
            : task,
        ),
      );
      return url;
    },
    [nextNavigationRequest, replaceTasks, t],
  );

  const open = useCallback(
    (url?: string) => {
      const task = tasksRef.current.find(
        (candidate) => candidate.id === activeTaskIdRef.current,
      );
      if (!task) return newTask(url);
      if (url && task.source.kind === "project-preview") return newTask(url);
      if (url) navigate(normalizeBrowserUrl(url), task.id);
      setMode("expanded");
      return task.id;
    },
    [navigate, newTask, setMode],
  );

  const minimize = useCallback(() => {
    if (tasksRef.current.length > 0) setMode("minimized");
  }, [setMode]);

  const expand = useCallback(() => {
    if (activeTaskIdRef.current) setMode("expanded");
  }, [setMode]);

  const expandTask = useCallback(
    (taskId: string) => {
      if (!tasksRef.current.some((task) => task.id === taskId)) {
        throw new Error(t("browser.provider.taskMissing"));
      }
      replaceActiveTaskId(taskId);
      setMode("expanded");
    },
    [replaceActiveTaskId, setMode, t],
  );

  const closeTask = useCallback(
    (taskId: string) => {
      const current = tasksRef.current;
      const removedIndex = current.findIndex((task) => task.id === taskId);
      const next = current.filter((task) => task.id !== taskId);
      if (next.length === current.length) return;
      const removed = current.find((task) => task.id === taskId);
      if (removed?.source.kind === "project-preview") {
        void Promise.resolve(
          projectPreviewSnapshots.release(removed.source.snapshot.id),
        ).catch(() => undefined);
      }
      appBrowserControlBridge.releaseTask(taskId);
      replaceTasks(() => next);
      if (next.length === 0) {
        appBrowserControlBridge.clearGrants();
        replaceActiveTaskId(null);
        setMode("closed");
        setAgentActivity(null);
        return;
      }
      if (activeTaskIdRef.current === taskId) {
        replaceActiveTaskId(next[Math.min(removedIndex, next.length - 1)]!.id);
      }
    },
    [replaceActiveTaskId, replaceTasks, setAgentActivity, setMode],
  );

  const close = useCallback(() => {
    const taskId = activeTaskIdRef.current;
    if (taskId) closeTask(taskId);
  }, [closeTask]);

  const clearData = useCallback(async () => {
    const current = tasksRef.current;
    const releases = current.flatMap((task) =>
      task.source.kind === "project-preview"
        ? [
            Promise.resolve(
              projectPreviewSnapshots.release(task.source.snapshot.id),
            ).catch(() => undefined),
          ]
        : [],
    );
    current.forEach((task) => appBrowserControlBridge.releaseTask(task.id));
    appBrowserControlBridge.clearGrants();
    replaceTasks(() => []);
    replaceActiveTaskId(null);
    setMode("closed");
    setAgentActivity(null);
    await Promise.all(releases);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await clearBrowserWebsiteData();
  }, [replaceActiveTaskId, replaceTasks, setAgentActivity, setMode]);

  const updateNavigation = useCallback(
    (taskId: string, status: Omit<BrowserDriverStatus, "mode">) => {
      const title = status.title.slice(0, 240);
      replaceTasks((current) => {
        const currentTask = current.find((task) => task.id === taskId);
        if (
          !currentTask ||
          (currentTask.navigation.url === status.url &&
            currentTask.navigation.title === title &&
            currentTask.navigation.canGoBack === status.canGoBack &&
            currentTask.navigation.canGoForward === status.canGoForward &&
            currentTask.navigation.loading === status.loading)
        ) {
          return current;
        }
        return current.map((task) =>
          task.id === taskId
            ? { ...task, navigation: { ...status, title } }
            : task,
        );
      });
    },
    [replaceTasks],
  );

  const setCapability = useCallback(
    async (capability: BrowserCapabilityKey, enabled: boolean) => {
      if (
        !BROWSER_CAPABILITY_KEYS.some(
          (candidate) => candidate === capability,
        ) ||
        typeof enabled !== "boolean"
      ) {
        throw new Error(t("browser.provider.invalidSettings"));
      }
      const previous = settingsRef.current;
      if (previous[capability] === enabled) return;
      if (enabled && isBrowserSystemPermissionKey(capability)) {
        const permission = await requestBrowserSystemPermission(capability);
        if (permission.status !== "granted") {
          throw new BrowserSystemPermissionDeniedError(capability, permission);
        }
      }
      const next = Object.freeze({ ...previous, [capability]: enabled });
      if (
        RELOAD_REQUIRED_CAPABILITIES.some(
          (candidate) => candidate === capability,
        )
      ) {
        replaceTasks((current) =>
          current.map((task) => {
            const url = task.navigation.url;
            if (task.source.kind === "project-preview" || !url) return task;
            return {
              ...task,
              navigation: { ...task.navigation, loading: true },
              navigationRequest: {
                id: (navigationSequence.current += 1),
                url,
              },
            };
          }),
        );
      }
      settingsRef.current = next;
      setSettings(next);
      setSettingsError(null);
      const operation = settingsWriteQueue.current.then(() =>
        settingsRepository.save(next),
      );
      settingsWriteQueue.current = operation.catch(() => undefined);
      try {
        await operation;
      } catch {
        if (settingsRef.current === next) {
          settingsRef.current = previous;
          setSettings(previous);
        }
        const message = t("browser.provider.settings.saveFailed");
        setSettingsError(message);
        throw new Error(message);
      }
    },
    [replaceTasks, setSettings, setSettingsError, t],
  );

  const actions = useMemo<BrowserActions>(
    () => ({
      open,
      newTask,
      newAgentTask,
      newPreviewTask,
      minimize,
      expand,
      expandTask,
      close,
      closeTask,
      clearData,
      navigate,
      updateNavigation,
      setCapability,
    }),
    [
      clearData,
      close,
      closeTask,
      expand,
      expandTask,
      minimize,
      navigate,
      newAgentTask,
      newPreviewTask,
      newTask,
      open,
      setCapability,
      updateNavigation,
    ],
  );

  return (
    <BrowserActionsContext.Provider value={actions}>
      <BrowserStoreContext.Provider value={store}>
        {children}
      </BrowserStoreContext.Provider>
    </BrowserActionsContext.Provider>
  );
}

export function useBrowserState<Selection>(
  selector: (state: BrowserState) => Selection,
) {
  const store = useContext(BrowserStoreContext);
  if (!store) {
    throw new Error("useBrowserState must be used inside BrowserProvider.");
  }
  return useStore(store, selector);
}

export function useBrowserActions() {
  const value = useContext(BrowserActionsContext);
  if (!value) {
    throw new Error("useBrowserActions must be used inside BrowserProvider.");
  }
  return value;
}
