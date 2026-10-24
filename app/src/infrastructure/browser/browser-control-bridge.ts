import type {
  AgentBrowserControlInput,
  AgentBrowserControlPort,
  AgentBrowserControlResult,
  BrowserDriverStatus,
  BrowserPageFindResult,
  BrowserPageInteractionReceipt,
  BrowserPageSnapshot,
  BrowserPageTextChunk,
} from "@/application/ports/browser-control";
import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";

import {
  browserOrigin,
  browserUrlForModel,
  isAgentSafeBrowserUrl,
  normalizeBrowserUrl,
  sameBrowserOrigin,
} from "./browser-url";
import {
  MAX_BROWSER_INPUT_TEXT_LENGTH,
  MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
  MAX_BROWSER_TEXT_QUERY_LENGTH,
  parseBrowserPageFindResult,
  parseBrowserPageSnapshot,
  parseBrowserPageTextChunk,
  sanitizeBrowserPageFindResult,
  sanitizeBrowserPageSnapshot,
  sanitizeBrowserPageTextChunk,
} from "./browser-page-snapshot";

const MAX_BROWSER_WAIT_TIMEOUT_MS = 5_000;
const BROWSER_WAIT_POLL_INTERVAL_MS = 200;

export type BrowserControlDriverStatus = BrowserDriverStatus & {
  taskId: string | null;
};

export type BrowserControlDriver = {
  status: (taskId?: string) => BrowserControlDriverStatus;
  open: (
    url: string,
  ) => BrowserControlDriverStatus | Promise<BrowserControlDriverStatus>;
  openPreview: (
    snapshot: ProjectPreviewSnapshot,
    present: boolean,
  ) => BrowserControlDriverStatus | Promise<BrowserControlDriverStatus>;
  close: (taskId: string) => Promise<void> | void;
  snapshot: (
    taskId: string,
    signal?: AbortSignal,
  ) => Promise<BrowserPageSnapshot>;
  readText: (
    taskId: string,
    offset: number,
    signal?: AbortSignal,
  ) => Promise<BrowserPageTextChunk>;
  findText: (
    taskId: string,
    query: string,
    signal?: AbortSignal,
  ) => Promise<BrowserPageFindResult>;
  click: (
    taskId: string,
    targetId: string,
    revision: string,
    signal?: AbortSignal,
  ) => Promise<BrowserPageInteractionReceipt>;
  type: (
    taskId: string,
    targetId: string,
    revision: string,
    text: string,
    signal?: AbortSignal,
  ) => Promise<BrowserPageInteractionReceipt>;
  navigate: (taskId: string, url: string) => Promise<void> | void;
  scroll: (taskId: string, direction: "up" | "down") => Promise<void> | void;
  highlight: (taskId: string, targetId: string) => Promise<void> | void;
  back: (taskId: string) => Promise<void> | void;
  forward: (taskId: string) => Promise<void> | void;
  reload: (taskId: string) => Promise<void> | void;
};

type GrantListener = () => void;
type ActivityListener = (label: string | null) => void;
type ProjectPreviewBoundary = Readonly<{
  origin: string;
  pathPrefix: string;
}>;
type ManagedBrowserTask = {
  projectId: string;
  runId: string;
} & (
  | { kind: "web"; handedOff: false }
  | {
      kind: "project-preview";
      handedOff: true;
      snapshot: ProjectPreviewSnapshot;
      boundary: ProjectPreviewBoundary;
    }
);
type ResolvedBrowserTask = {
  managed: boolean;
  scope?: ManagedBrowserTask;
  status: BrowserControlDriverStatus;
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("Agent 浏览器操作已取消。");
  error.name = "AbortError";
  throw error;
}

function assertScopeId(value: string, label: string) {
  if (!value.trim() || value.length > 160 || value.includes("\0")) {
    throw new Error(`${label}无效。`);
  }
}

function assertTaskId(taskId: string) {
  if (
    !taskId.trim() ||
    taskId.length > 200 ||
    taskId.includes("\0") ||
    !taskId.startsWith("browser-")
  ) {
    throw new Error("浏览器任务编号无效。");
  }
}

