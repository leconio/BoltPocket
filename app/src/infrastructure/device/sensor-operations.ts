import type { AgentDeviceCapabilityInput } from "@/application/ports/device-capabilities";

export const SENSOR_TYPES = [
  "accelerometer",
  "gyroscope",
  "magnetometer",
  "magnetometer-uncalibrated",
  "device-motion",
  "barometer",
  "light",
  "pedometer",
] as const;

export type SensorType = (typeof SENSOR_TYPES)[number];

type SensorSubscription = Readonly<{ remove(): void }>;
type Permission = Readonly<{ granted: boolean; canAskAgain: boolean }>;
type SensorAdapter = Readonly<{
  isAvailable: () => Promise<boolean>;
  requestPermission: () => Promise<Permission>;
  setInterval?: (intervalMs: number) => void | Promise<void>;
  subscribe: (
    listener: (sample: unknown) => void,
  ) => SensorSubscription | Promise<SensorSubscription>;
}>;

export type SensorDependencies = Readonly<{
  platform: string;
  resolvePlatform?: () => Promise<string>;
  sensors: Readonly<Record<SensorType, SensorAdapter>>;
  stepCount: (start: Date, end: Date) => Promise<number>;
  wait: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}>;

const DEFAULT_DEPENDENCIES: SensorDependencies = {
  platform: "native",
  resolvePlatform: async () => (await import("react-native")).Platform.OS,
  sensors: {
    accelerometer: lazyDeviceSensor(
      async () => (await sensorApi()).Accelerometer,
    ),
    gyroscope: lazyDeviceSensor(async () => (await sensorApi()).Gyroscope),
    magnetometer: lazyDeviceSensor(
      async () => (await sensorApi()).Magnetometer,
    ),
    "magnetometer-uncalibrated": lazyDeviceSensor(
      async () => (await sensorApi()).MagnetometerUncalibrated,
    ),
    "device-motion": lazyDeviceSensor(
      async () => (await sensorApi()).DeviceMotion,
    ),
    barometer: lazyDeviceSensor(async () => (await sensorApi()).Barometer),
    light: lazyDeviceSensor(async () => (await sensorApi()).LightSensor),
    pedometer: {
      isAvailable: async () => (await sensorApi()).Pedometer.isAvailableAsync(),
      requestPermission: async () =>
        (await sensorApi()).Pedometer.requestPermissionsAsync(),
      subscribe: async (listener) =>
        (await sensorApi()).Pedometer.watchStepCount(listener),
    },
  },
  stepCount: async (start, end) =>
    (await (await sensorApi()).Pedometer.getStepCountAsync(start, end)).steps,
  wait: abortableWait,
  now: Date.now,
};

export class SensorOperations {
  readonly #dependencies: SensorDependencies;

  constructor(dependencies: SensorDependencies = DEFAULT_DEPENDENCIES) {
    this.#dependencies = dependencies;
  }

