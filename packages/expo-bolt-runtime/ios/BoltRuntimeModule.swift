import ExpoModulesCore
import Foundation
import Metal
import UIKit

public final class BoltRuntimeModule: Module {
  private let artifacts = ModelArtifacts()
  private let metricsLock = NSLock()
  private var thermalObserver: NSObjectProtocol?

  private var thermalState: String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  deinit {
    if let thermalObserver { NotificationCenter.default.removeObserver(thermalObserver) }
  }

  private func record(_ raw: String) {
    metricsLock.lock()
    defer { metricsLock.unlock() }
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("bolt-metrics.ndjson")
    if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
    if let file = try? FileHandle(forWritingTo: url) { file.seekToEndOfFile(); file.write((raw + "\n").data(using: .utf8)!); try? file.close() }
  }
  @MainActor
  private func captureView() throws -> String {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let window = scenes.filter({ $0.activationState == .foregroundActive })
      .flatMap({ $0.windows }).first(where: { $0.isKeyWindow && !$0.isHidden }) else {
      throw NSError(domain: "BoltRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "No active app window to capture"])
    }
    var drawn = false
    let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
    let image = renderer.image { _ in
      drawn = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
    guard drawn, let png = image.pngData() else {
      throw NSError(domain: "BoltRuntime", code: 2, userInfo: [NSLocalizedDescriptionKey: "App window capture failed"])
    }
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("bolt-bonsai2-acceptance-20261025.png")
    try png.write(to: url, options: .atomic)
    let metadata: [String: Any] = ["type": "ios_view_snapshot", "file": url.lastPathComponent,
      "width_points": window.bounds.width, "height_points": window.bounds.height,
      "scale": window.screen.scale, "active_scene": true,
      "idle_timer_disabled": UIApplication.shared.isIdleTimerDisabled]
    if let data = try? JSONSerialization.data(withJSONObject: metadata), let text = String(data: data, encoding: .utf8) { record(text) }
    return url.path
  }
  private func configureRuntime(gpu: Int) -> Int {
    if thermalObserver == nil {
      thermalObserver = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil
      ) { [weak self] _ in
        guard let self else { return }
        self.record("{\"type\":\"ios_thermal_state\",\"thermal_state\":\"\(self.thermalState)\"}")
      }
    }
    record("{\"type\":\"ios_thermal_state\",\"thermal_state\":\"\(thermalState)\"}")
    let manager = FileManager.default
    let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("llama-prefix-cache", isDirectory: true)
    do {
      try manager.createDirectory(at: cache, withIntermediateDirectories: true)
      setenv("BOLT_PREFIX_CACHE_DIR", cache.path, 1)
    } catch {
      unsetenv("BOLT_PREFIX_CACHE_DIR")
      record("{\"type\":\"prefix_cache_unavailable\"}")
    }
    let device = "\(ProcessInfo.processInfo.operatingSystemVersionString):\(MTLCreateSystemDefaultDevice()?.name ?? "CPU")"
    setenv("BOLT_CACHE_DEVICE_ID", device, 1)
    var model = manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("model.gguf")
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? model.setResourceValues(values)
    // Allow a development launch to compare CPU and Metal in the same signed app.
    let override = ProcessInfo.processInfo.environment["BOLT_GPU_LAYERS"].flatMap(Int.init)
    return max(0, override ?? gpu)
  }
  private func receive(_ raw: String) {
    if let data = raw.data(using: .utf8), var value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["type"] as? String != "token" {
      for key in ["text", "prompt", "messages", "tool_calls"] { value.removeValue(forKey: key) }
      value["thermal_state"] = thermalState
      if let safe = try? JSONSerialization.data(withJSONObject: value), let text = String(data: safe, encoding: .utf8) { record(text) }
    }
    sendEvent("onNativeEvent", ["json": raw])
  }
  public func definition() -> ModuleDefinition {
    Name("BoltRuntime")
    Events("onNativeEvent")
    AsyncFunction("prepareModelFile") { () -> String in
      let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("model.gguf")
      if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
      return url.path
    }
    AsyncFunction("load") { (gpu: Int) in
      let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("model.gguf").path
      let layers = self.configureRuntime(gpu: gpu)
      BoltNativeBridge.load(path, gpu: Int32(layers)) { [weak self] raw in
        self?.receive(raw ?? "{\"type\":\"error\",\"message\":\"Invalid native event encoding\"}")
      }
    }
    AsyncFunction("modelArtifactInfo") { (spec: String) throws -> [String: Any] in
      try self.artifacts.info(spec)
    }
    AsyncFunction("commitModelArtifact") { (spec: String) throws in
      try self.artifacts.commit(spec)
    }
    AsyncFunction("loadModelArtifact") { (spec: String, gpu: Int) throws in
      let path = try self.artifacts.verifiedPath(spec)
      let layers = self.configureRuntime(gpu: gpu)
      BoltNativeBridge.load(path, gpu: Int32(layers)) { [weak self] raw in
        self?.receive(raw ?? "{\"type\":\"error\",\"message\":\"Invalid native event encoding\"}")
      }
    }
    AsyncFunction("generate") { (payload: String, max: Int, tag: String) in
      BoltNativeBridge.generate(payload, max: Int32(max), tag: tag) { [weak self] raw in
        self?.receive(raw ?? "{\"type\":\"error\",\"message\":\"Invalid native event encoding\"}")
      }
    }
    Function("cancel") { BoltNativeBridge.cancel() }
    Function("record") { (raw: String) in self.record(raw) }
    AsyncFunction("captureView") { () async throws -> String in
      try await MainActor.run { try self.captureView() }
    }
  }
}
