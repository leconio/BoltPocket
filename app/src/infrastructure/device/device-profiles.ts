export const DEVICE_PROFILES_PROJECT_PATH = ".boltpocket/device-profiles.json";

type DeviceProfileActionBase = Readonly<{
  id: string;
  name: string;
  risk: "read" | "write";
  timeoutMs: number;
}>;

export type HttpDeviceProfileAction = DeviceProfileActionBase &
  Readonly<{
    operation: "http";
    method: "GET" | "HEAD";
    path: string;
    maxResponseBytes: number;
  }>;

export type SocketDeviceProfileAction = DeviceProfileActionBase &
  Readonly<{
    operation: "tcp" | "udp";
    requestBase64: string;
    maxResponseBytes: number;
  }>;

export type BleDeviceProfileAction = DeviceProfileActionBase &
  Readonly<{
    operation: "ble-read" | "ble-subscribe" | "ble-write";
    serviceUuid: string;
    characteristicUuid: string;
    valueBase64?: string;
    durationMs?: number;
  }>;

export type DeviceProfileAction =
  HttpDeviceProfileAction | SocketDeviceProfileAction | BleDeviceProfileAction;

export type DeviceProfile = Readonly<{
  id: string;
  name: string;
  transport: "http" | "tcp" | "udp" | "ble";
  baseUrl?: string;
  host?: string;
  port?: number;
  actions: readonly DeviceProfileAction[];
}>;

export type DeviceProfilesDocument = Readonly<{
  schema: 1;
  policy: "open" | "allowlist";
  profiles: readonly DeviceProfile[];
}>;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

export function parseDeviceProfilesDocument(
  source: string | undefined,
): DeviceProfilesDocument {
  if (!source) {
    return Object.freeze({ schema: 1, policy: "open", profiles: [] });
  }
  if (source.length > 128 * 1024 || source.includes("\0")) {
    throw new Error("Device Profile 文档过大或包含无效字符。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Device Profile 文档不是有效 JSON。", { cause: error });
  }
  const root = record(parsed);
  if (
    !root ||
    root.schema !== 1 ||
    (root.policy !== undefined &&
      root.policy !== "open" &&
      root.policy !== "allowlist") ||
    !Array.isArray(root.profiles) ||
    root.profiles.length > 32 ||
    Object.keys(root).some(
      (key) => !["schema", "policy", "profiles"].includes(key),
    )
  ) {
    throw new Error("Device Profile 文档结构无效。");
  }
  const ids = new Set<string>();
  const profiles = root.profiles.map((value) => {
    const profile = parseProfile(value);
    if (ids.has(profile.id)) throw new Error("Device Profile ID 不能重复。");
    ids.add(profile.id);
    return profile;
  });
  return Object.freeze({
    schema: 1 as const,
    policy: root.policy === "allowlist" ? "allowlist" : "open",
    profiles: Object.freeze(profiles),
  });
}

function parseProfile(value: unknown): DeviceProfile {
  const input = record(value);
  if (!input || !ID.test(String(input.id ?? ""))) {
    throw new Error("Device Profile ID 无效。");
  }
  const name = safeText(input.name, 80, "Device Profile 名称无效。");
  if (
    !(["http", "tcp", "udp", "ble"] as const).includes(input.transport as never)
  ) {
    throw new Error("Device Profile 传输类型无效。");
  }
  const transport = input.transport as DeviceProfile["transport"];
  if (
    !Array.isArray(input.actions) ||
    input.actions.length < 1 ||
    input.actions.length > 32
  ) {
    throw new Error("Device Profile 必须包含 1 到 32 个动作。");
  }
  const actionIds = new Set<string>();
  const actions = input.actions.map((candidate) => {
    const action = parseAction(candidate, transport);
    if (actionIds.has(action.id))
      throw new Error("Device Profile 动作 ID 不能重复。");
    actionIds.add(action.id);
    return action;
  });
  const common = {
    id: String(input.id),
    name,
    transport,
    actions: Object.freeze(actions),
  };
  if (transport === "http") {
    assertKeys(input, ["id", "name", "transport", "baseUrl", "actions"]);
    const baseUrl = safeText(
      input.baseUrl,
      2_048,
      "HTTP Device Profile 地址无效。",
    );
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      throw new Error("HTTP Device Profile 地址无效。", { cause: error });
    }
    if (
      !(["http:", "https:"] as const).includes(url.protocol as never) ||
      url.username ||
      url.password
    ) {
      throw new Error("HTTP Device Profile 只支持不含凭据的 HTTP(S) 地址。");
    }
    return Object.freeze({ ...common, baseUrl: url.toString() });
  }
  if (transport === "tcp" || transport === "udp") {
    assertKeys(input, ["id", "name", "transport", "host", "port", "actions"]);
    const host = safeText(input.host, 253, "Socket Device Profile 主机无效。");
    if (/[/@\s]/u.test(host))
      throw new Error("Socket Device Profile 主机无效。");
    const port = integer(
      input.port,
      1,
      65_535,
      "Socket Device Profile 端口无效。",
    );
    return Object.freeze({ ...common, host, port });
  }
  assertKeys(input, ["id", "name", "transport", "actions"]);
  return Object.freeze(common);
}

