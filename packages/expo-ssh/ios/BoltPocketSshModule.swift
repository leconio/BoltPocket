import CryptoKit
import ExpoModulesCore
import Foundation
import NMSSH

private let maximumNativeReadBytes = 1_000_000

private struct PasswordConnectionOptions: Record {
  @Field var sessionId: String
  @Field var host: String
  @Field var port: Int = 22
  @Field var username: String
  @Field var password: String
  @Field var expectedFingerprint: String
  @Field var timeoutMs: Int = 10_000
}

private struct KeyConnectionOptions: Record {
  @Field var sessionId: String
  @Field var host: String
  @Field var port: Int = 22
  @Field var username: String
  @Field var privateKey: String
  @Field var publicKey: String?
  @Field var passphrase: String?
  @Field var expectedFingerprint: String
  @Field var timeoutMs: Int = 10_000
}

private final class BoltPocketSshException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}

public final class BoltPocketSshModule: Module {
  private let transportQueue = DispatchQueue(label: "dev.boltpocket.app.ssh.transport")
  private var sessions: [String: NMSSHSession] = [:]

  public func definition() -> ModuleDefinition {
    Name("BoltPocketSsh")

    AsyncFunction("probeHostKey") {
      (host: String, port: Int, timeoutMs: Int) throws -> [String: String] in
      try self.probeHostKey(host: host, port: port, timeoutMs: timeoutMs)
    }.runOnQueue(transportQueue)

    AsyncFunction("connectWithPassword") {
      (options: PasswordConnectionOptions) throws -> [String: String] in
      try self.connectWithPassword(options)
    }.runOnQueue(transportQueue)

    AsyncFunction("connectWithKey") {
      (options: KeyConnectionOptions) throws -> [String: String] in
      try self.connectWithKey(options)
    }.runOnQueue(transportQueue)

    AsyncFunction("disconnect") { (sessionId: String) in
      self.disconnect(sessionId: sessionId)
    }.runOnQueue(transportQueue)

    AsyncFunction("disconnectAll") {
      self.disconnectAll()
    }.runOnQueue(transportQueue)

    AsyncFunction("list") {
      (sessionId: String, path: String) throws -> [[String: Any]] in
      let safe = try self.safePath(path)
      return try self.withSftp(sessionId: sessionId) { sftp in
        guard let entries = BoltPocketNMSSHBridge.list(safe, sftp: sftp) else {
          throw BoltPocketSshException("Could not read the SFTP directory.")
        }
        return entries
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("stat") {
      (sessionId: String, path: String) throws -> [String: Any]? in
      let safe = try self.safePath(path)
      return try self.withSftp(sessionId: sessionId) { sftp in
        BoltPocketNMSSHBridge.stat(safe, sftp: sftp)
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("readText") {
      (sessionId: String, path: String, maxBytes: Int) throws -> String in
      try self.readText(sessionId: sessionId, path: path, maxBytes: maxBytes)
    }.runOnQueue(transportQueue)

    AsyncFunction("execute") {
      (
        sessionId: String,
        command: String,
        stdin: String?,
        maxOutputBytes: Int,
        timeoutMs: Int
      ) throws -> [String: Any] in
      try self.execute(
        sessionId: sessionId,
        command: command,
        stdin: stdin,
        maxOutputBytes: maxOutputBytes,
        timeoutMs: timeoutMs
      )
    }.runOnQueue(transportQueue)

    AsyncFunction("writeText") {
      (sessionId: String, path: String, text: String) throws in
      let safe = try self.safePath(path)
      let data = Data(text.utf8)
      try self.withSftp(sessionId: sessionId) { sftp in
        guard BoltPocketNMSSHBridge.write(data, path: safe, sftp: sftp) else {
          throw BoltPocketSshException("Could not complete the SFTP write.")
        }
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("makeDirectory") {
      (sessionId: String, path: String) throws in
      let safe = try self.safePath(path)
      try self.withSftp(sessionId: sessionId) { sftp in
        guard BoltPocketNMSSHBridge.makeDirectory(safe, sftp: sftp) else {
          throw BoltPocketSshException("Could not create the SFTP directory.")
        }
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("rename") {
      (sessionId: String, source: String, destination: String) throws in
      let safeSource = try self.safePath(source)
      let safeDestination = try self.safePath(destination)
      try self.withSftp(sessionId: sessionId) { sftp in
        guard BoltPocketNMSSHBridge.rename(
          safeSource,
          to: safeDestination,
          sftp: sftp
        ) else {
          throw BoltPocketSshException("Could not rename the SFTP item.")
        }
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("remove") {
      (sessionId: String, path: String) throws in
      let safe = try self.safePath(path)
      try self.withSftp(sessionId: sessionId) { sftp in
        guard BoltPocketNMSSHBridge.remove(safe, sftp: sftp) else {
          throw BoltPocketSshException("Could not remove the SFTP file.")
        }
      }
    }.runOnQueue(transportQueue)

    AsyncFunction("setMode") {
      (sessionId: String, path: String, mode: Int) throws in
      guard mode >= 0, mode <= 0o7777 else {
        throw BoltPocketSshException("Invalid SFTP file mode.")
      }
      let safe = try self.safePath(path)
      try self.withSftp(sessionId: sessionId) { sftp in
        guard BoltPocketNMSSHBridge.chmod(UInt(mode), path: safe, sftp: sftp) else {
          throw BoltPocketSshException("Could not preserve SFTP file permissions.")
        }
      }
    }.runOnQueue(transportQueue)
  }

  private func probeHostKey(
    host: String,
    port: Int,
    timeoutMs: Int
  ) throws -> [String: String] {
    try requireEndpoint(host: host, port: port, timeoutMs: timeoutMs)
    let session = BoltPocketNMSSHBridge.makeSession(
      host: host,
      port: port,
      username: "boltpocket-probe"
    )
    defer { BoltPocketNMSSHBridge.disconnect(session: session) }
    guard BoltPocketNMSSHBridge.connect(
      session: session,
      timeoutSeconds: timeoutSeconds(timeoutMs)
    ) else {
      throw BoltPocketSshException("Could not establish the SSH key exchange.")
    }
    return try hostKeyResult(session)
  }

  private func connectWithPassword(
    _ options: PasswordConnectionOptions
  ) throws -> [String: String] {
    guard !options.password.isEmpty, options.password.utf8.count <= 16_384 else {
      throw BoltPocketSshException("SSH password is required and must be reasonably sized.")
    }
    return try connectAndStore(
      sessionId: options.sessionId,
      host: options.host,
      port: options.port,
      username: options.username,
      expectedFingerprint: options.expectedFingerprint,
      timeoutMs: options.timeoutMs
    ) { session in
      BoltPocketNMSSHBridge.authenticate(session: session, password: options.password)
    }
  }

  private func connectWithKey(
    _ options: KeyConnectionOptions
  ) throws -> [String: String] {
    guard !options.privateKey.isEmpty, options.privateKey.utf8.count <= maximumNativeReadBytes else {
      throw BoltPocketSshException("SSH private key is required and must be reasonably sized.")
    }
    guard (options.publicKey?.utf8.count ?? 0) <= maximumNativeReadBytes,
      (options.passphrase?.utf8.count ?? 0) <= 16_384 else {
      throw BoltPocketSshException("SSH key material is too large.")
    }
    return try connectAndStore(
      sessionId: options.sessionId,
      host: options.host,
      port: options.port,
      username: options.username,
      expectedFingerprint: options.expectedFingerprint,
      timeoutMs: options.timeoutMs
    ) { session in
      BoltPocketNMSSHBridge.authenticate(
        session: session,
        publicKey: options.publicKey,
        privateKey: options.privateKey,
        passphrase: options.passphrase
      )
    }
  }

  private func connectAndStore(
    sessionId: String,
    host: String,
    port: Int,
    username: String,
    expectedFingerprint: String,
    timeoutMs: Int,
    authenticate: (NMSSHSession) -> Bool
  ) throws -> [String: String] {
    try requireEndpoint(host: host, port: port, timeoutMs: timeoutMs)
    guard !sessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw BoltPocketSshException("SSH session and username are required.")
    }
    guard expectedFingerprint.hasPrefix("SHA256:") else {
      throw BoltPocketSshException("A confirmed SHA-256 host-key fingerprint is required.")
    }

    let session = BoltPocketNMSSHBridge.makeSession(
      host: host,
      port: port,
      username: username
    )
    var keepSession = false
    defer {
      if !keepSession {
        BoltPocketNMSSHBridge.disconnect(session: session)
      }
    }
    guard BoltPocketNMSSHBridge.connect(
      session: session,
      timeoutSeconds: timeoutSeconds(timeoutMs)
    ) else {
      throw BoltPocketSshException("Could not establish the SSH connection.")
    }

    let hostKey = try hostKeyResult(session)
    guard constantTimeEqual(hostKey["fingerprint"] ?? "", expectedFingerprint) else {
      throw BoltPocketSshException("SSH host-key verification failed.")
    }
    guard authenticate(session) else {
      throw BoltPocketSshException("SSH authentication failed.")
    }

    if let previous = sessions.removeValue(forKey: sessionId) {
      BoltPocketNMSSHBridge.disconnect(session: previous)
    }
    sessions[sessionId] = session
    keepSession = true
    return hostKey
  }

  private func disconnect(sessionId: String) {
    guard let session = sessions.removeValue(forKey: sessionId) else { return }
    BoltPocketNMSSHBridge.disconnect(session: session)
  }

  private func disconnectAll() {
    let connected = sessions.values
    sessions.removeAll()
    connected.forEach { BoltPocketNMSSHBridge.disconnect(session: $0) }
  }

  private func readText(
    sessionId: String,
    path: String,
    maxBytes: Int
  ) throws -> String {
    guard maxBytes >= 1, maxBytes <= maximumNativeReadBytes else {
      throw BoltPocketSshException("Invalid SSH read limit.")
    }
    let safe = try safePath(path)
    return try withSftp(sessionId: sessionId) { sftp in
      guard let attributes = BoltPocketNMSSHBridge.stat(safe, sftp: sftp),
        attributes["type"] as? String == "file" else {
        throw BoltPocketSshException("The SFTP path is not a regular file.")
      }
      if let size = attributes["size"] as? NSNumber,
        size.uint64Value > UInt64(maxBytes) {
        throw BoltPocketSshException("SSH text resource exceeds the read limit.")
      }
      guard let data = BoltPocketNMSSHBridge.read(
        safe,
        maxBytes: UInt(maxBytes),
        sftp: sftp
      ) else {
        throw BoltPocketSshException("Could not read the SFTP file within the size limit.")
      }
      guard let text = String(data: data, encoding: .utf8) else {
        throw BoltPocketSshException("The SFTP resource is not valid UTF-8 text.")
      }
      return text
    }
  }

  private func execute(
    sessionId: String,
    command: String,
    stdin: String?,
    maxOutputBytes: Int,
    timeoutMs: Int
  ) throws -> [String: Any] {
    guard !command.isEmpty,
      command.utf8.count <= 32_768,
      !command.contains("\0") else {
      throw BoltPocketSshException("SSH command is required and must be at most 32 KiB.")
    }
    let input = stdin.map { Data($0.utf8) }
    guard (input?.count ?? 0) <= maximumNativeReadBytes else {
      throw BoltPocketSshException("SSH command input exceeds the 1 MB limit.")
    }
    guard (1...maximumNativeReadBytes).contains(maxOutputBytes) else {
      throw BoltPocketSshException("SSH command output limit must be between 1 byte and 1 MB.")
    }
    guard (1_000...60_000).contains(timeoutMs) else {
      throw BoltPocketSshException("SSH command timeout must be between 1 and 60 seconds.")
    }
    guard let session = sessions[sessionId], session.isConnected, session.isAuthorized else {
      throw BoltPocketSshException("SSH session is not connected.")
    }
    let result = BoltPocketNMSSHBridge.execute(
      command,
      input: input,
      maxOutputBytes: UInt(maxOutputBytes),
      timeoutSeconds: timeoutSeconds(timeoutMs),
      session: session
    )
    if let failure = result["failure"] as? String {
      switch failure {
      case "timeout":
        throw BoltPocketSshException("SSH command timed out.")
      case "output-limit":
        throw BoltPocketSshException("SSH command output exceeds the configured limit.")
      case "not-connected":
        throw BoltPocketSshException("SSH session is not connected.")
      default:
        throw BoltPocketSshException("SSH command execution failed.")
      }
    }
    guard let stdoutData = result["stdout"] as? Data,
      let stderrData = result["stderr"] as? Data,
      let exitCode = result["exitCode"] as? NSNumber,
      let stdout = String(data: stdoutData, encoding: .utf8),
      let stderr = String(data: stderrData, encoding: .utf8) else {
      throw BoltPocketSshException("SSH command returned invalid UTF-8 output.")
    }
    return [
      "stdout": stdout,
      "stderr": stderr,
      "exitCode": exitCode.intValue,
    ]
  }

  private func withSftp<T>(
    sessionId: String,
    operation: (NMSFTP) throws -> T
  ) throws -> T {
    guard let session = sessions[sessionId] else {
      throw BoltPocketSshException("SSH session is not connected.")
    }
    guard let sftp = BoltPocketNMSSHBridge.connectSftp(session: session) else {
      throw BoltPocketSshException("Could not open the SFTP channel.")
    }
    defer { BoltPocketNMSSHBridge.disconnect(sftp: sftp) }
    return try operation(sftp)
  }

  private func hostKeyResult(_ session: NMSSHSession) throws -> [String: String] {
    guard let hostKey = BoltPocketNMSSHBridge.hostKey(session),
      let algorithm = hostKey["algorithm"] as? String,
      algorithm != "unknown",
      let key = hostKey["key"] as? Data else {
      throw BoltPocketSshException("SSH host key was not available or is unsupported.")
    }
    let digest = SHA256.hash(data: key)
    let base64 = Data(digest)
      .base64EncodedString()
      .replacingOccurrences(of: "=", with: "")
    return [
      "algorithm": algorithm,
      "fingerprint": "SHA256:\(base64)"
    ]
  }

  private func safePath(_ path: String) throws -> String {
    guard path.hasPrefix("/"),
      !path.contains("\0"),
      !path.contains("\\"),
      !path.split(separator: "/", omittingEmptySubsequences: false).contains("..") else {
      throw BoltPocketSshException("SFTP path must be absolute and cannot traverse directories.")
    }
    return path
  }

  private func requireEndpoint(host: String, port: Int, timeoutMs: Int) throws {
    guard !host.isEmpty,
      !host.contains(where: { $0.isWhitespace }),
      (1...65_535).contains(port) else {
      throw BoltPocketSshException("Invalid SSH host or port.")
    }
    guard (1_000...60_000).contains(timeoutMs) else {
      throw BoltPocketSshException("SSH timeout must be between 1 and 60 seconds.")
    }
  }

  private func timeoutSeconds(_ timeoutMs: Int) -> Int {
    max(1, (timeoutMs + 999) / 1_000)
  }

  private func constantTimeEqual(_ left: String, _ right: String) -> Bool {
    let leftBytes = Array(left.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
    let rightBytes = Array(right.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
    var difference = leftBytes.count ^ rightBytes.count
    let maximumCount = max(leftBytes.count, rightBytes.count)
    for index in 0..<maximumCount {
      let leftByte = index < leftBytes.count ? leftBytes[index] : 0
      let rightByte = index < rightBytes.count ? rightBytes[index] : 0
      difference |= Int(leftByte ^ rightByte)
    }
    return difference == 0
  }
}
