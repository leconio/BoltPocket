package dev.boltpocket.app.ssh

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel

class PasswordConnectionOptions : Record {
  @Field lateinit var sessionId: String
  @Field lateinit var host: String
  @Field var port: Int = 22
  @Field lateinit var username: String
  @Field lateinit var password: String
  @Field lateinit var expectedFingerprint: String
  @Field var timeoutMs: Int = 10_000
}

class KeyConnectionOptions : Record {
  @Field lateinit var sessionId: String
  @Field lateinit var host: String
  @Field var port: Int = 22
  @Field lateinit var username: String
  @Field lateinit var privateKey: String
  @Field var publicKey: String? = null
  @Field var passphrase: String? = null
  @Field lateinit var expectedFingerprint: String
  @Field var timeoutMs: Int = 10_000
}

private class BoltPocketSshException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

private data class NativeEntry(
  val type: String,
  val size: Long,
  val mode: Int,
)

private data class NativeListEntry(
  val name: String,
  val entry: NativeEntry,
)

private const val MAXIMUM_NATIVE_BYTES = 1_000_000
private const val MAXIMUM_LIST_ENTRIES = 4_096
private const val EXPECTED_TRANSPORT_PREFIX = "libssh2/1.11.1;openssl/3.5.7"

class BoltPocketSshModule : Module() {
  private val transportDispatcher = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "boltpocket-ssh-transport").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  private val transportScope = CoroutineScope(SupervisorJob() + transportDispatcher)

  override fun definition() = ModuleDefinition {
    Name("BoltPocketSsh")

    // Load and verify the pinned native transport before accepting work. This
    // fails closed if a generated project accidentally packages a stale JNI
    // binary while preserving the public Expo API used on iOS.
    val transportVersion = nativeCall("SSH native transport is unavailable.") {
      decodeUtf8(BoltPocketLibssh2Native.transportVersion())
    }
    if (transportVersion != EXPECTED_TRANSPORT_PREFIX) {
      throw BoltPocketSshException("SSH native transport version is invalid.")
    }

    AsyncFunction("probeHostKey") { host: String, port: Int, timeoutMs: Int ->
      probeHostKey(host, port, timeoutMs)
    }.runOnQueue(transportScope)
    AsyncFunction("connectWithPassword") { options: PasswordConnectionOptions ->
      connectWithPassword(options)
    }.runOnQueue(transportScope)
    AsyncFunction("connectWithKey") { options: KeyConnectionOptions ->
      connectWithKey(options)
    }.runOnQueue(transportScope)
    AsyncFunction("disconnect") { sessionId: String ->
      nativeCall("SSH disconnect failed.") {
        BoltPocketLibssh2Native.disconnect(requiredSessionId(sessionId).utf8())
      }
    }.runOnQueue(transportScope)
    AsyncFunction("disconnectAll") {
      nativeCall("SSH disconnect failed.") { BoltPocketLibssh2Native.disconnectAll() }
    }.runOnQueue(transportScope)
    AsyncFunction("list") { sessionId: String, path: String ->
      list(sessionId, path)
    }.runOnQueue(transportScope)
    AsyncFunction("stat") { sessionId: String, path: String ->
      stat(sessionId, path)
    }.runOnQueue(transportScope)
    AsyncFunction("readText") { sessionId: String, path: String, maxBytes: Int ->
      readText(sessionId, path, maxBytes)
    }.runOnQueue(transportScope)
    AsyncFunction("execute") {
        sessionId: String,
        command: String,
        stdin: String?,
        maxOutputBytes: Int,
        timeoutMs: Int ->
      execute(sessionId, command, stdin, maxOutputBytes, timeoutMs)
    }.runOnQueue(transportScope)
    AsyncFunction("writeText") { sessionId: String, path: String, text: String ->
      val contents = text.utf8()
      if (contents.size > MAXIMUM_NATIVE_BYTES) {
        throw BoltPocketSshException("SSH text resource exceeds the write limit.")
      }
      nativeCall("SFTP write failed.") {
        BoltPocketLibssh2Native.write(
          requiredSessionId(sessionId).utf8(),
          safePath(path).utf8(),
          contents,
        )
      }
    }.runOnQueue(transportScope)
    AsyncFunction("makeDirectory") { sessionId: String, path: String ->
      nativeCall("SFTP directory creation failed.") {
        BoltPocketLibssh2Native.makeDirectory(
          requiredSessionId(sessionId).utf8(),
          safePath(path).utf8(),
        )
      }
    }.runOnQueue(transportScope)
    AsyncFunction("rename") { sessionId: String, from: String, to: String ->
      nativeCall("SFTP rename failed.") {
        BoltPocketLibssh2Native.rename(
          requiredSessionId(sessionId).utf8(),
          safePath(from).utf8(),
          safePath(to).utf8(),
        )
      }
    }.runOnQueue(transportScope)
    AsyncFunction("remove") { sessionId: String, path: String ->
      nativeCall("SFTP remove failed.") {
        BoltPocketLibssh2Native.remove(
          requiredSessionId(sessionId).utf8(),
          safePath(path).utf8(),
        )
      }
    }.runOnQueue(transportScope)
    AsyncFunction("setMode") { sessionId: String, path: String, mode: Int ->
      if (mode !in 0..4_095) throw BoltPocketSshException("Invalid SFTP file mode.")
      nativeCall("SFTP permission update failed.") {
        BoltPocketLibssh2Native.setMode(
          requiredSessionId(sessionId).utf8(),
          safePath(path).utf8(),
          mode,
        )
      }
    }.runOnQueue(transportScope)

    OnDestroy {
      transportScope.cancel()
      runCatching { BoltPocketLibssh2Native.disconnectAll() }
      transportDispatcher.close()
    }
  }

  private fun probeHostKey(host: String, port: Int, timeoutMs: Int): Map<String, String> {
    requireEndpoint(host, port, timeoutMs)
    return nativeCall("Could not obtain the SSH host key.") {
      decodeHostKey(BoltPocketLibssh2Native.probeHostKey(host.utf8(), port, timeoutMs))
    }
  }

  private fun connectWithPassword(options: PasswordConnectionOptions): Map<String, String> {
    requireConnection(
      options.sessionId,
      options.host,
      options.port,
      options.username,
      options.expectedFingerprint,
      options.timeoutMs,
    )
    val password = options.password.utf8()
    if (password.isEmpty() || password.size > 16_384) {
      throw BoltPocketSshException("SSH password is required and must be reasonably sized.")
    }
    return try {
      nativeCall("SSH authentication or host-key verification failed.") {
        decodeHostKey(
          BoltPocketLibssh2Native.connectWithPassword(
            options.sessionId.utf8(),
            options.host.utf8(),
            options.port,
            options.username.utf8(),
            password,
            options.expectedFingerprint.utf8(),
            options.timeoutMs,
          ),
        )
      }
    } finally {
      password.fill(0)
    }
  }

  private fun connectWithKey(options: KeyConnectionOptions): Map<String, String> {
    requireConnection(
      options.sessionId,
      options.host,
      options.port,
      options.username,
      options.expectedFingerprint,
      options.timeoutMs,
    )
    val privateKey = options.privateKey.utf8()
    val publicKey = options.publicKey?.utf8() ?: ByteArray(0)
    val passphrase = options.passphrase?.utf8() ?: ByteArray(0)
    if (privateKey.isEmpty() || privateKey.size > MAXIMUM_NATIVE_BYTES) {
      throw BoltPocketSshException("SSH private key is required and must be reasonably sized.")
    }
    if (publicKey.size > MAXIMUM_NATIVE_BYTES || passphrase.size > 16_384) {
      throw BoltPocketSshException("SSH key material is too large.")
    }
    return try {
      nativeCall("SSH authentication or host-key verification failed.") {
        decodeHostKey(
          BoltPocketLibssh2Native.connectWithKey(
            options.sessionId.utf8(),
            options.host.utf8(),
            options.port,
            options.username.utf8(),
            privateKey,
            publicKey,
            passphrase,
            options.expectedFingerprint.utf8(),
            options.timeoutMs,
          ),
        )
      }
    } finally {
      privateKey.fill(0)
      publicKey.fill(0)
      passphrase.fill(0)
    }
  }

  private fun list(sessionId: String, path: String): List<Map<String, Any>> {
    val safe = safePath(path)
    val payload = nativeCall("Could not read the SFTP directory.") {
      BoltPocketLibssh2Native.list(requiredSessionId(sessionId).utf8(), safe.utf8())
    }
    return decodeList(payload).map { item ->
      val fullPath = if (safe == "/") "/${item.name}" else "${safe.trimEnd('/')}/${item.name}"
      entryResult(fullPath, item.name, item.entry)
    }
  }

  private fun stat(sessionId: String, path: String): Map<String, Any>? {
    val safe = safePath(path)
    val payload = nativeCall("Could not read the SFTP item.") {
      BoltPocketLibssh2Native.stat(requiredSessionId(sessionId).utf8(), safe.utf8())
    } ?: return null
    val name = if (safe == "/") "/" else safe.substringAfterLast('/')
    return entryResult(safe, name, decodeEntry(payload))
  }

  private fun readText(sessionId: String, path: String, maxBytes: Int): String {
    if (maxBytes !in 1..MAXIMUM_NATIVE_BYTES) {
      throw BoltPocketSshException("Invalid SSH read limit.")
    }
    val payload = nativeCall("Could not read the SFTP file within the size limit.") {
      BoltPocketLibssh2Native.read(
        requiredSessionId(sessionId).utf8(),
        safePath(path).utf8(),
        maxBytes,
      )
    }
    if (payload.size > maxBytes) {
      throw BoltPocketSshException("SSH text resource exceeds the read limit.")
    }
    return try {
      decodeUtf8(payload)
    } catch (error: Throwable) {
      throw BoltPocketSshException("The SFTP resource is not valid UTF-8 text.", error)
    }
  }

  private fun execute(
    sessionId: String,
    command: String,
    stdin: String?,
    maxOutputBytes: Int,
    timeoutMs: Int,
  ): Map<String, Any> {
    val commandBytes = command.utf8()
    val stdinBytes = stdin?.utf8() ?: ByteArray(0)
    if (commandBytes.isEmpty() || commandBytes.size > 32_768 || command.contains('\u0000')) {
      throw BoltPocketSshException("SSH command is required and must be at most 32 KiB.")
    }
    if (stdinBytes.size > MAXIMUM_NATIVE_BYTES) {
      throw BoltPocketSshException("SSH command input exceeds the 1 MB limit.")
    }
    if (maxOutputBytes !in 1..MAXIMUM_NATIVE_BYTES) {
      throw BoltPocketSshException("SSH command output limit must be between 1 byte and 1 MB.")
    }
    if (timeoutMs !in 1_000..60_000) {
      throw BoltPocketSshException("SSH command timeout must be between 1 and 60 seconds.")
    }
    return try {
      val payload = nativeCall("SSH command execution failed.") {
        BoltPocketLibssh2Native.execute(
          requiredSessionId(sessionId).utf8(),
          commandBytes,
          stdinBytes,
          maxOutputBytes,
          timeoutMs,
        )
      }
      decodeExec(payload, maxOutputBytes)
    } finally {
      commandBytes.fill(0)
      stdinBytes.fill(0)
    }
  }

  private fun requireConnection(
    sessionId: String,
    host: String,
    port: Int,
    username: String,
    expectedFingerprint: String,
    timeoutMs: Int,
  ) {
    requireEndpoint(host, port, timeoutMs)
    requiredSessionId(sessionId)
    if (username.isBlank() || username.any { it.isWhitespace() } || username.utf8().size > 1_024) {
      throw BoltPocketSshException("SSH username is required and must be reasonably sized.")
    }
    if (!expectedFingerprint.matches(Regex("^SHA256:[A-Za-z0-9+/]{43}$"))) {
      throw BoltPocketSshException("A confirmed SHA-256 host-key fingerprint is required.")
    }
  }

  private fun requireEndpoint(host: String, port: Int, timeoutMs: Int) {
    if (host.isBlank() || host.any { it.isWhitespace() } || host.utf8().size > 1_024 || port !in 1..65_535) {
      throw BoltPocketSshException("Invalid SSH host or port.")
    }
    if (timeoutMs !in 1_000..60_000) {
      throw BoltPocketSshException("SSH timeout must be between 1 and 60 seconds.")
    }
  }

  private fun requiredSessionId(sessionId: String): String {
    if (sessionId.isBlank() || sessionId.any { it.isWhitespace() } || sessionId.utf8().size > 512) {
      throw BoltPocketSshException("SSH session ID is invalid.")
    }
    return sessionId
  }

  private fun safePath(path: String): String {
    if (
      !path.startsWith('/') ||
      path.contains('\u0000') ||
      path.contains('\\') ||
      path.utf8().size > 16_384 ||
      path.split('/').any { it == ".." }
    ) {
      throw BoltPocketSshException("SFTP path must be absolute and cannot traverse directories.")
    }
    return path
  }
}