  async list(signal?: AbortSignal) {
    const platform = await resolvedPlatform(this.#dependencies);
    assertSupportedPlatform(platform);
    const availability = await Promise.all(
      SENSOR_TYPES.map(async (type) => {
        assertNotAborted(signal);
        return Object.freeze({
          type,
          available: await this.#dependencies.sensors[type].isAvailable(),
          mode:
            type === "pedometer"
              ? platform === "ios"
                ? "history-or-live"
                : "live"
              : "live",
        });
      }),
    );
    return Object.freeze({
      platform,
      sensors: availability,
      count: availability.filter((sensor) => sensor.available).length,
    });
  }

  async read(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const platform = await resolvedPlatform(this.#dependencies);
    assertSupportedPlatform(platform);
    const type = parseSensorType(input.sensorType);
    const adapter = this.#dependencies.sensors[type];
    if (!(await adapter.isAvailable())) {
      return Object.freeze({
        type,
        available: false,
        samples: [],
        message: "这台设备没有上报该传感器。",
      });
    }
    const permission = await adapter.requestPermission();
    if (!permission.granted) {
      throw new Error(
        permission.canAskAgain
          ? "没有获得传感器系统权限。"
          : "传感器系统权限已关闭，请前往系统设置开启。",
      );
    }
    if (
      type === "pedometer" &&
      (input.startAt !== undefined || input.endAt !== undefined)
    ) {
      if (platform !== "ios") {
        throw new Error(
          "Android 的系统计步器不提供历史区间查询，只能前台实时采样。",
        );
      }
      const end = input.endAt ? parseDate(input.endAt, "endAt") : new Date();
      const start = input.startAt
        ? parseDate(input.startAt, "startAt")
        : new Date(end.getTime() - 24 * 60 * 60_000);
      if (
        end <= start ||
        end.getTime() - start.getTime() > 7 * 24 * 60 * 60_000
      ) {
        throw new Error("计步查询必须是最多 7 天的正向时间范围。");
      }
      assertNotAborted(signal);
      const steps = await this.#dependencies.stepCount(start, end);
      return Object.freeze({
        type,
        available: true,
        mode: "history",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        steps,
      });
    }

    const durationMs = boundedInteger(input.durationMs, 250, 30_000, 1_000);
    const intervalMs = boundedInteger(input.intervalMs, 20, 1_000, 100);
    const maxSamples = Math.min(128, Math.ceil(durationMs / intervalMs) + 1);
    await adapter.setInterval?.(intervalMs);
    const startedAt = this.#dependencies.now();
    const samples: Readonly<Record<string, unknown>>[] = [];
    const subscription = await adapter.subscribe((sample) => {
      if (samples.length >= maxSamples) return;
      const sanitized = sanitizeSample(sample);
      if (!sanitized) return;
      samples.push(
        Object.freeze({
          elapsedMs: Math.max(0, this.#dependencies.now() - startedAt),
          ...sanitized,
        }),
      );
    });
    try {
      await this.#dependencies.wait(durationMs, signal);
    } finally {
      subscription.remove();
    }
    return Object.freeze({
      type,
      available: true,
      mode: "live",
      durationMs,
      intervalMs,
      samples,
      count: samples.length,
      capturedAt: new Date(this.#dependencies.now()).toISOString(),
      ...(samples.length === 0
        ? { message: "传感器在采样窗口内没有上报数据。" }
        : {}),
    });
  }
}

export function sensorDataDescription(input: AgentDeviceCapabilityInput) {
  if (input.action === "sensors_list") return "检查系统公开传感器的可用性";
  const type = parseSensorType(input.sensorType);
  return `前台读取 ${type}，采样时长 ${input.durationMs ?? 1_000}ms、间隔 ${input.intervalMs ?? 100}ms，最多 128 个样本`;
}

type DeviceSensorModule = {
  isAvailableAsync(): Promise<boolean>;
  requestPermissionsAsync(): Promise<Permission>;
  setUpdateInterval(intervalMs: number): void;
  addListener(listener: (sample: unknown) => void): SensorSubscription;
};

function lazyDeviceSensor(
  load: () => Promise<DeviceSensorModule>,
): SensorAdapter {
  return {
    isAvailable: async () => (await load()).isAvailableAsync(),
    requestPermission: async () => (await load()).requestPermissionsAsync(),
    setInterval: async (intervalMs) =>
      (await load()).setUpdateInterval(intervalMs),
    subscribe: async (listener) => (await load()).addListener(listener),
  };
}

function parseSensorType(value: string | undefined): SensorType {
  if (!value || !SENSOR_TYPES.includes(value as SensorType)) {
    throw new Error(`sensorType 必须是：${SENSOR_TYPES.join("、")}`);
  }
  return value as SensorType;
}

function sanitizeSample(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/u.test(key)) continue;
    const sanitized = sanitizeValue(field, 0);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return Object.freeze(result);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (
    depth >= 3 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const nested: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value).slice(0, 24)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/u.test(key)) continue;
    const sanitized = sanitizeValue(field, depth + 1);
    if (sanitized !== undefined) nested[key] = sanitized;
  }
  return Object.freeze(nested);
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`数值必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return resolved;
}

function parseDate(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} 必须是有效的 ISO 8601 时间。`);
  }
  return date;
}

function assertSupportedPlatform(platform: string) {
  if (!["android", "ios"].includes(platform)) {
    throw new Error("当前平台不支持原生传感器。");
  }
}

async function resolvedPlatform(dependencies: SensorDependencies) {
  return dependencies.resolvePlatform
    ? dependencies.resolvePlatform()
    : dependencies.platform;
}

let sensorsModule: Promise<typeof import("expo-sensors")> | undefined;

function sensorApi() {
  sensorsModule ??= import("expo-sensors");
  return sensorsModule;
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("传感器读取已取消。");
  error.name = "AbortError";
  throw error;
}

function abortableWait(durationMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(finish, durationMs);
    signal?.addEventListener("abort", cancel, { once: true });
    function finish() {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

function abortError() {
  const error = new Error("传感器读取已取消。");
  error.name = "AbortError";
  return error;
}
