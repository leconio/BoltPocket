import ExpoModulesCore
import Foundation

private final class ProjectPreviewServerException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Unable to start the isolated project preview server: \(param)"
  }
}

public final class BoltPocketProjectPreviewServerModule: Module {
  private let lock = NSLock()
  private var servers: [String: ProjectPreviewHTTPServer] = [:]

  public func definition() -> ModuleDefinition {
    Name("BoltPocketProjectPreviewServer")

    AsyncFunction("start") { (
      snapshotId: String,
      rootUri: String,
      runtimeRootUri: String,
      promise: Promise
    ) in
      do {
        let server = try ProjectPreviewHTTPServer(
          snapshotId: snapshotId,
          rootUri: rootUri,
          runtimeRootUri: runtimeRootUri
        )
        self.lock.lock()
        let previous = self.servers.updateValue(server, forKey: snapshotId)
        self.lock.unlock()
        previous?.stop()
        server.start { result in
          switch result {
          case .success(let port):
            promise.resolve(Int(port))
          case .failure(let error):
            _ = self.removeServer(snapshotId, matching: server)
            promise.reject(ProjectPreviewServerException(error.localizedDescription))
          }
        }
      } catch {
        promise.reject(ProjectPreviewServerException(error.localizedDescription))
      }
    }

    AsyncFunction("stop") { (snapshotId: String) in
      self.removeServer(snapshotId)?.stop()
    }

    OnDestroy {
      self.lock.lock()
      let active = Array(self.servers.values)
      self.servers.removeAll()
      self.lock.unlock()
      active.forEach { $0.stop() }
    }
  }

  private func removeServer(
    _ snapshotId: String,
    matching expected: ProjectPreviewHTTPServer? = nil
  ) -> ProjectPreviewHTTPServer? {
    lock.lock()
    defer { lock.unlock() }
    guard let current = servers[snapshotId] else { return nil }
    if let expected, current !== expected { return nil }
    servers.removeValue(forKey: snapshotId)
    return current
  }
}
