import Foundation
import Network

private enum ProjectPreviewHTTPServerError: LocalizedError {
  case invalidSnapshot
  case invalidRoot
  case unavailablePort

  var errorDescription: String? {
    switch self {
    case .invalidSnapshot:
      return "The snapshot id is invalid."
    case .invalidRoot:
      return "The snapshot root is invalid."
    case .unavailablePort:
      return "The loopback listener did not receive a port."
    }
  }
}

final class ProjectPreviewHTTPServer {
  private static let maximumHeaderBytes = 16 * 1024
  private let snapshotId: String
  private let root: URL
  private let runtimeRoot: URL
  private let contentRoutePrefix: String
  private let runtimeRoutePrefix: String
  private let queue: DispatchQueue
  private let listener: NWListener
  private var startCompletion: ((Result<UInt16, Error>) -> Void)?

  init(snapshotId: String, rootUri: String, runtimeRootUri: String) throws {
    guard snapshotId.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else {
      throw ProjectPreviewHTTPServerError.invalidSnapshot
    }
    let resolved = try Self.resolveDirectory(rootUri)
    let resolvedRuntimeRoot = try Self.resolveDirectory(runtimeRootUri)

    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = false
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    self.listener = try NWListener(using: parameters)
    self.snapshotId = snapshotId
    self.root = resolved
    self.runtimeRoot = resolvedRuntimeRoot
    self.contentRoutePrefix = "/\(snapshotId)/content/"
    self.runtimeRoutePrefix = "/\(snapshotId)/runtime/"
    self.queue = DispatchQueue(
      label: "dev.boltpocket.app.project-preview.\(snapshotId)",
      qos: .userInitiated
    )
  }

