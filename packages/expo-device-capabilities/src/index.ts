import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeJsonValue =
  | null
  | boolean
  | number
  | string
  | NativeJsonValue[]
  | { [key: string]: NativeJsonValue };

export type NativeJsonRecord = { [key: string]: NativeJsonValue };

type NativeBoltPocketDeviceCapabilitiesModule = {
  getDeviceStatus(): Promise<NativeJsonRecord>;
  getPowerStatus(): Promise<NativeJsonRecord>;
  getStorageStatus(): Promise<NativeJsonRecord>;
  getNetworkStatus(): Promise<NativeJsonRecord>;
  getWifiStatus(): Promise<NativeJsonRecord>;
  scanWifi(
    operationId: string,
    timeoutMs: number,
    maxResults: number,
  ): Promise<NativeJsonRecord>;
  getBluetoothStatus(): Promise<NativeJsonRecord>;
  scanBluetooth(
    operationId: string,
    durationMs: number,
    maxResults: number,
  ): Promise<NativeJsonRecord>;
  discoverBluetoothServices(
    operationId: string,
    deviceId: string,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  bleRead(
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  bleSubscribe(
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    durationMs: number,
  ): Promise<NativeJsonRecord>;
  bleWriteReversible(
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    valueBase64: string,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  bleRecover(
    operationId: string,
    recoveryId: string,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  httpRequest(
    operationId: string,
    url: string,
    method: string,
    bodyBase64: string | null,
    maxResponseBytes: number,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  tcpExchange(
    operationId: string,
    host: string,
    port: number,
    requestBase64: string,
    maxResponseBytes: number,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  udpExchange(
    operationId: string,
    host: string,
    port: number,
    requestBase64: string,
    maxResponseBytes: number,
    timeoutMs: number,
  ): Promise<NativeJsonRecord>;
  cancel(operationId: string): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<NativeBoltPocketDeviceCapabilitiesModule>(
    "BoltPocketDeviceCapabilities",
  );

function requiredModule() {
  if (!nativeModule) {
    throw new Error(
      "Device capabilities are unavailable in this platform build.",
    );
  }
  return nativeModule;
}

export const BoltPocketDeviceCapabilities = Object.freeze({
  isAvailable: Boolean(nativeModule),
  getDeviceStatus: () => requiredModule().getDeviceStatus(),
  getPowerStatus: () => requiredModule().getPowerStatus(),
  getStorageStatus: () => requiredModule().getStorageStatus(),
  getNetworkStatus: () => requiredModule().getNetworkStatus(),
  getWifiStatus: () => requiredModule().getWifiStatus(),
  scanWifi: (operationId: string, timeoutMs = 10_000, maxResults = 32) =>
    requiredModule().scanWifi(operationId, timeoutMs, maxResults),
  getBluetoothStatus: () => requiredModule().getBluetoothStatus(),
  scanBluetooth: (operationId: string, durationMs = 8_000, maxResults = 32) =>
    requiredModule().scanBluetooth(operationId, durationMs, maxResults),
  discoverBluetoothServices: (
    operationId: string,
    deviceId: string,
    timeoutMs = 10_000,
  ) =>
    requiredModule().discoverBluetoothServices(
      operationId,
      deviceId,
      timeoutMs,
    ),
  bleRead: (
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    timeoutMs = 10_000,
  ) =>
    requiredModule().bleRead(
      operationId,
      deviceId,
      serviceUuid,
      characteristicUuid,
      timeoutMs,
    ),
  bleSubscribe: (
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    durationMs = 10_000,
  ) =>
    requiredModule().bleSubscribe(
      operationId,
      deviceId,
      serviceUuid,
      characteristicUuid,
      durationMs,
    ),
  bleWriteReversible: (
    operationId: string,
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    valueBase64: string,
    timeoutMs = 10_000,
  ) =>
    requiredModule().bleWriteReversible(
      operationId,
      deviceId,
      serviceUuid,
      characteristicUuid,
      valueBase64,
      timeoutMs,
    ),
  bleRecover: (operationId: string, recoveryId: string, timeoutMs = 10_000) =>
    requiredModule().bleRecover(operationId, recoveryId, timeoutMs),
  httpRequest: (
    operationId: string,
    url: string,
    method: "GET" | "HEAD",
    bodyBase64: string | null,
    maxResponseBytes: number,
    timeoutMs: number,
  ) =>
    requiredModule().httpRequest(
      operationId,
      url,
      method,
      bodyBase64,
      maxResponseBytes,
      timeoutMs,
    ),
  tcpExchange: (
    operationId: string,
    host: string,
    port: number,
    requestBase64: string,
    maxResponseBytes: number,
    timeoutMs: number,
  ) =>
    requiredModule().tcpExchange(
      operationId,
      host,
      port,
      requestBase64,
      maxResponseBytes,
      timeoutMs,
    ),
  udpExchange: (
    operationId: string,
    host: string,
    port: number,
    requestBase64: string,
    maxResponseBytes: number,
    timeoutMs: number,
  ) =>
    requiredModule().udpExchange(
      operationId,
      host,
      port,
      requestBase64,
      maxResponseBytes,
      timeoutMs,
    ),
  cancel: (operationId: string) => requiredModule().cancel(operationId),
});
