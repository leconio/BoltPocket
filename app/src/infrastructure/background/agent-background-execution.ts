import type { AgentBackgroundExecution } from "@/application/ports/agent-background-execution";
import { MAX_ACTIVE_CONVERSATION_RUNS } from "@/domain/app-state";
import type { AppLocale } from "@/i18n/translate";
import { translateMessage } from "@/i18n/messages";

type BackgroundService = {
  isRunning(): boolean;
  on(event: "expiration", listener: () => void): unknown;
  removeListener(event: "expiration", listener: () => void): unknown;
  start(
    task: () => Promise<void>,
    options: {
      taskName: string;
      taskTitle: string;
      taskDesc: string;
      taskIcon: { name: string; type: string; package?: string };
      color: string;
      linkingURI: string;
      foregroundServiceType: ["dataSync"];
    },
  ): Promise<void>;
  updateNotification(options: {
    taskTitle: string;
    taskDesc: string;
  }): Promise<void>;
  stop(): Promise<void>;
};

type BackgroundServiceLoader = () => Promise<BackgroundService>;
type AndroidForegroundServicePreparation = () => Promise<void>;

async function loadBackgroundService() {
  const module = await import("react-native-background-actions");
  return module.default as BackgroundService;
}

async function prepareAndroidForegroundService() {
  const { PermissionsAndroid, Platform } = await import("react-native");
  if (Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission);
}

export class NativeAgentBackgroundExecution implements AgentBackgroundExecution {
  readonly #listeners = new Set<() => void>();
  readonly #nativePlatform: string;
  readonly #loadService: BackgroundServiceLoader;
  readonly #locale: () => AppLocale;
  readonly #prepareAndroidForegroundService: AndroidForegroundServicePreparation;
  #activeConversationIds: string[] = [];
  #androidPreparationAttempted = false;
  #expirationAttached = false;
  #operation: Promise<void> = Promise.resolve();
  #running = false;
  #service: BackgroundService | null = null;

  constructor(options?: {
    nativePlatform: string;
    loadService?: BackgroundServiceLoader;
    locale?: () => AppLocale;
    prepareAndroidForegroundService?: AndroidForegroundServicePreparation;
  }) {
    this.#nativePlatform = options?.nativePlatform ?? "other";
    this.#loadService = options?.loadService ?? loadBackgroundService;
    this.#locale = options?.locale ?? (() => "zh-CN");
    this.#prepareAndroidForegroundService =
      options?.prepareAndroidForegroundService ??
      prepareAndroidForegroundService;
  }

  subscribeToExpiration(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  syncActiveConversations(conversationIds: readonly string[]) {
    const unique = [...new Set(conversationIds)];
    if (
      unique.length !== conversationIds.length ||
      unique.some((conversationId) => conversationId.length === 0) ||
      unique.length > MAX_ACTIVE_CONVERSATION_RUNS
    ) {
      return Promise.reject(new Error("后台任务列表无效。"));
    }
    return this.#enqueue(() => this.#sync(unique));
  }

  stop() {
    return this.syncActiveConversations([]);
  }

  #enqueue(operation: () => Promise<void>) {
    const current = this.#operation.then(operation, operation);
    this.#operation = current.catch(() => undefined);
    return current;
  }

  async #sync(conversationIds: string[]) {
    if (this.#nativePlatform !== "android" && this.#nativePlatform !== "ios") {
      this.#activeConversationIds = conversationIds;
      return;
    }
    if (conversationIds.length === 0) {
      this.#activeConversationIds = [];
      if (!this.#service || (!this.#running && !this.#service.isRunning())) {
        this.#running = false;
        return;
      }
      try {
        await this.#service.stop();
      } finally {
        this.#running = false;
      }
      return;
    }

    if (
      this.#nativePlatform === "android" &&
      !this.#androidPreparationAttempted
    ) {
      this.#androidPreparationAttempted = true;
      // Notification permission controls drawer visibility on Android 13+,
      // but a denied or unavailable prompt must not prevent the required FGS.
      await this.#prepareAndroidForegroundService().catch(() => undefined);
    }
    const service = await this.#getService();
    if (!this.#running && !service.isRunning()) {
      try {
        await service.start(
          () =>
            new Promise<void>(() => {
              // The upstream native service owns completion through stop().
            }),
          {
            taskName: "BoltPocketAgentRuns",
            taskTitle: translateMessage(
              "runtime.background.title",
              this.#locale(),
            ),
            taskDesc: translateMessage(
              conversationIds.length === 1
                ? "runtime.background.activeSingle"
                : "runtime.background.activeMultiple",
              this.#locale(),
              { count: conversationIds.length },
            ),
            taskIcon: { name: "ic_launcher_monochrome", type: "mipmap" },
            color: "#2F6FED",
            linkingURI: "boltpocket://conversations",
            foregroundServiceType: ["dataSync"],
          },
        );
        this.#running = true;
      } catch (error) {
        // iOS background time is an opportunistic extension, not a
        // prerequisite for a foreground conversation. Development clients,
        // simulators, and an already-expired UIKit background task can reject
        // start(); keep the run registered so it can continue while the app is
        // visible. Android still fails closed here because its foreground
        // service is the durable host promised by the notification contract.
        if (this.#nativePlatform === "ios") {
          this.#running = false;
          this.#activeConversationIds = conversationIds;
          return;
        }
        this.#activeConversationIds = [];
        throw error;
      }
    } else {
      this.#running = true;
      await service
        .updateNotification({
          taskTitle: translateMessage(
            "runtime.background.title",
            this.#locale(),
          ),
          taskDesc: translateMessage(
            conversationIds.length === 1
              ? "runtime.background.activeSingle"
              : "runtime.background.activeMultiple",
            this.#locale(),
            { count: conversationIds.length },
          ),
        })
        .catch(() => undefined);
    }
    this.#activeConversationIds = conversationIds;
  }

  async #getService() {
    if (this.#service) return this.#service;
    const service = await this.#loadService();
    this.#service = service;
    if (!this.#expirationAttached) {
      service.on("expiration", this.#handleExpiration);
      this.#expirationAttached = true;
    }
    return service;
  }

  readonly #handleExpiration = () => {
    this.#activeConversationIds = [];
    this.#running = false;
    const service = this.#service;
    void this.#enqueue(async () => {
      await service?.stop().catch(() => undefined);
    });
    for (const listener of this.#listeners) listener();
  };
}