private inline fun <T> nativeCall(message: String, operation: () -> T): T {
  try {
    return operation()
  } catch (error: Throwable) {
    if (error is BoltPocketSshException) throw error
    throw BoltPocketSshException(message, error)
  }
}

private fun String.utf8(): ByteArray = toByteArray(Charsets.UTF_8)

private fun decodeUtf8(bytes: ByteArray): String =
  Charsets.UTF_8
    .newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes))
    .toString()

private fun decodeHostKey(payload: ByteArray): Map<String, String> {
  val separator = payload.indexOf(0.toByte())
  if (separator !in 1 until payload.lastIndex || payload.size > 256) {
    throw BoltPocketSshException("SSH host key result is invalid.")
  }
  val algorithm = decodeUtf8(payload.copyOfRange(0, separator))
  val fingerprint = decodeUtf8(payload.copyOfRange(separator + 1, payload.size))
  if (
    !algorithm.matches(Regex("^[A-Za-z0-9@._+-]{1,64}$")) ||
    !fingerprint.matches(Regex("^SHA256:[A-Za-z0-9+/]{43}$"))
  ) {
    throw BoltPocketSshException("SSH host key result is unsupported.")
  }
  return mapOf("algorithm" to algorithm, "fingerprint" to fingerprint)
}

private fun decodeList(payload: ByteArray): List<NativeListEntry> {
  val buffer = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
  if (buffer.remaining() < Int.SIZE_BYTES) {
    throw BoltPocketSshException("SFTP directory result is invalid.")
  }
  val count = buffer.int
  if (count !in 0..MAXIMUM_LIST_ENTRIES) {
    throw BoltPocketSshException("SFTP directory result exceeds the entry limit.")
  }
  val entries = ArrayList<NativeListEntry>(count)
  repeat(count) {
    if (buffer.remaining() < Int.SIZE_BYTES) {
      throw BoltPocketSshException("SFTP directory result is truncated.")
    }
    val nameLength = buffer.int
    if (nameLength !in 1..4_096 || buffer.remaining() < nameLength + 13) {
      throw BoltPocketSshException("SFTP directory entry is invalid.")
    }
    val nameBytes = ByteArray(nameLength)
    buffer.get(nameBytes)
    val name = decodeUtf8(nameBytes)
    if (
      name == "." ||
      name == ".." ||
      name.contains('/') ||
      name.contains('\\') ||
      name.contains('\u0000')
    ) {
      throw BoltPocketSshException("SFTP directory returned an unsafe entry name.")
    }
    entries += NativeListEntry(name, decodeEntry(buffer))
  }
  if (buffer.hasRemaining()) {
    throw BoltPocketSshException("SFTP directory result has trailing data.")
  }
  return entries
}

