const IMMEDIATE_LAST_KNOWN_AGE_MS = 2 * 60_000;
const FALLBACK_LAST_KNOWN_AGE_MS = 5 * 60_000;
const CURRENT_LOCATION_TIMEOUT_MS = 12_000;

export type ResponsiveLocationPosition = Readonly<{
  coords: Readonly<{
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  }>;
  timestamp: number;
  mocked?: boolean;
}>;

export type ResponsiveLocationProviderStatus = Readonly<{
  locationServicesEnabled: boolean;
  backgroundModeEnabled: boolean;
  gpsAvailable?: boolean;
  networkAvailable?: boolean;
  passiveAvailable?: boolean;
}>;

export type ResponsiveLocationSubscription = Readonly<{
  remove(): void;
}>;

export type ResponsiveLocationDependencies = Readonly<{
  servicesEnabled(): Promise<boolean>;
  providerStatus(): Promise<ResponsiveLocationProviderStatus>;
  lastKnown(): Promise<ResponsiveLocationPosition | null>;
  watch(
    onLocation: (location: ResponsiveLocationPosition) => void,
    onError: (reason: string) => void,
  ): Promise<ResponsiveLocationSubscription>;
}>;

export type ResponsiveForegroundLocation = Readonly<{
  position: ResponsiveLocationPosition;
  source: "current" | "lastKnown";
  ageMs: number;
  currentAttempted: boolean;
  fallbackReason?: "current-timeout" | "current-error";
  provider: Readonly<{
    locationServicesEnabled: boolean;
    gpsAvailable?: boolean;
    networkAvailable?: boolean;
    passiveAvailable?: boolean;
  }>;
}>;

export async function resolveResponsiveForegroundLocation(options: {
  signal?: AbortSignal;
  now?: () => number;
  timeoutMs?: number;
  dependencies: ResponsiveLocationDependencies;
}): Promise<ResponsiveForegroundLocation> {
  const signal = options.signal;
  if (signal?.aborted) throw abortError();
  const now = options.now ?? Date.now;
  const dependencies = options.dependencies;
  const providerStatus: Promise<ResponsiveLocationProviderStatus> = dependencies
    .providerStatus()
    .catch(() => ({
      locationServicesEnabled: true,
      backgroundModeEnabled: false,
    }));
  const [servicesEnabled, provider, lastKnown] = await Promise.all([
    dependencies.servicesEnabled(),
    providerStatus,
    dependencies.lastKnown().catch(() => null),
  ]);
  if (!servicesEnabled) {
    throw new Error("系统定位服务已关闭，请先开启定位服务。");
  }
  if (signal?.aborted) throw abortError();
  const providerSummary = Object.freeze({
    locationServicesEnabled: true,
    ...(provider.gpsAvailable === undefined
      ? {}
      : { gpsAvailable: provider.gpsAvailable }),
    ...(provider.networkAvailable === undefined
      ? {}
      : { networkAvailable: provider.networkAvailable }),
    ...(provider.passiveAvailable === undefined
      ? {}
      : { passiveAvailable: provider.passiveAvailable }),
  });
  const lastKnownAgeMs = validAge(lastKnown, now());
  if (
    lastKnown &&
    lastKnownAgeMs !== undefined &&
    lastKnownAgeMs <= IMMEDIATE_LAST_KNOWN_AGE_MS
  ) {
    return Object.freeze({
      position: lastKnown,
      source: "lastKnown",
      ageMs: lastKnownAgeMs,
      currentAttempted: false,
      provider: providerSummary,
    });
  }

  try {
    const position = await firstLocationUpdate(
      dependencies,
      options.timeoutMs ?? CURRENT_LOCATION_TIMEOUT_MS,
      signal,
    );
    return Object.freeze({
      position,
      source: "current",
      ageMs: validAge(position, now()) ?? 0,
      currentAttempted: true,
      provider: providerSummary,
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortError();
    if (
      lastKnown &&
      lastKnownAgeMs !== undefined &&
      lastKnownAgeMs <= FALLBACK_LAST_KNOWN_AGE_MS
    ) {
      return Object.freeze({
        position: lastKnown,
        source: "lastKnown",
        ageMs: lastKnownAgeMs,
        currentAttempted: true,
        fallbackReason: isTimeoutError(error)
          ? "current-timeout"
          : "current-error",
        provider: providerSummary,
      });
    }
    const availability = [
      provider.gpsAvailable === undefined
        ? undefined
        : `GPS ${provider.gpsAvailable ? "可用" : "不可用"}`,
      provider.networkAvailable === undefined
        ? undefined
        : `网络定位 ${provider.networkAvailable ? "可用" : "不可用"}`,
    ]
      .filter(Boolean)
      .join("，");
    throw new Error(
      `${isTimeoutError(error) ? "当前定位在限定时间内没有返回" : "系统定位暂时失败"}；定位服务已开启${availability ? `（${availability}）` : ""}，且没有 5 分钟内、精度 1 公里以内的近期位置。`,
      { cause: error },
    );
  }
}

async function firstLocationUpdate(
  dependencies: ResponsiveLocationDependencies,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("定位等待时间无效。");
  }
  let subscription: ResponsiveLocationSubscription | undefined;
  let settled = false;
  return new Promise<ResponsiveLocationPosition>((resolve, reject) => {
    const finish = (
      outcome:
        | Readonly<{ position: ResponsiveLocationPosition }>
        | Readonly<{ error: Error }>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      subscription?.remove();
      if ("position" in outcome) resolve(outcome.position);
      else reject(outcome.error);
    };
    const onAbort = () => finish({ error: abortError() });
    const timeout = setTimeout(
      () => finish({ error: timeoutError() }),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    void dependencies
      .watch(
        (position) => finish({ position }),
        (reason) => finish({ error: new Error(`系统定位失败：${reason}`) }),
      )
      .then((value) => {
        subscription = value;
        if (settled) subscription.remove();
      })
      .catch((error: unknown) =>
        finish({
          error:
            error instanceof Error ? error : new Error("系统定位启动失败。"),
        }),
      );
  });
}

function validAge(position: ResponsiveLocationPosition | null, now: number) {
  if (!position || !Number.isFinite(position.timestamp)) return undefined;
  const age = now - position.timestamp;
  if (!Number.isFinite(age) || age < -60_000) return undefined;
  return Math.max(0, age);
}

function timeoutError() {
  const error = new Error("当前定位等待超时。");
  error.name = "TimeoutError";
  return error;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError";
}

function abortError() {
  const error = new Error("定位操作已取消。");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