  private static func resolveDirectory(_ rootUri: String) throws -> URL {
    guard
      let candidate = URL(string: rootUri),
      candidate.isFileURL,
      candidate.host == nil,
      candidate.query == nil,
      candidate.fragment == nil
    else {
      throw ProjectPreviewHTTPServerError.invalidRoot
    }
    let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      throw ProjectPreviewHTTPServerError.invalidRoot
    }
    return resolved
  }

  func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
    queue.async {
      self.startCompletion = completion
      self.listener.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          guard let port = self.listener.port else {
            self.finishStart(.failure(ProjectPreviewHTTPServerError.unavailablePort))
            return
          }
          self.finishStart(.success(port.rawValue))
        case .failed(let error):
          self.finishStart(.failure(error))
          self.listener.cancel()
        default:
          break
        }
      }
      self.listener.newConnectionHandler = { [weak self] connection in
        self?.accept(connection)
      }
      self.listener.start(queue: self.queue)
    }
  }

  func stop() {
    queue.async {
      self.startCompletion = nil
      self.listener.cancel()
    }
  }

  private func finishStart(_ result: Result<UInt16, Error>) {
    guard let completion = startCompletion else { return }
    startCompletion = nil
    completion(result)
  }

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    receiveRequest(connection, buffer: Data())
  }

  private func receiveRequest(_ connection: NWConnection, buffer: Data) {
    connection.receive(
      minimumIncompleteLength: 1,
      maximumLength: Self.maximumHeaderBytes
    ) { [weak self] content, _, isComplete, error in
      guard let self else {
        connection.cancel()
        return
      }
      var next = buffer
      if let content { next.append(content) }
      if next.range(of: Data("\r\n\r\n".utf8)) != nil {
        self.respond(connection, request: next)
        return
      }
      if error != nil || isComplete || next.count >= Self.maximumHeaderBytes {
        self.send(connection, status: 431, reason: "Request Header Fields Too Large")
        return
      }
      self.receiveRequest(connection, buffer: next)
    }
  }

  private func respond(_ connection: NWConnection, request: Data) {
    guard
      let header = String(data: request, encoding: .utf8),
      let requestLine = header.components(separatedBy: "\r\n").first
    else {
      send(connection, status: 400, reason: "Bad Request")
      return
    }
    let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count == 3 else {
      send(connection, status: 400, reason: "Bad Request")
      return
    }
    let method = String(parts[0])
    guard method == "GET" || method == "HEAD" else {
      send(connection, status: 405, reason: "Method Not Allowed")
      return
    }
    guard let resource = resolve(String(parts[1])) else {
      send(connection, status: 404, reason: "Not Found")
      return
    }
    do {
      let body = try Data(contentsOf: resource.file, options: .mappedIfSafe)
      send(
        connection,
        status: 200,
        reason: "OK",
        contentType: Self.contentType(for: resource.file.pathExtension),
        body: method == "HEAD" ? Data() : body,
        declaredLength: body.count,
        cacheControl: resource.cacheControl
      )
    } catch {
      send(connection, status: 404, reason: "Not Found")
    }
  }

  private func resolve(_ requestTarget: String) -> (file: URL, cacheControl: String)? {
    let rawPath = requestTarget.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    guard let decodedPath = rawPath.removingPercentEncoding else { return nil }
    if
      rawPath.hasPrefix(contentRoutePrefix),
      decodedPath.hasPrefix(contentRoutePrefix),
      let file = resolveFile(decodedPath, prefix: contentRoutePrefix, root: root)
    {
      return (file, "no-store")
    }
    if
      rawPath.hasPrefix(runtimeRoutePrefix),
      decodedPath.hasPrefix(runtimeRoutePrefix),
      let file = resolveFile(
        decodedPath,
        prefix: runtimeRoutePrefix,
        root: runtimeRoot,
        runtimeAssetOnly: true
      )
    {
      return (file, "public, max-age=31536000, immutable")
    }
    return nil
  }

  private func resolveFile(
    _ decodedPath: String,
    prefix: String,
    root: URL,
    runtimeAssetOnly: Bool = false
  ) -> URL? {
    let relative = String(decodedPath.dropFirst(prefix.count))
    let segments = relative.split(separator: "/", omittingEmptySubsequences: false)
    guard
      !segments.isEmpty,
      segments.allSatisfy({
        !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\\") && !$0.contains("\0")
      })
    else {
      return nil
    }
    if runtimeAssetOnly {
      guard
        segments.count == 1,
        relative.range(of: "^[a-f0-9]{64}\\.js$", options: .regularExpression) != nil
      else {
        return nil
      }
    }
    let candidate = segments.reduce(root) { partial, segment in
      partial.appendingPathComponent(String(segment), isDirectory: false)
    }.standardizedFileURL.resolvingSymlinksInPath()
    let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
    guard candidate.path.hasPrefix(rootPath) else { return nil }
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
      !isDirectory.boolValue
    else {
      return nil
    }
    return candidate
  }

  private func send(
    _ connection: NWConnection,
    status: Int,
    reason: String,
    contentType: String = "text/plain; charset=utf-8",
    body: Data = Data(),
    declaredLength: Int? = nil,
    cacheControl: String = "no-store"
  ) {
    let length = declaredLength ?? body.count
    let headers = [
      "HTTP/1.1 \(status) \(reason)",
      "Content-Type: \(contentType)",
      "Content-Length: \(length)",
      "Cache-Control: \(cacheControl)",
      "X-Content-Type-Options: nosniff",
      "Connection: close",
      "",
      ""
    ].joined(separator: "\r\n")
    var response = Data(headers.utf8)
    response.append(body)
    connection.send(content: response, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  private static func contentType(for extensionValue: String) -> String {
    switch extensionValue.lowercased() {
    case "html", "htm": return "text/html; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml; charset=utf-8"
    case "xml": return "application/xml; charset=utf-8"
    case "webmanifest": return "application/manifest+json; charset=utf-8"
    case "txt", "csv": return "text/plain; charset=utf-8"
    case "ico": return "image/x-icon"
    default: return "application/octet-stream"
    }
  }
}
