import { BoltPocketDeviceCapabilities } from "@boltpocket/expo-device-capabilities";
import {
  Accuracy,
  getLastKnownPositionAsync,
  getProviderStatusAsync,
  hasServicesEnabledAsync,
  watchPositionAsync,
} from "expo-location";

import type {
  AgentDeviceAction,
  AgentDeviceCapabilityContext,
  AgentDeviceCapabilityInput,
  AgentDeviceCapabilityPort,
  DeviceCapabilityAccessApprovalPort,
  DeviceCapabilityId,
} from "@/application/ports/device-capabilities";
import { DeviceCapabilityPolicyController } from "@/infrastructure/device/device-capability-settings-repository";
import {
  assertDirectDeviceOperationAllowed,
  directDeviceOperationDataDescription,
  parseDirectDeviceOperation,
  type DirectDeviceOperation,
} from "@/infrastructure/device/device-direct-operations";
import {
  parseDeviceProfilesDocument,
  publicDeviceProfiles,
  type DeviceProfile,
  type DeviceProfileAction,
} from "@/infrastructure/device/device-profiles";
import {
  ExternalAppOperations,
  externalAppDataDescription,
} from "@/infrastructure/device/external-app-operations";
import {
  PersonalDataOperations,
  personalDataDescription,
} from "@/infrastructure/device/personal-data-operations";
import {
  SensorOperations,
  sensorDataDescription,
} from "@/infrastructure/device/sensor-operations";
import {
  MediaAudioOperations,
  audioDataDescription,
} from "@/infrastructure/device/media-audio-operations";
import { requireDeviceSystemPermission } from "@/infrastructure/device/device-system-permissions";
import {
  resolveResponsiveForegroundLocation,
  type ResponsiveLocationDependencies,
} from "@/infrastructure/device/responsive-foreground-location";

const ACTION_CAPABILITIES = Object.freeze({
  status: "device-status",
  power: "power",
  storage: "storage",
  network: "network",
  location_current: "location",
  wifi_current: "wifi",
  wifi_scan: "wifi",
  bluetooth_scan: "bluetooth",
  bluetooth_services: "bluetooth",
  bluetooth_read: "bluetooth",
  bluetooth_subscribe: "bluetooth",
  bluetooth_write: "bluetooth",
  bluetooth_recover: "bluetooth",
  http_request: "local-network",
  tcp_exchange: "local-network",
  udp_exchange: "local-network",
  profiles: "local-network",
  profile_execute: "local-network",
  profile_recover: "bluetooth",
  external_app_open: "external-apps",
  calendar_list: "calendar",
  calendar_events: "calendar",
  calendar_create: "calendar",
  calendar_update: "calendar",
  calendar_delete: "calendar",
  calendar_recover: "calendar",
  reminder_list: "reminders",
  reminder_create: "reminders",
  reminder_update: "reminders",
  reminder_delete: "reminders",
  reminder_recover: "reminders",
  sensors_list: "sensors",
  sensor_read: "sensors",
  audio_play: "audio",
  audio_pause: "audio",
  audio_resume: "audio",
  audio_seek: "audio",
  audio_status: "audio",
  audio_stop: "audio",
} satisfies Record<AgentDeviceAction, DeviceCapabilityId>);

const DATA_DESCRIPTIONS = Object.freeze({
  "device-status":
    "设备型号、系统版本、语言、时区和硬件可用性（不含唯一标识符）",
  power: "电量、充电、节能和温度状态",
  storage: "设备总量级的存储与内存状态（不读取文件名或内容）",
  network: "联网类型、计费和 VPN 状态（不读取公网地址）",
  location: "当前经纬度、系统提供的精度和采集时间",
  wifi: "当前 Wi-Fi 名称或附近网络名称、信号和频段（不含 BSSID/MAC/密码）",
  bluetooth: "附近 BLE 广播名称、服务 UUID、信号和临时设备标识",
  "local-network": "本次明确指定的局域网端点、请求与有界响应",
  "external-apps": "交给系统打开的外部 App 地址",
  calendar: "设备日历列表、指定时间范围内的日程或明确的日程变更",
  reminders: "设备提醒事项列表或明确的提醒事项变更（仅 iOS）",
  sensors: "明确类型、频率和时长的前台传感器样本",
  audio: "明确音频地址、媒体通知元数据和播放控制",
} satisfies Record<DeviceCapabilityId, string>);

const DIRECT_ACTIONS = new Set<AgentDeviceAction>([
  "bluetooth_services",
  "bluetooth_read",
  "bluetooth_subscribe",
  "bluetooth_write",
  "bluetooth_recover",
  "http_request",
  "tcp_exchange",
  "udp_exchange",
]);