function assertRevisionInput(revision: string) {
  if (!revision.trim() || revision.length > 240 || revision.includes("\0")) {
    throw new Error("网页版本无效。");
  }
}

function assertTextOffset(offset: number) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > MAX_BROWSER_SEARCHABLE_TEXT_LENGTH
  ) {
    throw new Error("网页文字偏移无效。");
  }
}

function normalizeTextQuery(query: string) {
  const normalized = query.trim();
  if (
    !normalized ||
    normalized.length > MAX_BROWSER_TEXT_QUERY_LENGTH ||
    normalized.includes("\0")
  ) {
    throw new Error("网页查找文字无效。");
  }
  return normalized;
}

function assertWaitInput(condition: "present" | "absent", timeoutMs: number) {
  if (condition !== "present" && condition !== "absent") {
    throw new Error("网页等待条件无效。");
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_BROWSER_WAIT_TIMEOUT_MS
  ) {
    throw new Error("网页等待时间无效。");
  }
}

function normalizeInputText(text: string) {
  if (
    typeof text !== "string" ||
    text.length > MAX_BROWSER_INPUT_TEXT_LENGTH ||
    text.includes("\0")
  ) {
    throw new Error("网页输入文字无效或过长。");
  }
  return text;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      const error = new Error("Agent 浏览器操作已取消。");
      error.name = "AbortError";
      finish(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(), milliseconds);
  });
}

function normalizedFileRoot(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("项目预览目录无效。");
  }
  if (
    parsed.protocol !== "file:" ||
    parsed.host ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("项目预览目录无效。");
  }
  try {
    return decodeURIComponent(parsed.pathname).replace(/\/?$/u, "/");
  } catch {
    throw new Error("项目预览目录无效。");
  }
}

