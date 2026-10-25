package dev.boltpocket.app

import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Uses internal app storage, shared with Expo FileSystem's document directory. */
internal class ModelArtifacts(private val root: File) {
  private data class Spec(val key: String, val bytes: Long, val sha: String)
  private fun spec(raw: String): Spec {
    val value = JSONObject(raw)
    val key = value.getString("key")
    val sha = value.getString("sha256")
    val bytes = value.getLong("bytes")
    require(key.matches(Regex("[a-z0-9-]{1,64}")) && sha.matches(Regex("[a-f0-9]{64}")) && bytes > 0)
    return Spec(key, bytes, sha)
  }
  private fun file(spec: Spec, suffix: String = ""): File =
    File(root, "${spec.key}-${spec.sha}.gguf$suffix")
  @Synchronized fun info(raw: String): Map<String, Any> {
    root.mkdirs()
    val spec = spec(raw)
    return mapOf("ready" to ready(spec), "partialUri" to file(spec, ".part").toURI().toString(),
      "freeBytes" to root.usableSpace)
  }
  private fun ready(spec: Spec): Boolean = file(spec).isFile && file(spec).length() == spec.bytes &&
    file(spec, ".verified").readTextOrNull() == "${spec.sha}:${spec.bytes}"
  private fun File.readTextOrNull(): String? = try { readText() } catch (_: Exception) { null }
  @Synchronized fun commit(raw: String) {
    root.mkdirs()
    val spec = spec(raw)
    val part = file(spec, ".part")
    require(part.length() == spec.bytes) { "Model length mismatch" }
    val digest = MessageDigest.getInstance("SHA-256")
    part.inputStream().buffered(1024 * 1024).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
    }
    require(digest.digest().joinToString("") { "%02x".format(it) } == spec.sha) { "Model checksum mismatch" }
    check(part.renameTo(file(spec))) { "Could not finish model download" }
    file(spec, ".verified.tmp").writeText("${spec.sha}:${spec.bytes}")
    check(file(spec, ".verified.tmp").renameTo(file(spec, ".verified")))
  }
  @Synchronized fun verifiedPath(raw: String): String {
    val spec = spec(raw)
    check(ready(spec)) { "Download and verify this model in Settings > Models first." }
    return file(spec).absolutePath
  }
}