const PERSONAL_DATA_ACTIONS = new Set<AgentDeviceAction>([
  "calendar_list",
  "calendar_events",
  "calendar_create",
  "calendar_update",
  "calendar_delete",
  "calendar_recover",
  "reminder_list",
  "reminder_create",
  "reminder_update",
  "reminder_delete",
  "reminder_recover",
]);

const SENSOR_ACTIONS = new Set<AgentDeviceAction>([
  "sensors_list",
  "sensor_read",
]);

const AUDIO_ACTIONS = new Set<AgentDeviceAction>([
  "audio_play",
  "audio_pause",
  "audio_resume",
  "audio_seek",
  "audio_status",
  "audio_stop",
]);

const LOCATION_DEPENDENCIES: ResponsiveLocationDependencies = Object.freeze({
  servicesEnabled: hasServicesEnabledAsync,
  providerStatus: getProviderStatusAsync,
  lastKnown: () =>
    getLastKnownPositionAsync({
      maxAge: 5 * 60_000,
      requiredAccuracy: 1_000,
    }),
  watch: (onLocation, onError) =>
    watchPositionAsync(
      {
        accuracy: Accuracy.Balanced,
        mayShowUserSettingsDialog: false,
        timeInterval: 1_000,
        distanceInterval: 0,
      },
      onLocation,
      onError,
    ),
});

export class ExpoAgentDeviceCapabilities implements AgentDeviceCapabilityPort {
  readonly #approval: DeviceCapabilityAccessApprovalPort;
  readonly #policies: DeviceCapabilityPolicyController;
  readonly #createOperationId: () => string;
  readonly #externalApps: ExternalAppOperations;
  readonly #personalData: PersonalDataOperations;
  readonly #sensors: SensorOperations;
  readonly #audio: MediaAudioOperations;

  constructor(options: {
    approval: DeviceCapabilityAccessApprovalPort;
    policies: DeviceCapabilityPolicyController;
    createOperationId: () => string;
    externalApps?: ExternalAppOperations;
    personalData?: PersonalDataOperations;
    sensors?: SensorOperations;
    audio?: MediaAudioOperations;
  }) {
    this.#approval = options.approval;
    this.#policies = options.policies;
    this.#createOperationId = options.createOperationId;
    this.#externalApps = options.externalApps ?? new ExternalAppOperations();
    this.#personalData = options.personalData ?? new PersonalDataOperations();
    this.#sensors = options.sensors ?? new SensorOperations();
    this.#audio = options.audio ?? new MediaAudioOperations();
  }

