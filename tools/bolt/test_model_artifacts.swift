import Foundation
import CryptoKit

@main struct ModelArtifactTests {
  static func expect(_ condition: Bool) { precondition(condition) }
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = ModelArtifacts(directory: root)
    let payload = Data("GGUFtest".utf8)
    let sha = SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
    let raw = "{\"key\":\"test-model\",\"bytes\":8,\"sha256\":\"\(sha)\"}"
    let first = try store.info(raw)
    precondition(first["ready"] as? Bool == false)
    let part = URL(string: first["partialUri"] as! String)!
    try Data("corrupt!".utf8).write(to: part)
    do { try store.commit(raw); fatalError("Accepted a corrupt file") } catch {}
    expect(try store.info(raw)["ready"] as? Bool == false)
    try payload.write(to: part)
    try store.commit(raw)
    expect(try store.info(raw)["ready"] as? Bool == true)
    let readyPath = try store.verifiedPath(raw)
    expect(try Data(contentsOf: URL(fileURLWithPath: readyPath)) == payload)
    // Truncation invalidates the receipt; a 64-bit expected length never wraps.
    try Data().write(to: URL(fileURLWithPath: readyPath))
    expect(try store.info(raw)["ready"] as? Bool == false)
    let large = raw.replacingOccurrences(of: "\"bytes\":8", with: "\"bytes\":5060482240")
    expect(try store.info(large)["ready"] as? Bool == false)
    let unsafe = raw.replacingOccurrences(of: "test-model", with: "../escape")
    do { _ = try store.info(unsafe); fatalError("Accepted path traversal") } catch {}
    print("PASS: checksum rejection, atomic completion, receipt validation, truncation, 64-bit size, path confinement")
  }
}