function parseAction(
  value: unknown,
  transport: DeviceProfile["transport"],
): DeviceProfileAction {
  const input = record(value);
  if (!input || !ID.test(String(input.id ?? ""))) {
    throw new Error("Device Profile 动作 ID 无效。");
  }
  const base = {
    id: String(input.id),
    name: safeText(input.name, 80, "Device Profile 动作名称无效。"),
    risk:
      input.risk === "read" || input.risk === "write"
        ? input.risk
        : (() => {
            throw new Error("Device Profile 动作风险无效。");
          })(),
    timeoutMs: integer(
      input.timeoutMs ?? 8_000,
      250,
      30_000,
      "Device Profile 超时无效。",
    ),
  } as const;
  const operation = String(input.operation ?? "");
  if (transport === "http" && operation === "http") {
    assertKeys(input, [
      "id",
      "name",
      "risk",
      "timeoutMs",
      "operation",
      "method",
      "path",
      "maxResponseBytes",
    ]);
    if (
      base.risk !== "read" ||
      (input.method !== "GET" && input.method !== "HEAD")
    ) {
      throw new Error("HTTP Device Profile 当前只支持只读 GET/HEAD 动作。");
    }
    const path = safeText(input.path, 2_048, "HTTP Device Profile 路径无效。");
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("HTTP Device Profile 路径必须是站内绝对路径。");
    }
    return Object.freeze({
      ...base,
      operation,
      method: input.method,
      path,
      maxResponseBytes: integer(
        input.maxResponseBytes ?? 65_536,
        1,
        262_144,
        "HTTP Device Profile 响应上限无效。",
      ),
    });
  }
  if ((transport === "tcp" || transport === "udp") && operation === transport) {
    assertKeys(input, [
      "id",
      "name",
      "risk",
      "timeoutMs",
      "operation",
      "requestBase64",
      "maxResponseBytes",
    ]);
    if (base.risk !== "read") {
      throw new Error("TCP/UDP Device Profile 当前只支持固定查询动作。");
    }
    const requestBase64 = safeBase64(input.requestBase64, 65_536);
    return Object.freeze({
      ...base,
      operation,
      requestBase64,
      maxResponseBytes: integer(
        input.maxResponseBytes ?? 65_536,
        1,
        262_144,
        "Socket Device Profile 响应上限无效。",
      ),
    });
  }
  if (
    transport === "ble" &&
    (["ble-read", "ble-subscribe", "ble-write"] as const).includes(
      operation as never,
    )
  ) {
    const typedOperation = operation as BleDeviceProfileAction["operation"];
    if ((typedOperation === "ble-write") !== (base.risk === "write")) {
      throw new Error(
        "BLE 写入动作必须标记为 write，其他 BLE 动作必须为 read。",
      );
    }
    const serviceUuid = safeUuid(input.serviceUuid);
    const characteristicUuid = safeUuid(input.characteristicUuid);
    assertKeys(input, [
      "id",
      "name",
      "risk",
      "timeoutMs",
      "operation",
      "serviceUuid",
      "characteristicUuid",
      ...(typedOperation === "ble-write" ? ["valueBase64"] : []),
      ...(typedOperation === "ble-subscribe" ? ["durationMs"] : []),
    ]);
    return Object.freeze({
      ...base,
      operation: typedOperation,
      serviceUuid,
      characteristicUuid,
      ...(typedOperation === "ble-write"
        ? { valueBase64: safeBase64(input.valueBase64, 512) }
        : {}),
      ...(typedOperation === "ble-subscribe"
        ? {
            durationMs: integer(
              input.durationMs ?? 10_000,
              500,
              30_000,
              "BLE 订阅时长无效。",
            ),
          }
        : {}),
    });
  }
  throw new Error("Device Profile 动作与传输类型不匹配。");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
) {
  const known = new Set(allowed);
  if (Object.keys(input).some((key) => !known.has(key))) {
    throw new Error("Device Profile 包含未声明字段。");
  }
}

function safeText(value: unknown, max: number, message: string) {
  if (typeof value !== "string") throw new Error(message);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\0\r\n]/u.test(normalized)) {
    throw new Error(message);
  }
  return normalized;
}

function integer(value: unknown, min: number, max: number, message: string) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(message);
  }
  return Number(value);
}

function safeUuid(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (!UUID.test(normalized)) throw new Error("BLE UUID 无效。");
  return normalized;
}

function safeBase64(value: unknown, maxBytes: number) {
  if (
    typeof value !== "string" ||
    value.length > maxBytes * 2 ||
    value.length % 4 !== 0 ||
    !BASE64.test(value)
  ) {
    throw new Error("Device Profile payload 不是有效或受限的 base64。");
  }
  return value;
}

export function publicDeviceProfiles(document: DeviceProfilesDocument) {
  return document.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    transport: profile.transport,
    actions: profile.actions.map((action) => ({
      id: action.id,
      name: action.name,
      risk: action.risk,
      operation: action.operation,
    })),
  }));
}
