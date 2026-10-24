import type {
  DeviceCapabilityId,
  DeviceCapabilityPolicy,
  DeviceCapabilitySettings,
} from "@/application/ports/device-capabilities";
import { DEVICE_CAPABILITY_IDS } from "@/application/ports/device-capabilities";
import { P0_DEVICE_CAPABILITY_POLICIES } from "@/domain/device-capability-catalog";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

const SETTINGS_KEY = "device-capabilities:settings:v1";

export function validateDeviceCapabilitySettings(
  value: unknown,
): DeviceCapabilitySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("设备能力设置无效。");
  }
  const candidate = value as Record<string, unknown>;
  const known = new Set<string>(DEVICE_CAPABILITY_IDS);
  if (
    Object.keys(candidate).some((key) => !known.has(key)) ||
    Object.entries(candidate).some(
      ([key, value]) =>
        known.has(key) && !["allow", "ask", "deny"].includes(String(value)),
    )
  ) {
    throw new Error("设备能力设置无效。");
  }
  return Object.freeze(
    Object.fromEntries(
      DEVICE_CAPABILITY_IDS.map((key) => [
        key,
        candidate[key] ?? P0_DEVICE_CAPABILITY_POLICIES[key],
      ]),
    ) as Record<DeviceCapabilityId, DeviceCapabilityPolicy>,
  );
}

export class DeviceCapabilitySettingsRepository {
  readonly #store: DurableDocumentStore;

  constructor(store: DurableDocumentStore) {
    this.#store = store;
  }

  async load(): Promise<DeviceCapabilitySettings> {
    const stored = await this.#store.read(SETTINGS_KEY);
    if (stored === undefined) return P0_DEVICE_CAPABILITY_POLICIES;
    try {
      return validateDeviceCapabilitySettings(JSON.parse(stored) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("本机设备能力设置无法读取。", { cause: error });
      }
      throw error;
    }
  }

  async save(settings: DeviceCapabilitySettings): Promise<void> {
    await this.#store.write(
      SETTINGS_KEY,
      JSON.stringify(validateDeviceCapabilitySettings(settings)),
    );
    await this.#store.flush();
  }
}

export class DeviceCapabilityPolicyController {
  readonly #repository: DeviceCapabilitySettingsRepository;
  readonly #listeners = new Set<(settings: DeviceCapabilitySettings) => void>();
  #settingsPromise: Promise<DeviceCapabilitySettings> | null = null;
  #writeQueue = Promise.resolve();

  constructor(repository: DeviceCapabilitySettingsRepository) {
    this.#repository = repository;
  }

  load() {
    this.#settingsPromise ??= this.#repository.load().catch((error) => {
      this.#settingsPromise = null;
      throw error;
    });
    return this.#settingsPromise;
  }

  async set(
    capability: DeviceCapabilityId,
    policy: DeviceCapabilityPolicy,
  ): Promise<DeviceCapabilitySettings> {
    if (!DEVICE_CAPABILITY_IDS.includes(capability)) {
      throw new Error("设备能力不存在。");
    }
    if (!(["allow", "ask", "deny"] as const).includes(policy)) {
      throw new Error("设备能力权限策略无效。");
    }
    let resolveResult: (settings: DeviceCapabilitySettings) => void = () =>
      undefined;
    let rejectResult: (error: unknown) => void = () => undefined;
    const result = new Promise<DeviceCapabilitySettings>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const current = await this.load();
        if (current[capability] === policy) {
          resolveResult(current);
          return;
        }
        const next = Object.freeze({ ...current, [capability]: policy });
        await this.#repository.save(next);
        this.#settingsPromise = Promise.resolve(next);
        for (const listener of this.#listeners) listener(next);
        resolveResult(next);
      })
      .catch(rejectResult);
    return result;
  }

  subscribe(listener: (settings: DeviceCapabilitySettings) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
