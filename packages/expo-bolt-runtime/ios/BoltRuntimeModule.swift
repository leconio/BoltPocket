import ExpoModulesCore
import Foundation

public final class BoltRuntimeModule: Module {
  private func record(_ raw: String) {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("bolt-metrics.ndjson")
    if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
    if let file = try? FileHandle(forWritingTo: url) { file.seekToEndOfFile(); file.write((raw + "\n").data(using: .utf8)!); try? file.close() }
  }
  private func receive(_ raw: String) {
    if let data = raw.data(using: .utf8), var value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["type"] as? String != "token" {
      for key in ["text", "prompt", "messages", "tool_calls"] { value.removeValue(forKey: key) }
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
      BoltNativeBridge.load(path, gpu: Int32(gpu)) { [weak self] raw in self?.receive(raw) }
    }
    AsyncFunction("generate") { (payload: String, max: Int, tag: String) in
      BoltNativeBridge.generate(payload, max: Int32(max), tag: tag) { [weak self] raw in self?.receive(raw) }
    }
    Function("cancel") { BoltNativeBridge.cancel() }
    Function("record") { (raw: String) in self.record(raw) }
  }
}