private fun decodeEntry(payload: ByteArray): NativeEntry {
  if (payload.size != 13) throw BoltPocketSshException("SFTP item result is invalid.")
  return decodeEntry(ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN))
}

private fun decodeEntry(buffer: ByteBuffer): NativeEntry {
  if (buffer.remaining() < 13) throw BoltPocketSshException("SFTP item result is truncated.")
  val type = when (buffer.get().toInt()) {
    1 -> "file"
    2 -> "directory"
    3 -> "symlink"
    4 -> "other"
    else -> throw BoltPocketSshException("SFTP item type is invalid.")
  }
  val size = buffer.long
  val mode = buffer.int
  if (size < 0 || mode < 0) throw BoltPocketSshException("SFTP item metadata is invalid.")
  return NativeEntry(type, size, mode)
}

private fun decodeExec(payload: ByteArray, maxOutputBytes: Int): Map<String, Any> {
  val buffer = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
  if (buffer.remaining() < 12) throw BoltPocketSshException("SSH command result is invalid.")
  val exitCode = buffer.int
  val stdoutLength = buffer.int
  val stderrLength = buffer.int
  if (
    stdoutLength < 0 ||
    stderrLength < 0 ||
    stdoutLength.toLong() + stderrLength.toLong() > maxOutputBytes ||
    buffer.remaining() != stdoutLength + stderrLength
  ) {
    throw BoltPocketSshException("SSH command result exceeds its bounds.")
  }
  val stdoutBytes = ByteArray(stdoutLength)
  val stderrBytes = ByteArray(stderrLength)
  buffer.get(stdoutBytes)
  buffer.get(stderrBytes)
  return try {
    mapOf(
      "stdout" to decodeUtf8(stdoutBytes),
      "stderr" to decodeUtf8(stderrBytes),
      "exitCode" to exitCode,
    )
  } catch (error: Throwable) {
    throw BoltPocketSshException("SSH command returned invalid UTF-8 output.", error)
  }
}

private fun entryResult(path: String, name: String, entry: NativeEntry): Map<String, Any> =
  mapOf(
    "path" to path,
    "name" to name,
    "type" to entry.type,
    "size" to entry.size,
    "mode" to entry.mode,
  )
