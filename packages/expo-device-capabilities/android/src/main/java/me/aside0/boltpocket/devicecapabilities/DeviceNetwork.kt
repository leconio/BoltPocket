package dev.boltpocket.app.devicecapabilities

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL

internal fun networkStatus(context: Context): Map<String, Any?> {
  val manager = context.getSystemService(ConnectivityManager::class.java)
  val network = manager?.activeNetwork
  val capabilities = network?.let(manager::getNetworkCapabilities)
  val transports = buildList {
    if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) add("wifi")
    if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true) add("cellular")
    if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true) add("ethernet")
    if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) == true) add("bluetooth")
    if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true) add("vpn")
  }
  return mapOf(
    "connected" to (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true),
    "validated" to (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true),
    "metered" to (manager?.isActiveNetworkMetered ?: false),
    "transports" to transports,
    "vpn" to transports.contains("vpn"),
    "capturedAt" to isoNow(),
  )
}

internal fun httpRequest(
  urlValue: String,
  method: String,
  bodyBase64: String?,
  maxResponseBytes: Int,
  timeoutMs: Int,
): Map<String, Any?> {
  if (method !in setOf("GET", "HEAD") || bodyBase64 != null) {
    throw DeviceCapabilityException("Only read-only GET and HEAD local-device requests are allowed.")
  }
  requireNetworkBounds(maxResponseBytes, timeoutMs)
  val url = try { URL(urlValue) } catch (error: Exception) {
    throw DeviceCapabilityException("Local-device URL is invalid.", error)
  }
  if (url.protocol !in setOf("http", "https") || url.userInfo != null) {
    throw DeviceCapabilityException("Local-device URL must be HTTP(S) without credentials.")
  }
  val port = if (url.port > 0) url.port else url.defaultPort
  val address = requireLocalEndpoint(url.host, port).first()
  if (
    url.protocol == "https" &&
    address.hostAddress?.equals(url.host, ignoreCase = true) != true
  ) {
    throw DeviceCapabilityException(
      "HTTPS local-device endpoints must use a local IP literal so the validated address stays pinned.",
    )
  }
  // Connect to the exact address that passed the local-only check. Reusing the
  // hostname here would permit a second DNS answer to redirect the request.
  val pinnedUrl = URL(url.protocol, address.hostAddress, port, url.file)
  val connection = (pinnedUrl.openConnection() as HttpURLConnection).apply {
    requestMethod = method
    connectTimeout = timeoutMs
    readTimeout = timeoutMs
    instanceFollowRedirects = false
    useCaches = false
    setRequestProperty("Accept", "application/json, text/plain, application/octet-stream")
    setRequestProperty("User-Agent", "BoltPocket-Device/1")
    setRequestProperty("Host", if (url.port > 0) "${url.host}:${url.port}" else url.host)
  }
  return try {
    val status = connection.responseCode
    val stream = if (status >= 400) connection.errorStream else connection.inputStream
    val response = if (method == "HEAD" || stream == null) BoundedBytes(ByteArray(0), false)
    else stream.use { readBounded(it.readBytesBounded(maxResponseBytes), maxResponseBytes) }
    mapOf(
      "transport" to "http",
      "status" to status,
      "contentType" to cleanDeviceText(connection.contentType, 120),
      "bodyBase64" to encodeBase64(response.bytes),
      "byteLength" to response.bytes.size,
      "truncated" to response.truncated,
      "capturedAt" to isoNow(),
    )
  } finally {
    connection.disconnect()
  }
}

internal fun tcpExchange(
  host: String,
  port: Int,
  requestBase64: String,
  maxResponseBytes: Int,
  timeoutMs: Int,
): Map<String, Any?> {
  requireNetworkBounds(maxResponseBytes, timeoutMs)
  val address = requireLocalEndpoint(host, port).first()
  val request = decodeBase64(requestBase64, 65_536)
  val socket = Socket()
  return try {
    socket.soTimeout = timeoutMs
    socket.connect(InetSocketAddress(address, port), timeoutMs)
    socket.getOutputStream().let { output ->
      output.write(request)
      output.flush()
    }
    socket.shutdownOutput()
    val response = try {
      socket.getInputStream().use { readBounded(it.readBytesBounded(maxResponseBytes), maxResponseBytes) }
    } catch (error: SocketTimeoutException) {
      throw DeviceCapabilityException("TCP local-device request timed out.", error)
    }
    mapOf(
      "transport" to "tcp",
      "bodyBase64" to encodeBase64(response.bytes),
      "byteLength" to response.bytes.size,
      "truncated" to response.truncated,
      "capturedAt" to isoNow(),
    )
  } finally {
    runCatching { socket.close() }
  }
}

internal fun udpExchange(
  host: String,
  port: Int,
  requestBase64: String,
  maxResponseBytes: Int,
  timeoutMs: Int,
): Map<String, Any?> {
  requireNetworkBounds(maxResponseBytes, timeoutMs)
  val address = requireLocalEndpoint(host, port).first()
  val request = decodeBase64(requestBase64, 65_507)
  val socket = DatagramSocket()
  return try {
    socket.soTimeout = timeoutMs
    socket.connect(address, port)
    socket.send(DatagramPacket(request, request.size))
    val response = ByteArray(maxResponseBytes + 1)
    val packet = DatagramPacket(response, response.size)
    socket.receive(packet)
    val truncated = packet.length > maxResponseBytes
    val bounded = response.copyOf(minOf(packet.length, maxResponseBytes))
    mapOf(
      "transport" to "udp",
      "bodyBase64" to encodeBase64(bounded),
      "byteLength" to bounded.size,
      "truncated" to truncated,
      "capturedAt" to isoNow(),
    )
  } finally {
    socket.close()
  }
}

private data class BoundedBytes(val bytes: ByteArray, val truncated: Boolean)

private fun requireNetworkBounds(maxResponseBytes: Int, timeoutMs: Int) {
  if (maxResponseBytes !in 1..262_144 || timeoutMs !in 250..30_000) {
    throw DeviceCapabilityException("Local-device network limits are invalid.")
  }
}

private fun java.io.InputStream.readBytesBounded(maxBytes: Int): ByteArray {
  val output = ByteArrayOutputStream(minOf(maxBytes + 1, 16_384))
  val buffer = ByteArray(8_192)
  while (output.size() <= maxBytes) {
    val read = read(buffer, 0, minOf(buffer.size, maxBytes + 1 - output.size()))
    if (read < 0) break
    output.write(buffer, 0, read)
  }
  return output.toByteArray()
}

private fun readBounded(value: ByteArray, maxBytes: Int): BoundedBytes =
  BoundedBytes(value.copyOf(minOf(value.size, maxBytes)), value.size > maxBytes)