  async execute(
    input: AgentDeviceCapabilityInput,
    context: AgentDeviceCapabilityContext,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const purpose = input.purpose.trim();
    if (!purpose || purpose.length > 240 || /[\0\r\n]/u.test(purpose)) {
      throw new Error("Agent 必须说明本次使用设备能力的具体用途。");
    }
    const needsProfilesDocument =
      input.action === "profiles" ||
      input.action === "profile_execute" ||
      (DIRECT_ACTIONS.has(input.action) &&
        input.action !== "bluetooth_recover");
    const document = needsProfilesDocument
      ? parseDeviceProfilesDocument(context.profilesDocument)
      : undefined;
    if (input.action === "profiles") {
      if (!document) throw new Error("Device Profile 文档未加载。");
      return Object.freeze({
        path: ".boltpocket/device-profiles.json",
        policy: document.policy,
        profiles: publicDeviceProfiles(document),
        count: document.profiles.length,
      });
    }
    const directOperation = DIRECT_ACTIONS.has(input.action)
      ? parseDirectDeviceOperation(input)
      : undefined;
    if (directOperation && document) {
      assertDirectDeviceOperationAllowed(document, directOperation);
    }
    const profile =
      input.action === "profile_execute"
        ? document?.profiles.find(
            (candidate) => candidate.id === input.profileId,
          )
        : undefined;
    const capability = profile
      ? profile.transport === "ble"
        ? "bluetooth"
        : "local-network"
      : ACTION_CAPABILITIES[input.action];
    const policies = await this.#policies.load();
    const policy = policies[capability];
    if (policy === "deny") {
      throw new Error(`设备能力已在设置中关闭：${capability}`);
    }
    if (policy === "ask") {
      const approved = await this.#approval.request(
        {
          capability,
          action: input.action,
          projectId: context.projectId,
          projectName: context.projectName,
          conversationId: context.conversationId,
          purpose,
          dataDescription: directOperation
            ? directDeviceOperationDataDescription(directOperation)
            : input.action === "external_app_open"
              ? externalAppDataDescription(input.url)
              : PERSONAL_DATA_ACTIONS.has(input.action)
                ? personalDataDescription(input)
                : SENSOR_ACTIONS.has(input.action)
                  ? sensorDataDescription(input)
                  : AUDIO_ACTIONS.has(input.action)
                    ? audioDataDescription(input)
                    : DATA_DESCRIPTIONS[capability],
        },
        signal,
      );
      if (!approved || signal?.aborted) {
        return Object.freeze({
          approved: false,
          capability,
          message: "用户拒绝了本次设备能力访问。",
        });
      }
    }
    const current = await this.#policies.load();
    if (current[capability] === "deny") {
      throw new Error(`设备能力已在设置中关闭：${capability}`);
    }
    if (
      ["location", "wifi", "bluetooth", "calendar", "reminders"].includes(
        capability,
      ) ||
      input.action === "sensor_read" ||
      input.action === "audio_play"
    ) {
      await requireDeviceSystemPermission(capability);
    }
    if (signal?.aborted) throw abortError();
    if (input.action === "external_app_open") {
      return this.#externalApps.open(input.url, signal);
    }
    if (PERSONAL_DATA_ACTIONS.has(input.action)) {
      return this.#personalData.execute(input, signal);
    }
    if (SENSOR_ACTIONS.has(input.action)) {
      return input.action === "sensors_list"
        ? this.#sensors.list(signal)
        : this.#sensors.read(input, signal);
    }
    if (AUDIO_ACTIONS.has(input.action)) {
      return this.#audio.execute(input, signal);
    }
    if (!BoltPocketDeviceCapabilities.isAvailable) {
      throw new Error("当前 App 构建没有设备原生能力模块。");
    }
    const operationId = this.#createOperationId();
    const cancel = () => {
      void BoltPocketDeviceCapabilities.cancel(operationId).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await this.#executeNative(
        operationId,
        input,
        profile,
        directOperation,
        signal,
      );
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  async #executeNative(
    operationId: string,
    input: AgentDeviceCapabilityInput,
    profile: DeviceProfile | undefined,
    directOperation: DirectDeviceOperation | undefined,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    switch (input.action) {
      case "status":
        return BoltPocketDeviceCapabilities.getDeviceStatus();
      case "power":
        return BoltPocketDeviceCapabilities.getPowerStatus();
      case "storage":
        return BoltPocketDeviceCapabilities.getStorageStatus();
      case "network":
        return BoltPocketDeviceCapabilities.getNetworkStatus();
      case "location_current": {
        const resolved = await resolveResponsiveForegroundLocation({
          signal,
          dependencies: LOCATION_DEPENDENCIES,
        });
        const position = resolved.position;
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error("系统定位服务返回了无效坐标。");
        }
        return Object.freeze({
          latitude,
          longitude,
          accuracyMeters: position.coords.accuracy,
          altitudeMeters: position.coords.altitude,
          altitudeAccuracyMeters: position.coords.altitudeAccuracy,
          headingDegrees: position.coords.heading,
          speedMetersPerSecond: position.coords.speed,
          mocked: position.mocked ?? false,
          source: resolved.source,
          ageMs: resolved.ageMs,
          currentAttempted: resolved.currentAttempted,
          ...(resolved.fallbackReason
            ? { fallbackReason: resolved.fallbackReason }
            : {}),
          provider: resolved.provider,
          capturedAtEpochMs: position.timestamp,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
      }
      case "wifi_current":
        return BoltPocketDeviceCapabilities.getWifiStatus();
      case "wifi_scan":
        return BoltPocketDeviceCapabilities.scanWifi(operationId, 10_000, 32);
      case "bluetooth_scan":
        return BoltPocketDeviceCapabilities.scanBluetooth(operationId, 8_000, 32);
      case "bluetooth_services": {
        const operation = requiredDirectOperation(
          directOperation,
          "bluetooth_services",
        );
        return BoltPocketDeviceCapabilities.discoverBluetoothServices(
          operationId,
          operation.deviceId,
          operation.timeoutMs,
        );
      }
      case "bluetooth_read": {
        const operation = requiredDirectOperation(
          directOperation,
          "bluetooth_read",
        );
        return BoltPocketDeviceCapabilities.bleRead(
          operationId,
          operation.deviceId,
          operation.serviceUuid,
          operation.characteristicUuid,
          operation.timeoutMs,
        );
      }
      case "bluetooth_subscribe": {
        const operation = requiredDirectOperation(
          directOperation,
          "bluetooth_subscribe",
        );
        return BoltPocketDeviceCapabilities.bleSubscribe(
          operationId,
          operation.deviceId,
          operation.serviceUuid,
          operation.characteristicUuid,
          operation.durationMs,
        );
      }
      case "bluetooth_write": {
        const operation = requiredDirectOperation(
          directOperation,
          "bluetooth_write",
        );
        return BoltPocketDeviceCapabilities.bleWriteReversible(
          operationId,
          operation.deviceId,
          operation.serviceUuid,
          operation.characteristicUuid,
          operation.valueBase64,
          operation.timeoutMs,
        );
      }
      case "bluetooth_recover": {
        const operation = requiredDirectOperation(
          directOperation,
          "bluetooth_recover",
        );
        return BoltPocketDeviceCapabilities.bleRecover(
          operationId,
          operation.recoveryId,
          operation.timeoutMs,
        );
      }
      case "http_request": {
        const operation = requiredDirectOperation(
          directOperation,
          "http_request",
        );
        return BoltPocketDeviceCapabilities.httpRequest(
          operationId,
          operation.url,
          operation.method,
          null,
          operation.maxResponseBytes,
          operation.timeoutMs,
        );
      }
      case "tcp_exchange":
      case "udp_exchange": {
        const operation = requiredDirectOperation(
          directOperation,
          input.action,
        );
        const exchange =
          operation.action === "tcp_exchange"
            ? BoltPocketDeviceCapabilities.tcpExchange
            : BoltPocketDeviceCapabilities.udpExchange;
        return exchange(
          operationId,
          operation.host,
          operation.port,
          operation.requestBase64,
          operation.maxResponseBytes,
          operation.timeoutMs,
        );
      }
      case "profiles":
        throw new Error("Device Profile 目录应在授权前返回。");
      case "profile_execute":
        return this.#executeProfile(
          operationId,
          input,
          requiredProfile(profile),
        );
      case "profile_recover":
        if (!input.recoveryId)
          throw new Error("profile_recover 需要 recoveryId。");
        return BoltPocketDeviceCapabilities.bleRecover(
          operationId,
          input.recoveryId,
          10_000,
        );
      default:
        throw new Error(`设备动作尚未实现：${input.action}`);
    }
  }

  #executeProfile(
    operationId: string,
    input: AgentDeviceCapabilityInput,
    profile: DeviceProfile,
  ) {
    if (!input.profileActionId)
      throw new Error("profile_execute 需要 profileActionId。");
    const action = profile.actions.find(
      (candidate) => candidate.id === input.profileActionId,
    );
    if (!action) throw new Error("Device Profile 动作不存在。");
    return executeProfileAction(operationId, profile, action, input.deviceId);
  }
}

