package dev.boltpocket.app.devicecapabilities

import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import java.net.InetAddress
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal class DeviceCapabilityException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

internal fun isoNow(): String = SimpleDateFormat(
  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
  Locale.US,
).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

internal fun cleanDeviceText(value: String?, maxLength: Int = 160): String? {
  val cleaned = value
    ?.replace(Regex("[\\u0000-\\u001f\\u007f]"), " ")
    ?.trim()
    ?.take(maxLength)
  return cleaned?.takeIf { it.isNotEmpty() }
}

internal fun sha256(value: ByteArray): String = MessageDigest
  .getInstance("SHA-256")
  .digest(value)
  .joinToString("") { byte -> "%02x".format(byte) }

internal fun decodeBase64(value: String, maxBytes: Int): ByteArray {
  if (value.length > maxBytes * 2) throw DeviceCapabilityException("Device Profile payload is too large.")
  val decoded = try {
    if (Build.VERSION.SDK_INT >= 26) Base64.getDecoder().decode(value)
    else android.util.Base64.decode(value, android.util.Base64.DEFAULT)
  } catch (error: IllegalArgumentException) {
    throw DeviceCapabilityException("Device Profile payload is not valid base64.", error)
  }
  if (decoded.size > maxBytes) throw DeviceCapabilityException("Device Profile payload is too large.")
  return decoded
}

internal fun encodeBase64(value: ByteArray): String =
  if (Build.VERSION.SDK_INT >= 26) Base64.getEncoder().encodeToString(value)
  else android.util.Base64.encodeToString(value, android.util.Base64.NO_WRAP)

internal fun requireLocalEndpoint(host: String, port: Int): Array<InetAddress> {
  val normalized = host.trim()
  if (
    normalized.isEmpty() ||
    normalized.length > 253 ||
    normalized.any { it.code < 0x20 || it.code == 0x7f } ||
    port !in 1..65_535
  ) {
    throw DeviceCapabilityException("Device Profile endpoint is invalid.")
  }
  val addresses = try {
    InetAddress.getAllByName(normalized)
  } catch (error: Exception) {
    throw DeviceCapabilityException("Device Profile endpoint could not be resolved.", error)
  }
  if (addresses.isEmpty() || addresses.any { !isLocalAddress(it) }) {
    throw DeviceCapabilityException("Device Profile endpoints must resolve only to local addresses.")
  }
  return addresses
}

private fun isLocalAddress(address: InetAddress): Boolean {
  if (
    address.isAnyLocalAddress ||
    address.isLoopbackAddress ||
    address.isLinkLocalAddress ||
    address.isSiteLocalAddress
  ) return true
  val bytes = address.address
  return bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
}

internal fun appContextRequired(context: Context?): Context =
  context ?: throw DeviceCapabilityException("Android application context is unavailable.")
