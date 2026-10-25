import Foundation
import CryptoKit

final class ModelArtifacts {
  private struct Spec: Decodable { let key: String; let bytes: UInt64; let sha256: String }
  private let root: URL
  init(directory: URL? = nil) {
    root = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("models", isDirectory: true)
  }
  private func spec(_ raw: String) throws -> Spec {
    let spec = try JSONDecoder().decode(Spec.self, from: Data(raw.utf8))
    guard spec.key.range(of: "^[a-z0-9-]{1,64}$", options: .regularExpression) != nil,
      spec.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, spec.bytes > 0 else {
      throw failure("Invalid model artifact")
    }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var directory = root
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    return spec
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "BoltPocketModel", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func file(_ spec: Spec, _ suffix: String = "") -> URL {
    root.appendingPathComponent("\(spec.key)-\(spec.sha256).gguf\(suffix)")
  }
  private func size(_ url: URL) -> UInt64 {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.uint64Value ?? 0
  }
  private func ready(_ spec: Spec) -> Bool {
    size(file(spec)) == spec.bytes &&
      (try? String(contentsOf: file(spec, ".verified"), encoding: .utf8)) == "\(spec.sha256):\(spec.bytes)"
  }
  func info(_ raw: String) throws -> [String: Any] {
    let spec = try spec(raw)
    let values = try root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    return ["ready": ready(spec), "partialUri": file(spec, ".part").absoluteString,
      "freeBytes": values.volumeAvailableCapacityForImportantUsage ?? 0]
  }
  func commit(_ raw: String) throws {
    let spec = try spec(raw)
    let part = file(spec, ".part")
    guard size(part) == spec.bytes else { throw failure("Model length mismatch") }
    let input = try FileHandle(forReadingFrom: part)
    defer { try? input.close() }
    var hasher = SHA256()
    while let data = try input.read(upToCount: 1024 * 1024), !data.isEmpty { hasher.update(data: data) }
    let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    guard digest == spec.sha256 else { throw failure("Model checksum mismatch") }
    // Same-volume rename; only a complete, verified download becomes usable.
    if FileManager.default.fileExists(atPath: file(spec).path) {
      _ = try FileManager.default.replaceItemAt(file(spec), withItemAt: part)
    } else { try FileManager.default.moveItem(at: part, to: file(spec)) }
    try "\(spec.sha256):\(spec.bytes)".write(to: file(spec, ".verified"), atomically: true, encoding: .utf8)
  }
  func verifiedPath(_ raw: String) throws -> String {
    let spec = try spec(raw)
    guard ready(spec) else { throw failure("Download and verify this model in Settings > Models first.") }
    return file(spec).path
  }
}
