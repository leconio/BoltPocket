import type { AgentDeviceCapabilityInput } from "@/application/ports/device-capabilities";
import type {
  DeviceProfile,
  DeviceProfilesDocument,
} from "@/infrastructure/device/device-profiles";

const FULL_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const SHORT_UUID = /^(?:0x)?([a-f0-9]{4}|[a-f0-9]{8})$/iu;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export type DirectDeviceOperation =
  | Readonly<{
      action: "bluetooth_services";
      deviceId: string;
      timeoutMs: number;
    }>
  | Readonly<{
      action: "bluetooth_read";
      deviceId: string;
      serviceUuid: string;
      characteristicUuid: string;
      timeoutMs: number;
    }>
  | Readonly<{
      action: "bluetooth_subscribe";
      deviceId: string;
      serviceUuid: string;
      characteristicUuid: string;
      durationMs: number;
    }>
  | Readonly<{
      action: "bluetooth_write";
      deviceId: string;
      serviceUuid: string;
      characteristicUuid: string;
      valueBase64: string;
      timeoutMs: number;
    }>
  | Readonly<{
      action: "bluetooth_recover";
      recoveryId: string;
      timeoutMs: number;
    }>
  | Readonly<{
      action: "http_request";
      url: string;
      method: "GET" | "HEAD";
      maxResponseBytes: number;
      timeoutMs: number;
    }>
  | Readonly<{
      action: "tcp_exchange" | "udp_exchange";
      host: string;
      port: number;
      requestBase64: string;
      maxResponseBytes: number;
      timeoutMs: number;
    }>;

export function parseDirectDeviceOperation(
  input: AgentDeviceCapabilityInput,
): DirectDeviceOperation {
  switch (input.action) {
    case "bluetooth_services":
      return Object.freeze({
        action: input.action,
        deviceId: requiredDeviceId(input.deviceId),
        timeoutMs: integer(
          input.timeoutMs ?? 10_000,
          500,
          30_000,
          "BLE 超时无效。",
        ),
      });
    case "bluetooth_read":
      return Object.freeze({
        action: input.action,
        deviceId: requiredDeviceId(input.deviceId),
        serviceUuid: normalizeBluetoothUuid(input.serviceUuid),
        characteristicUuid: normalizeBluetoothUuid(input.characteristicUuid),
        timeoutMs: integer(
          input.timeoutMs ?? 10_000,
          500,
          30_000,
          "BLE 超时无效。",
        ),
      });
    case "bluetooth_subscribe":
      return Object.freeze({
        action: input.action,
        deviceId: requiredDeviceId(input.deviceId),
        serviceUuid: normalizeBluetoothUuid(input.serviceUuid),
        characteristicUuid: normalizeBluetoothUuid(input.characteristicUuid),
        durationMs: integer(
          input.durationMs ?? 10_000,
          500,
          30_000,
          "BLE 订阅时长无效。",
        ),
      });
    case "bluetooth_write":
      return Object.freeze({
        action: input.action,
        deviceId: requiredDeviceId(input.deviceId),
        serviceUuid: normalizeBluetoothUuid(input.serviceUuid),
        characteristicUuid: normalizeBluetoothUuid(input.characteristicUuid),
        valueBase64: payload(
          input.valueBase64,
          input.valueText,
          512,
          "BLE 写入",
        ),
        timeoutMs: integer(
          input.timeoutMs ?? 10_000,
          500,
          30_000,
          "BLE 超时无效。",
        ),
      });
    case "bluetooth_recover":
      return Object.freeze({
        action: input.action,
        recoveryId: boundedText(input.recoveryId, 160, "BLE 恢复 ID 无效。"),
        timeoutMs: integer(
          input.timeoutMs ?? 10_000,
          500,
          30_000,
          "BLE 超时无效。",
        ),
      });
    case "http_request": {
      const rawUrl = boundedText(input.url, 2_048, "局域网 HTTP 地址无效。");
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch (error) {
        throw new Error("局域网 HTTP 地址无效。", { cause: error });
      }
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password
      ) {
        throw new Error("局域网 HTTP 只支持不含凭据的 HTTP(S) 地址。");
      }
      return Object.freeze({
        action: input.action,
        url: url.toString(),
        method:
          input.method === undefined || input.method === "GET"
            ? "GET"
            : input.method === "HEAD"
              ? "HEAD"
              : (() => {
                  throw new Error("局域网 HTTP 方法无效。");
                })(),
        maxResponseBytes: integer(
          input.maxResponseBytes ?? 65_536,
          1,
          262_144,
          "局域网响应上限无效。",
        ),
        timeoutMs: integer(
          input.timeoutMs ?? 8_000,
          250,
          30_000,
          "局域网请求超时无效。",
        ),
      });
    }
    case "tcp_exchange":
    case "udp_exchange":
      return Object.freeze({
        action: input.action,
        host: networkHost(input.host),
        port: integer(input.port, 1, 65_535, "局域网端口无效。"),
        requestBase64: payload(
          input.requestBase64,
          input.requestText,
          input.action === "udp_exchange" ? 65_507 : 65_536,
          input.action === "udp_exchange" ? "UDP 请求" : "TCP 请求",
        ),
        maxResponseBytes: integer(
          input.maxResponseBytes ?? 65_536,
          1,
          262_144,
          "局域网响应上限无效。",
        ),
        timeoutMs: integer(
          input.timeoutMs ?? 8_000,
          250,
          30_000,
          "局域网请求超时无效。",
        ),
      });
    default:
      throw new Error("该动作不是动态设备通信动作。");
  }
}

