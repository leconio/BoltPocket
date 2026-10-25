package dev.boltpocket.app

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/** Optional acceptance routing via explicit launch extras. Never changes Android's system proxy.
 * Start a fresh app process before using it; Expo FileSystem captures the selector
 * when it creates its first HTTP client. Stop that process after the test.
 */
internal class DownloadRoute {
  private class Selector(val previous: ProxySelector?) : ProxySelector() {
    @Volatile var proxy: Proxy? = null
    override fun select(uri: URI): List<Proxy> =
      proxy?.let { listOf(it) } ?: previous?.select(uri) ?: listOf(Proxy.NO_PROXY)
    override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) {
      previous?.connectFailed(uri, address, error)
    }
  }
  private var selector: Selector? = null
  fun begin(host: String, port: Int, country: String): String {
    require(host.matches(Regex("[A-Za-z0-9.-]{1,253}")) && port in 1..65535)
    require(country.matches(Regex("[A-Z]{2}")))
    val current = selector ?: Selector(ProxySelector.getDefault()).also { selector = it }
    check(current.proxy == null) { "A download route is already active" }
    val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress(host, port))
    current.proxy = proxy
    ProxySelector.setDefault(current)
    try {
      // Explicit proxy on the small probe too; no DIRECT fallback is supplied.
      val connection = URL("https://ipinfo.io/json").openConnection(proxy) as HttpsURLConnection
      connection.connectTimeout = 10000
      connection.readTimeout = 10000
      val info = try {
        check(connection.responseCode == 200) { "Proxy exit probe failed" }
        connection.inputStream.bufferedReader().use { reader ->
          JSONObject(reader.readText())
        }
      } finally { connection.disconnect() }
      check(info.getString("country") == country) { "Unexpected download proxy country" }
      return JSONObject().put("type", "model_download_route")
        .put("proxy_host", host).put("proxy_port", port)
        .put("exit_ip", info.getString("ip")).put("country", country).toString()
    } catch (error: Exception) { end(); throw error }
  }
  fun end() {
    val current = selector ?: return
    current.proxy = null
    if (ProxySelector.getDefault() === current) ProxySelector.setDefault(current.previous)
  }
}