function previewBoundary(snapshot: ProjectPreviewSnapshot) {
  let parsed: URL;
  try {
    parsed = new URL(snapshot.url);
  } catch {
    throw new Error("项目预览地址无效。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("项目预览地址无效。");
  }
  const root = normalizedFileRoot(snapshot.rootUri);
  if (!root.endsWith(`/${snapshot.id}/`)) {
    throw new Error("项目预览目录无效。");
  }
  const androidPathPrefix = "/content/";
  const iosPathPrefix = `/${snapshot.id}/content/`;
  const androidOrigin =
    parsed.protocol === "https:" &&
    parsed.hostname === `preview-${snapshot.id}.boltpocket.invalid` &&
    !parsed.port &&
    parsed.pathname.startsWith(androidPathPrefix);
  const iosOrigin =
    parsed.protocol === "http:" &&
    parsed.hostname === "127.0.0.1" &&
    /^\d{2,5}$/u.test(parsed.port) &&
    Number(parsed.port) >= 1_024 &&
    Number(parsed.port) <= 65_535 &&
    parsed.pathname.startsWith(iosPathPrefix);
  if ((!androidOrigin && !iosOrigin) || parsed.search || parsed.hash) {
    throw new Error("项目预览地址无效。");
  }
  return {
    origin: `${parsed.protocol}//${parsed.host}`,
    pathPrefix: iosOrigin ? iosPathPrefix : androidPathPrefix,
  } as const;
}

function isWithinPreviewBoundary(
  boundary: ProjectPreviewBoundary,
  value: string,
) {
  try {
    const parsed = new URL(value);
    return (
      !parsed.username &&
      !parsed.password &&
      `${parsed.protocol}//${parsed.host}` === boundary.origin &&
      parsed.pathname.startsWith(boundary.pathPrefix)
    );
  } catch {
    return false;
  }
}

function assertPreviewSnapshot(
  snapshot: ProjectPreviewSnapshot,
  projectId: string,
) {
  if (
    snapshot.projectId !== projectId ||
    !/^[a-f0-9]{32}$/u.test(snapshot.id) ||
    !snapshot.entryPath.startsWith("/project/") ||
    !snapshot.displayPath ||
    snapshot.displayPath.startsWith("/") ||
    snapshot.displayPath
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    !snapshot.rootUri.startsWith("file://") ||
    snapshot.fileCount < 1 ||
    snapshot.fileCount > 512 ||
    snapshot.byteLength < 1 ||
    snapshot.byteLength > 8 * 1024 * 1024
  ) {
    throw new Error("项目预览快照无效。");
  }
  return previewBoundary(snapshot);
}

function closedStatus(): BrowserControlDriverStatus {
  return {
    taskId: null,
    mode: "closed",
    url: null,
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
}

export class BrowserControlBridge implements AgentBrowserControlPort {
  #driver?: BrowserControlDriver;
  readonly #grants = new Set<string>();
  readonly #managedTasks = new Map<string, ManagedBrowserTask>();
  readonly #interactedPreviewTasks = new Set<string>();
  readonly #grantListeners = new Set<GrantListener>();
  readonly #activityListeners = new Set<ActivityListener>();

  registerDriver(driver: BrowserControlDriver) {
    this.#driver = driver;
    this.#emitAccessChange();
    return () => {
      if (this.#driver !== driver) return;
      this.#driver = undefined;
      this.#managedTasks.clear();
      this.#interactedPreviewTasks.clear();
      this.clearGrants();
      this.#emitAccessChange();
    };
  }

  subscribeGrants(listener: GrantListener) {
    this.#grantListeners.add(listener);
    return () => {
      this.#grantListeners.delete(listener);
    };
  }

  subscribeActivity(listener: ActivityListener) {
    this.#activityListeners.add(listener);
    listener(null);
    return () => {
      this.#activityListeners.delete(listener);
    };
  }

  grant(projectId: string, url: string) {
    assertScopeId(projectId, "项目编号");
    const origin = browserOrigin(url);
    if (!origin || !isAgentSafeBrowserUrl(url)) {
      throw new Error("Agent 只能访问不含账号或密码的 HTTP 或 HTTPS 网站。");
    }
    this.#grants.add(this.#grantKey(projectId, origin));
    this.#emitAccessChange();
  }

  revoke(projectId: string, url: string) {
    const origin = browserOrigin(url);
    if (!origin) return;
    this.#grants.delete(this.#grantKey(projectId, origin));
    this.#emitAccessChange();
  }

  clearGrants() {
    if (this.#grants.size === 0) return;
    this.#grants.clear();
    this.#emitAccessChange();
  }

  isGranted(projectId: string | null, url: string | null) {
    if (!projectId || !url || !isAgentSafeBrowserUrl(url)) return false;
    const origin = browserOrigin(url);
    return Boolean(
      origin && this.#grants.has(this.#grantKey(projectId, origin)),
    );
  }

  isManaged(projectId: string | null, taskId: string | null) {
    if (!projectId || !taskId) return false;
    return this.#managedTasks.get(taskId)?.projectId === projectId;
  }

  managedProjectId(taskId: string) {
    return this.#managedTasks.get(taskId)?.projectId ?? null;
  }

  runsWhileHidden(taskId: string) {
    const scope = this.#managedTasks.get(taskId);
    return scope?.kind === "web" && !scope.handedOff;
  }

  releaseTask(taskId: string) {
    this.#interactedPreviewTasks.delete(taskId);
    if (!this.#managedTasks.delete(taskId)) return;
    this.#emitAccessChange();
  }

  async closeRun(projectId: string, runId: string) {
    assertScopeId(projectId, "项目编号");
    assertScopeId(runId, "运行编号");
    const driver = this.#driver;
    const taskIds = [...this.#managedTasks]
      .filter(
        ([, scope]) =>
          scope.projectId === projectId &&
          scope.runId === runId &&
          !scope.handedOff,
      )
      .map(([taskId]) => taskId);
    const previewTaskIds = [...this.#interactedPreviewTasks].filter(
      (taskId) => {
        const scope = this.#managedTasks.get(taskId);
        return scope?.projectId === projectId && scope.runId === runId;
      },
    );
    let firstError: unknown;
    for (const taskId of taskIds) {
      try {
        await driver?.close(taskId);
        this.#managedTasks.delete(taskId);
        this.#interactedPreviewTasks.delete(taskId);
      } catch (error) {
        firstError ??= error;
      }
    }
    for (const taskId of previewTaskIds) {
      try {
        await driver?.reload(taskId);
        this.#interactedPreviewTasks.delete(taskId);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (taskIds.length) this.#emitAccessChange();
    if (firstError) throw firstError;
  }

  async execute(
    input: AgentBrowserControlInput,
    signal?: AbortSignal,
  ): Promise<AgentBrowserControlResult> {
    assertScopeId(input.projectId, "项目编号");
    assertScopeId(input.runId, "运行编号");
    throwIfAborted(signal);
    const driver = this.#driver;

    if (input.action === "open") {
      if (!driver) throw new Error("应用浏览器当前不可用。");
      const target = normalizeBrowserUrl(input.url);
      if (!isAgentSafeBrowserUrl(target)) {
        throw new Error("Agent 只能打开 HTTP 或 HTTPS 网站。");
      }
      this.#emitActivity("打开临时网页");
      try {
        const status = await driver.open(target);
        if (!status.taskId) throw new Error("浏览器未能创建临时网页。");
        assertTaskId(status.taskId);
        this.#managedTasks.set(status.taskId, {
          projectId: input.projectId,
          runId: input.runId,
          kind: "web",
          handedOff: false,
        });
        this.#emitAccessChange();
        return {
          action: "open",
          completed: true,
          managed: true,
          ...status,
          taskId: status.taskId,
          url: browserUrlForModel(status.url),
          title: status.title.slice(0, 240),
        };
      } finally {
        this.#emitActivity(null);
      }
    }

    if (input.action === "preview") {
      if (!driver) throw new Error("应用浏览器当前不可用。");
      const boundary = assertPreviewSnapshot(input.snapshot, input.projectId);
      this.#emitActivity("打开项目预览");
      try {
        const status = await driver.openPreview(input.snapshot, input.present);
        if (!status.taskId) throw new Error("浏览器未能创建项目预览。");
        assertTaskId(status.taskId);
        this.#managedTasks.set(status.taskId, {
          projectId: input.projectId,
          runId: input.runId,
          kind: "project-preview",
          handedOff: true,
          snapshot: input.snapshot,
          boundary,
        });
        this.#emitAccessChange();
        return {
          action: "preview",
          completed: true,
          managed: true,
          handedOff: true,
          ...status,
          taskId: status.taskId,
          url: this.#modelUrl(
            this.#managedTasks.get(status.taskId),
            status.url,
          ),
          title: `本地预览 · ${input.snapshot.displayPath}`.slice(0, 240),
          entryPath: input.snapshot.entryPath,
          fileCount: input.snapshot.fileCount,
        };
      } finally {
        this.#emitActivity(null);
      }
    }

    const resolved = driver
      ? this.#resolveTask(driver, input.projectId, input.runId, input.taskId)
      : { managed: false, status: closedStatus() };
    const { managed, scope: managedScope, status } = resolved;
    const authorized = managed || this.isGranted(input.projectId, status.url);

    if (input.action === "status") {
      return {
        action: "status",
        ...status,
        url: this.#modelUrl(managedScope, status.url),
        title: authorized ? status.title.slice(0, 240) : "",
        authorized,
        managed,
      };
    }

    if (input.action === "close") {
      if (!driver || !managed || !status.taskId || managedScope?.handedOff) {
        throw new Error("只能关闭当前运行由 Agent 创建的临时网页。");
      }
      this.#emitActivity("关闭临时网页");
      try {
        await driver.close(status.taskId);
        this.#managedTasks.delete(status.taskId);
        this.#interactedPreviewTasks.delete(status.taskId);
        this.#emitAccessChange();
        return {
          action: "close",
          completed: true,
          taskId: status.taskId,
          url: null,
        };
      } finally {
        this.#emitActivity(null);
      }
    }

    if (!driver || status.mode === "closed" || !status.taskId || !status.url) {
      throw new Error("应用浏览器尚未打开。");
    }
    if (!authorized) {
      throw new Error(
        "当前项目尚未获准访问这个网站。请让 Agent 自己打开临时网页，或由用户授权当前页面。",
      );
    }
    const currentUrl =
      managedScope?.kind === "project-preview"
        ? status.url
        : normalizeBrowserUrl(status.url);
    if (
      managedScope?.kind === "project-preview"
        ? !isWithinPreviewBoundary(managedScope.boundary, currentUrl)
        : !isAgentSafeBrowserUrl(currentUrl)
    ) {
      throw new Error("浏览器任务跳转到了不支持的地址。");
    }

    this.#emitActivity(
      {
        snapshot: "读取网页",
        read_text: "继续读取网页",
        find_text: "查找网页文字",
        wait_for_text: "等待网页文字",
        navigate: "打开网页",
        click: "点击网页控件",
        type: "输入网页文字",
        follow_link: "跟随链接",
        highlight: "定位控件",
        scroll: "滚动网页",
        back: "后退",
        forward: "前进",
        reload: "刷新网页",
      }[input.action],
    );
    try {
      if (input.action === "snapshot") {
        const snapshot = await this.#currentSnapshot(
          driver,
          status.taskId,
          currentUrl,
          managed,
          managedScope,
          signal,
        );
        const sanitized = sanitizeBrowserPageSnapshot(snapshot, (url) =>
          this.#modelUrl(managedScope, url),
        );
        const interactive =
          managedScope?.kind === "web" ||
          (managedScope?.kind === "project-preview" &&
            managedScope.snapshot.app.permissions.length === 0);
        return {
          action: "snapshot",
          taskId: status.taskId,
          snapshot: interactive
            ? sanitized
            : {
                ...sanitized,
                controls: sanitized.controls.map((control) => ({
                  ...control,
                  actions: [],
                })),
              },
          untrusted: true,
        };
      }

      if (input.action === "read_text") {
        assertRevisionInput(input.revision);
        assertTextOffset(input.offset);
        const chunk = await this.#currentTextChunk(
          driver,
          status.taskId,
          currentUrl,
          managed,
          input.offset,
          managedScope,
          signal,
        );
        this.#assertRevision(chunk, input.revision);
        return {
          action: "read_text",
          taskId: status.taskId,
          chunk: sanitizeBrowserPageTextChunk(chunk, (url) =>
            this.#modelUrl(managedScope, url),
          ),
          untrusted: true,
        };
      }

      if (input.action === "find_text") {
        assertRevisionInput(input.revision);
        const query = normalizeTextQuery(input.query);
        const result = await this.#currentFindResult(
          driver,
          status.taskId,
          currentUrl,
          managed,
          query,
          managedScope,
          signal,
        );
        this.#assertRevision(result, input.revision);
        return {
          action: "find_text",
          taskId: status.taskId,
          result: sanitizeBrowserPageFindResult(result, (url) =>
            this.#modelUrl(managedScope, url),
          ),
          untrusted: true,
        };
      }

      if (input.action === "wait_for_text") {
        const query = normalizeTextQuery(input.query);
        assertWaitInput(input.condition, input.timeoutMs);
        const waited = await this.#waitForText(
          driver,
          status.taskId,
          input.projectId,
          currentUrl,
          managed,
          query,
          input.condition,
          input.timeoutMs,
          managedScope,
          signal,
        );
        return {
          action: "wait_for_text",
          taskId: status.taskId,
          condition: input.condition,
          matched: waited.matched,
          timedOut: !waited.matched,
          waitedMs: waited.waitedMs,
          result: sanitizeBrowserPageFindResult(waited.result, (url) =>
            this.#modelUrl(managedScope, url),
          ),
          untrusted: true,
        };
      }

      if (input.action === "navigate") {
        if (managedScope?.kind === "project-preview") {
          throw new Error("项目预览地址固定，不能导航到其他网站。");
        }
        const target = normalizeBrowserUrl(input.url);
        if (
          !isAgentSafeBrowserUrl(target) ||
          (!managed && !sameBrowserOrigin(currentUrl, target))
        ) {
          throw new Error(
            managed
              ? "Agent 只能打开 HTTP 或 HTTPS 网站。"
              : "Agent 只能在用户已授权的当前网站内导航。",
          );
        }
        await driver.navigate(status.taskId, target);
        return this.#completed("navigate", status.taskId, target, managedScope);
      }

      if (input.action === "click" || input.action === "type") {
        const interactivePreview =
          managedScope?.kind === "project-preview" &&
          managedScope.snapshot.app.permissions.length === 0;
        if (
          !managedScope ||
          (managedScope.kind !== "web" && !interactivePreview)
        ) {
          throw new Error(
            managedScope?.kind === "project-preview"
              ? "声明了原生权限的项目预览只能由用户操作。"
              : "点击和输入只允许在当前运行由 Agent 创建的临时网页或安全项目预览中执行。",
          );
        }
        assertRevisionInput(input.revision);
        const snapshot = await this.#currentSnapshot(
          driver,
          status.taskId,
          currentUrl,
          managed,
          managedScope,
          signal,
        );
        this.#assertRevision(snapshot, input.revision);
        const control = snapshot.controls.find(
          (candidate) => candidate.id === input.targetId,
        );
        if (
          !control ||
          control.disabled ||
          control.sensitive ||
          !control.actions.includes(input.action)
        ) {
          throw new Error(
            input.action === "click"
              ? "目标控件不允许由 Agent 点击。"
              : "目标输入框不允许由 Agent 输入。",
          );
        }

        if (input.action === "click" && control.kind === "link") {
          if (!control.href) throw new Error("目标链接已经变化或不可用。");
          if (interactivePreview) {
            if (!isWithinPreviewBoundary(managedScope.boundary, control.href)) {
              throw new Error("项目预览只能点击当前快照内的链接。");
            }
            this.#interactedPreviewTasks.add(status.taskId);
            const receipt = await driver.click(
              status.taskId,
              control.id,
              input.revision,
              signal,
            );
            this.#assertInteractionReceipt(
              receipt,
              "click",
              control.id,
              input.revision,
              currentUrl,
              managedScope,
            );
            return this.#completed(
              "click",
              status.taskId,
              currentUrl,
              managedScope,
              { targetId: control.id },
            );
          }
          const target = normalizeBrowserUrl(control.href);
          if (!isAgentSafeBrowserUrl(target)) {
            throw new Error("Agent 只能点击 HTTP 或 HTTPS 链接。");
          }
          await driver.navigate(status.taskId, target);
          return this.#completed("click", status.taskId, target, managedScope, {
            targetId: control.id,
          });
        }

        if (input.action === "click") {
          if (interactivePreview) {
            this.#interactedPreviewTasks.add(status.taskId);
          }
          const receipt = await driver.click(
            status.taskId,
            control.id,
            input.revision,
            signal,
          );
          this.#assertInteractionReceipt(
            receipt,
            "click",
            control.id,
            input.revision,
            currentUrl,
            managedScope,
          );
          return this.#completed(
            "click",
            status.taskId,
            currentUrl,
            managedScope,
            { targetId: control.id },
          );
        }

        const text = normalizeInputText(input.text);
        if (interactivePreview) {
          this.#interactedPreviewTasks.add(status.taskId);
        }
        const receipt = await driver.type(
          status.taskId,
          control.id,
          input.revision,
          text,
          signal,
        );
        this.#assertInteractionReceipt(
          receipt,
          "type",
          control.id,
          input.revision,
          currentUrl,
          managedScope,
        );
        return this.#completed(
          "type",
          status.taskId,
          currentUrl,
          managedScope,
          { targetId: control.id, inputLength: receipt.inputLength },
        );
      }

      if (input.action === "follow_link") {
        const snapshot = await this.#currentSnapshot(
          driver,
          status.taskId,
          currentUrl,
          managed,
          managedScope,
          signal,
        );
        this.#assertRevision(snapshot, input.revision);
        const control = snapshot.controls.find(
          (candidate) => candidate.id === input.targetId,
        );
        if (!control?.href || control.kind !== "link" || control.disabled) {
          throw new Error("目标不是当前页面中的可用链接。");
        }
        if (managedScope?.kind === "project-preview") {
          throw new Error("项目预览中的链接需要由用户自行打开。");
        }
        const target = normalizeBrowserUrl(control.href);
        if (
          !isAgentSafeBrowserUrl(target) ||
          (!managed && !sameBrowserOrigin(currentUrl, target))
        ) {
          throw new Error(
            managed
              ? "Agent 只能跟随 HTTP 或 HTTPS 链接。"
              : "跨网站链接需要用户先打开并单独授权。",
          );
        }
        await driver.navigate(status.taskId, target);
        return this.#completed(
          "follow_link",
          status.taskId,
          target,
          managedScope,
        );
      }

      if (input.action === "highlight") {
        const snapshot = await this.#currentSnapshot(
          driver,
          status.taskId,
          currentUrl,
          managed,
          managedScope,
          signal,
        );
        this.#assertRevision(snapshot, input.revision);
        const control = snapshot.controls.find(
          (candidate) => candidate.id === input.targetId,
        );
        if (!control || control.disabled) {
          throw new Error("目标控件已经变化或不可用。");
        }
        await driver.highlight(status.taskId, control.id);
        return this.#completed(
          "highlight",
          status.taskId,
          currentUrl,
          managedScope,
        );
      }

      throwIfAborted(signal);
      if (input.action === "scroll") {
        await driver.scroll(status.taskId, input.direction);
      } else if (input.action === "back") {
        if (!status.canGoBack) throw new Error("当前网页不能后退。");
        await driver.back(status.taskId);
      } else if (input.action === "forward") {
        if (!status.canGoForward) throw new Error("当前网页不能前进。");
        await driver.forward(status.taskId);
      } else {
        await driver.reload(status.taskId);
      }
      return this.#completed(
        input.action,
        status.taskId,
        currentUrl,
        managedScope,
      );
    } finally {
      this.#emitActivity(null);
    }
  }

  #resolveTask(
    driver: BrowserControlDriver,
    projectId: string,
    runId: string,
    requestedTaskId?: string,
  ): ResolvedBrowserTask {
    if (requestedTaskId) {
      assertTaskId(requestedTaskId);
      const scope = this.#managedTasks.get(requestedTaskId);
      if (scope) {
        if (scope.projectId !== projectId || scope.runId !== runId) {
          throw new Error("这个临时网页不属于当前项目运行。");
        }
        return {
          managed: true,
          scope,
          status: driver.status(requestedTaskId),
        };
      }
      const current = driver.status();
      if (current.taskId !== requestedTaskId) {
        throw new Error("浏览器任务不存在或不可访问。");
      }
      return { managed: false, status: current };
    }

    const managedTaskId = [...this.#managedTasks]
      .reverse()
      .find(
        ([, scope]) => scope.projectId === projectId && scope.runId === runId,
      )?.[0];
    if (managedTaskId) {
      return {
        managed: true,
        scope: this.#managedTasks.get(managedTaskId),
        status: driver.status(managedTaskId),
      };
    }
    return { managed: false, status: driver.status() };
  }

  async #currentSnapshot(
    driver: BrowserControlDriver,
    taskId: string,
    currentUrl: string,
    managed: boolean,
    managedScope?: ManagedBrowserTask,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal);
    const snapshot = parseBrowserPageSnapshot(
      await driver.snapshot(taskId, signal),
    );
    throwIfAborted(signal);
    this.#assertPageUrl(snapshot.url, currentUrl, managed, managedScope);
    return snapshot;
  }

  async #currentTextChunk(
    driver: BrowserControlDriver,
    taskId: string,
    currentUrl: string,
    managed: boolean,
    offset: number,
    managedScope?: ManagedBrowserTask,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal);
    const chunk = parseBrowserPageTextChunk(
      await driver.readText(taskId, offset, signal),
    );
    throwIfAborted(signal);
    this.#assertPageUrl(chunk.url, currentUrl, managed, managedScope);
    return chunk;
  }

  async #currentFindResult(
    driver: BrowserControlDriver,
    taskId: string,
    currentUrl: string,
    managed: boolean,
    query: string,
    managedScope?: ManagedBrowserTask,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal);
    const result = parseBrowserPageFindResult(
      await driver.findText(taskId, query, signal),
    );
    throwIfAborted(signal);
    this.#assertPageUrl(result.url, currentUrl, managed, managedScope);
    return result;
  }

  async #waitForText(
    driver: BrowserControlDriver,
    taskId: string,
    projectId: string,
    currentUrl: string,
    managed: boolean,
    query: string,
    condition: "present" | "absent",
    timeoutMs: number,
    managedScope?: ManagedBrowserTask,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    while (true) {
      if (!managed) {
        const liveStatus = driver.status(taskId);
        if (!liveStatus.url || !this.isGranted(projectId, liveStatus.url)) {
          throw new Error("当前项目对这个网站的临时授权已经失效。");
        }
      }
      const result = await this.#currentFindResult(
        driver,
        taskId,
        currentUrl,
        managed,
        query,
        managedScope,
        signal,
      );
      const conditionMatched =
        condition === "present"
          ? result.totalMatches > 0
          : result.totalMatches === 0;
      const waitedMs = Date.now() - startedAt;
      if (conditionMatched || waitedMs >= timeoutMs) {
        return { matched: conditionMatched, waitedMs, result };
      }
      await abortableDelay(
        Math.min(BROWSER_WAIT_POLL_INTERVAL_MS, timeoutMs - waitedMs),
        signal,
      );
    }
  }

  #assertPageUrl(
    pageUrl: string,
    currentUrl: string,
    managed: boolean,
    managedScope?: ManagedBrowserTask,
  ) {
    if (
      (managedScope?.kind === "project-preview"
        ? !isWithinPreviewBoundary(managedScope.boundary, pageUrl)
        : !isAgentSafeBrowserUrl(pageUrl)) ||
      (!managed && !sameBrowserOrigin(currentUrl, pageUrl))
    ) {
      throw new Error(
        managed
          ? "网页跳转到了不支持的地址。"
          : "网页在操作前已跳转，请重新授权或重试。",
      );
    }
  }

  #assertRevision(page: { revision: string }, revision: string) {
    if (!revision || page.revision !== revision) {
      throw new Error("网页内容已变化，请重新读取页面后再操作。");
    }
  }

  #assertInteractionReceipt(
    receipt: BrowserPageInteractionReceipt,
    action: "click" | "type",
    targetId: string,
    revision: string,
    currentUrl: string,
    scope: ManagedBrowserTask,
  ) {
    if (
      receipt.action !== action ||
      receipt.targetId !== targetId ||
      receipt.revision !== revision ||
      (action === "type" &&
        (!Number.isInteger(receipt.inputLength) ||
          receipt.inputLength! < 0 ||
          receipt.inputLength! > MAX_BROWSER_INPUT_TEXT_LENGTH)) ||
      (action === "click" && receipt.inputLength !== undefined)
    ) {
      throw new Error("网页返回了不一致的交互回执。");
    }
    this.#assertPageUrl(receipt.url, currentUrl, true, scope);
  }

  #completed(
    action: Exclude<
      AgentBrowserControlInput["action"],
      | "open"
      | "preview"
      | "close"
      | "status"
      | "snapshot"
      | "read_text"
      | "find_text"
      | "wait_for_text"
    >,
    taskId: string,
    url: string,
    scope?: ManagedBrowserTask,
    details?: { targetId?: string; inputLength?: number },
  ): AgentBrowserControlResult {
    return {
      action,
      completed: true,
      taskId,
      url: this.#modelUrl(scope, url),
      ...details,
    };
  }

  #modelUrl(scope: ManagedBrowserTask | undefined, value: string | null) {
    if (scope?.kind !== "project-preview") return browserUrlForModel(value);
    if (!value || !isWithinPreviewBoundary(scope.boundary, value)) return null;
    return `project-preview://${scope.projectId}/${scope.snapshot.displayPath}`;
  }

  #grantKey(projectId: string, origin: string) {
    return `${projectId}\0${origin}`;
  }

  #emitAccessChange() {
    for (const listener of this.#grantListeners) listener();
  }

  #emitActivity(label: string | null) {
    for (const listener of this.#activityListeners) listener(label);
  }
}

export const appBrowserControlBridge = new BrowserControlBridge();