export function assertDirectDeviceOperationAllowed(
  document: DeviceProfilesDocument,
  operation: DirectDeviceOperation,
) {
  if (document.policy !== "allowlist") return;
  if (document.profiles.some((profile) => profileAllows(profile, operation))) {
    return;
  }
  throw new Error(
    "当前项目启用了用户创建的设备通信白名单，此操作不在 allowlist 中。",
  );
}

export function directDeviceOperationDataDescription(
  operation: DirectDeviceOperation,
) {
  switch (operation.action) {
    case "bluetooth_services":
      return `连接临时 BLE 设备 ${operation.deviceId} 并读取服务与特征目录`;
    case "bluetooth_read":
      return `读取临时 BLE 设备 ${operation.deviceId} 的特征 ${operation.characteristicUuid}`;
    case "bluetooth_subscribe":
      return `订阅临时 BLE 设备 ${operation.deviceId} 的特征 ${operation.characteristicUuid}，最长 ${operation.durationMs} 毫秒`;
    case "bluetooth_write":
      return `向临时 BLE 设备 ${operation.deviceId} 的特征 ${operation.characteristicUuid} 可恢复写入 ${base64ByteLength(operation.valueBase64)} 字节`;
    case "bluetooth_recover":
      return `恢复先前 BLE 写入 ${operation.recoveryId}`;
    case "http_request":
      return `访问局域网 ${operation.method} ${operation.url}`;
    case "tcp_exchange":
    case "udp_exchange":
      return `向局域网 ${operation.host}:${operation.port} 发送 ${base64ByteLength(operation.requestBase64)} 字节 ${operation.action === "tcp_exchange" ? "TCP" : "UDP"} 查询并读取有界响应`;
  }
}

export function normalizeBluetoothUuid(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (FULL_UUID.test(normalized)) return normalized;
  const short = SHORT_UUID.exec(normalized)?.[1];
  if (!short) throw new Error("BLE UUID 无效。");
  return `${short.padStart(8, "0")}-0000-1000-8000-00805f9b34fb`;
}

function profileAllows(
  profile: DeviceProfile,
  operation: DirectDeviceOperation,
) {
  if (operation.action === "bluetooth_services") {
    return profile.transport === "ble";
  }
  if (operation.action === "bluetooth_recover") return true;
  if (operation.action === "http_request" && profile.transport === "http") {
    return profile.actions.some(
      (action) =>
        action.operation === "http" &&
        action.method === operation.method &&
        new URL(action.path, profile.baseUrl!).toString() === operation.url,
    );
  }
  if (
    (operation.action === "tcp_exchange" ||
      operation.action === "udp_exchange") &&
    profile.transport === operation.action.replace("_exchange", "")
  ) {
    return (
      profile.host?.toLowerCase() === operation.host.toLowerCase() &&
      profile.port === operation.port &&
      profile.actions.some(
        (action) =>
          action.operation === profile.transport &&
          "requestBase64" in action &&
          action.requestBase64 === operation.requestBase64,
      )
    );
  }
  if (
    (operation.action === "bluetooth_read" ||
      operation.action === "bluetooth_subscribe" ||
      operation.action === "bluetooth_write") &&
    profile.transport === "ble"
  ) {
    const expectedOperation = operation.action.replace("bluetooth_", "ble-");
    return profile.actions.some(
      (action) =>
        "serviceUuid" in action &&
        action.operation === expectedOperation &&
        action.serviceUuid === operation.serviceUuid &&
        action.characteristicUuid === operation.characteristicUuid &&
        (operation.action !== "bluetooth_write" ||
          action.valueBase64 === operation.valueBase64),
    );
  }
  return false;
}

function requiredDeviceId(value: unknown) {
  const deviceId = boundedText(value, 128, "BLE 临时设备 ID 无效。");
  if (!/^ble-[a-f0-9]{24}$/u.test(deviceId)) {
    throw new Error("BLE 临时设备 ID 无效，请先重新扫描。");
  }
  return deviceId;
}

function networkHost(value: unknown) {
  const host = boundedText(value, 253, "局域网主机无效。");
  if (/[/@\s]/u.test(host)) throw new Error("局域网主机无效。");
  return host;
}

function boundedText(value: unknown, max: number, message: string) {
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

function payload(
  encoded: string | undefined,
  text: string | undefined,
  maxBytes: number,
  label: string,
) {
  if ((encoded === undefined) === (text === undefined)) {
    throw new Error(`${label}必须且只能提供 base64 或文本载荷之一。`);
  }
  if (text !== undefined) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > maxBytes) throw new Error(`${label}载荷过大。`);
    return encodeBase64(bytes);
  }
  if (
    encoded === undefined ||
    encoded.length > Math.ceil(maxBytes / 3) * 4 ||
    !BASE64.test(encoded) ||
    base64ByteLength(encoded) > maxBytes
  ) {
    throw new Error(`${label}载荷不是有效或受限的 base64。`);
  }
  return encoded;
}

function base64ByteLength(value: string) {
  if (!value) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output;
}