function requiredDirectOperation<
  Action extends DirectDeviceOperation["action"],
>(
  operation: DirectDeviceOperation | undefined,
  action: Action,
): Extract<DirectDeviceOperation, { action: Action }> {
  if (!operation || operation.action !== action) {
    throw new Error("动态设备通信参数无效。");
  }
  return operation as Extract<DirectDeviceOperation, { action: Action }>;
}

function executeProfileAction(
  operationId: string,
  profile: DeviceProfile,
  action: DeviceProfileAction,
  deviceId: string | undefined,
) {
  if (action.operation === "http") {
    const base = new URL(profile.baseUrl!);
    const url = new URL(action.path, base);
    if (url.origin !== base.origin)
      throw new Error("Device Profile 路径越过了声明的端点。");
    return BoltPocketDeviceCapabilities.httpRequest(
      operationId,
      url.toString(),
      action.method,
      null,
      action.maxResponseBytes,
      action.timeoutMs,
    );
  }
  if (action.operation === "tcp") {
    return BoltPocketDeviceCapabilities.tcpExchange(
      operationId,
      profile.host!,
      profile.port!,
      action.requestBase64,
      action.maxResponseBytes,
      action.timeoutMs,
    );
  }
  if (action.operation === "udp") {
    return BoltPocketDeviceCapabilities.udpExchange(
      operationId,
      profile.host!,
      profile.port!,
      action.requestBase64,
      action.maxResponseBytes,
      action.timeoutMs,
    );
  }
  if (!("serviceUuid" in action)) {
    throw new Error("Device Profile 动作与 BLE 传输类型不匹配。");
  }
  if (!deviceId)
    throw new Error("BLE Device Profile 动作需要最近扫描返回的 deviceId。");
  if (action.operation === "ble-read") {
    return BoltPocketDeviceCapabilities.bleRead(
      operationId,
      deviceId,
      action.serviceUuid,
      action.characteristicUuid,
      action.timeoutMs,
    );
  }
  if (action.operation === "ble-subscribe") {
    return BoltPocketDeviceCapabilities.bleSubscribe(
      operationId,
      deviceId,
      action.serviceUuid,
      action.characteristicUuid,
      action.durationMs!,
    );
  }
  return BoltPocketDeviceCapabilities.bleWriteReversible(
    operationId,
    deviceId,
    action.serviceUuid,
    action.characteristicUuid,
    action.valueBase64!,
    action.timeoutMs,
  );
}

function requiredProfile(profile: DeviceProfile | undefined) {
  if (!profile)
    throw new Error("Device Profile 不存在或尚未加入当前项目快照。");
  return profile;
}

function abortError() {
  const error = new Error("设备能力操作已取消。");
  error.name = "AbortError";
  return error;
}
