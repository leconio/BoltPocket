import ExpoModulesCore
import Foundation
import Network
import UIKit

private final class DeviceCapabilityException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

public final class BoltPocketDeviceCapabilitiesModule: Module {
  private let queue = DispatchQueue(label: "dev.boltpocket.app.device-capabilities")

  public func definition() -> ModuleDefinition {
    Name("BoltPocketDeviceCapabilities")

    AsyncFunction("getDeviceStatus") { () -> [String: Any] in
      let device = UIDevice.current
      return [
        "platform": "ios",
        "systemName": device.systemName,
        "systemVersion": device.systemVersion,
        "deviceClass": device.userInterfaceIdiom == .pad ? "tablet" : "phone",
        "locale": Locale.current.identifier,
        "timeZone": TimeZone.current.identifier,
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ]
    }.runOnQueue(queue)

    AsyncFunction("getPowerStatus") { () -> [String: Any] in
      let device = UIDevice.current
      device.isBatteryMonitoringEnabled = true
      defer { device.isBatteryMonitoringEnabled = false }
      let level = device.batteryLevel
      return [
        "batteryLevel": level < 0 ? NSNull() : Double(level),
        "batteryState": Self.batteryState(device.batteryState),
        "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
        "thermalState": Self.thermalState(ProcessInfo.processInfo.thermalState),
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ]
    }.runOnQueue(queue)

    AsyncFunction("getStorageStatus") { () throws -> [String: Any] in
      let values = try URL(fileURLWithPath: NSHomeDirectory()).resourceValues(
        forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]
      )
      return [
        "totalBytes": values.volumeTotalCapacity ?? 0,
        "availableBytes": values.volumeAvailableCapacityForImportantUsage ?? 0,
        "physicalMemoryBytes": ProcessInfo.processInfo.physicalMemory,
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ]
    }.runOnQueue(queue)

    AsyncFunction("getNetworkStatus") { () -> [String: Any] in
      let monitor = NWPathMonitor()
      let semaphore = DispatchSemaphore(value: 0)
      var snapshot: [String: Any] = ["connected": false, "transports": []]
      monitor.pathUpdateHandler = { path in
        var transports: [String] = []
        if path.usesInterfaceType(.wifi) { transports.append("wifi") }
        if path.usesInterfaceType(.cellular) { transports.append("cellular") }
        if path.usesInterfaceType(.wiredEthernet) { transports.append("ethernet") }
        snapshot = [
          "connected": path.status == .satisfied,
          "transports": transports,
          "expensive": path.isExpensive,
          "constrained": path.isConstrained,
          "capturedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        semaphore.signal()
      }
      monitor.start(queue: DispatchQueue.global(qos: .utility))
      _ = semaphore.wait(timeout: .now() + 1)
      monitor.cancel()
      return snapshot
    }.runOnQueue(queue)

    AsyncFunction("getWifiStatus") { () -> [String: Any] in
      ["supported": false, "reason": "iOS does not expose general Wi-Fi scanning to apps."]
    }.runOnQueue(queue)
    AsyncFunction("getBluetoothStatus") { () -> [String: Any] in
      ["supported": false, "reason": "Bluetooth transport is not enabled in this iOS build."]
    }.runOnQueue(queue)

    AsyncFunction("scanWifi") { (_: String, _: Int, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("Nearby Wi-Fi scanning is unavailable on iOS.")
    }.runOnQueue(queue)
    AsyncFunction("scanBluetooth") { (_: String, _: Int, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("Bluetooth scanning is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("discoverBluetoothServices") { (_: String, _: String, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("BLE communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("bleRead") { (_: String, _: String, _: String, _: String, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("BLE communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("bleSubscribe") { (_: String, _: String, _: String, _: String, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("BLE communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("bleWriteReversible") { (_: String, _: String, _: String, _: String, _: String, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("BLE communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("bleRecover") { (_: String, _: String, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("BLE recovery is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("httpRequest") { (_: String, _: String, _: String, _: String?, _: Int, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("Local-device network communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("tcpExchange") { (_: String, _: String, _: Int, _: String, _: Int, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("Local-device network communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("udpExchange") { (_: String, _: String, _: Int, _: String, _: Int, _: Int) throws -> [String: Any] in
      throw DeviceCapabilityException("Local-device network communication is unavailable in this iOS build.")
    }.runOnQueue(queue)
    AsyncFunction("cancel") { (_: String) in }.runOnQueue(queue)
  }

  private static func batteryState(_ value: UIDevice.BatteryState) -> String {
    switch value {
    case .charging: return "charging"
    case .full: return "full"
    case .unplugged: return "unplugged"
    default: return "unknown"
    }
  }

  private static func thermalState(_ value: ProcessInfo.ThermalState) -> String {
    switch value {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }
}
