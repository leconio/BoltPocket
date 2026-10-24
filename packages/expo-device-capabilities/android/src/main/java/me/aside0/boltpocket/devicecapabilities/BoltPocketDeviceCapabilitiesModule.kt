package dev.boltpocket.app.devicecapabilities

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import java.security.SecureRandom
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeoutOrNull

class BoltPocketDeviceCapabilitiesModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val operations = ConcurrentHashMap<String, Job>()
  private val wifiSalt = ByteArray(32).also(SecureRandom()::nextBytes)
  private var ble: DeviceBle? = null

  override fun definition() = ModuleDefinition {
    Name("BoltPocketDeviceCapabilities")

    AsyncFunction("getDeviceStatus") { deviceStatus(context()) }.runOnQueue(scope)
    AsyncFunction("getPowerStatus") { powerStatus(context()) }.runOnQueue(scope)
    AsyncFunction("getStorageStatus") { storageStatus(context()) }.runOnQueue(scope)
    AsyncFunction("getNetworkStatus") { networkStatus(context()) }.runOnQueue(scope)
    AsyncFunction("getWifiStatus") { wifiStatus(context()) }.runOnQueue(scope)
    (AsyncFunction("scanWifi") Coroutine { operationId: String, timeoutMs: Int, maxResults: Int ->
      tracked(operationId) { scanWifi(context(), timeoutMs, maxResults) }
    }).runOnQueue(scope)
    AsyncFunction("getBluetoothStatus") { deviceBle().status() }.runOnQueue(scope)
    (AsyncFunction("scanBluetooth") Coroutine { operationId: String, durationMs: Int, maxResults: Int ->
      tracked(operationId) { deviceBle().scan(durationMs, maxResults) }
    }).runOnQueue(scope)
    (AsyncFunction("discoverBluetoothServices") Coroutine {
        operationId: String,
        deviceId: String,
        timeoutMs: Int ->
      tracked(operationId) {
        deviceBle().discoverServices(deviceId, timeoutMs)
      }
    }).runOnQueue(scope)
    (AsyncFunction("bleRead") Coroutine {
        operationId: String,
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        timeoutMs: Int ->
      tracked(operationId) {
        deviceBle().read(deviceId, serviceUuid, characteristicUuid, timeoutMs)
      }
    }).runOnQueue(scope)
    (AsyncFunction("bleSubscribe") Coroutine {
        operationId: String,
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        durationMs: Int ->
      tracked(operationId) {
        deviceBle().subscribe(deviceId, serviceUuid, characteristicUuid, durationMs)
      }
    }).runOnQueue(scope)
    (AsyncFunction("bleWriteReversible") Coroutine {
        operationId: String,
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        valueBase64: String,
        timeoutMs: Int ->
      tracked(operationId) {
        deviceBle().writeReversible(
          deviceId,
          serviceUuid,
          characteristicUuid,
          valueBase64,
          timeoutMs,
        )
      }
    }).runOnQueue(scope)
    (AsyncFunction("bleRecover") Coroutine { operationId: String, recoveryId: String, timeoutMs: Int ->
      tracked(operationId) { deviceBle().recover(recoveryId, timeoutMs) }
    }).runOnQueue(scope)
    (AsyncFunction("httpRequest") Coroutine {
        operationId: String,
        url: String,
        method: String,
        bodyBase64: String?,
        maxResponseBytes: Int,
        timeoutMs: Int ->
      tracked(operationId) {
        runInterruptible {
          httpRequest(url, method, bodyBase64, maxResponseBytes, timeoutMs)
        }
      }
    }).runOnQueue(scope)
    (AsyncFunction("tcpExchange") Coroutine {
        operationId: String,
        host: String,
        port: Int,
        requestBase64: String,
        maxResponseBytes: Int,
        timeoutMs: Int ->
      tracked(operationId) {
        runInterruptible {
          tcpExchange(host, port, requestBase64, maxResponseBytes, timeoutMs)
        }
      }
    }).runOnQueue(scope)
    (AsyncFunction("udpExchange") Coroutine {
        operationId: String,
        host: String,
        port: Int,
        requestBase64: String,
        maxResponseBytes: Int,
        timeoutMs: Int ->
      tracked(operationId) {
        runInterruptible {
          udpExchange(host, port, requestBase64, maxResponseBytes, timeoutMs)
        }
      }
    }).runOnQueue(scope)
    AsyncFunction("cancel") { operationId: String ->
      operations.remove(requiredOperationId(operationId))?.cancel()
    }.runOnQueue(scope)

    OnDestroy {
      operations.values.forEach(Job::cancel)
      operations.clear()
      scope.cancel()
    }
  }

  private fun context(): Context = appContextRequired(appContext.reactContext?.applicationContext)

  private fun deviceBle(): DeviceBle = ble ?: DeviceBle(context()).also { ble = it }

  private suspend fun <T> tracked(operationId: String, block: suspend () -> T): T {
    val id = requiredOperationId(operationId)
    val job = currentCoroutineContext()[Job]
      ?: throw DeviceCapabilityException("Native operation has no cancellation context.")
    if (operations.putIfAbsent(id, job) != null) {
      throw DeviceCapabilityException("Device operation ID is already active.")
    }
    return try {
      block()
    } finally {
      operations.remove(id, job)
    }
  }

  private fun requiredOperationId(value: String): String {
    if (!Regex("^[A-Za-z0-9._:-]{1,160}$").matches(value)) {
      throw DeviceCapabilityException("Device operation ID is invalid.")
    }
    return value
  }

  private fun deviceStatus(context: Context): Map<String, Any?> {
    val packageInfo = runCatching {
      context.packageManager.getPackageInfo(context.packageName, 0)
    }.getOrNull()
    val orientation = when (context.resources.configuration.orientation) {
      Configuration.ORIENTATION_LANDSCAPE -> "landscape"
      Configuration.ORIENTATION_PORTRAIT -> "portrait"
      else -> "unknown"
    }
    return mapOf(
      "platform" to "android",
      "manufacturer" to cleanDeviceText(Build.MANUFACTURER, 80),
      "model" to cleanDeviceText(Build.MODEL, 120),
      "systemVersion" to Build.VERSION.RELEASE,
      "apiLevel" to Build.VERSION.SDK_INT,
      "appVersion" to packageInfo?.versionName,
      "locale" to Locale.getDefault().toLanguageTag(),
      "timeZone" to TimeZone.getDefault().id,
      "orientation" to orientation,
      "features" to mapOf(
        "wifi" to context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI),
        "bluetoothLowEnergy" to context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE),
        "gps" to context.packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS),
        "nfc" to context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC),
      ),
      "capturedAt" to isoNow(),
    )
  }

  private fun powerStatus(context: Context): Map<String, Any?> {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val power = context.getSystemService(PowerManager::class.java)
    val thermal = if (Build.VERSION.SDK_INT >= 29) when (power?.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE -> "nominal"
      PowerManager.THERMAL_STATUS_LIGHT -> "light"
      PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
      PowerManager.THERMAL_STATUS_SEVERE -> "severe"
      PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
      PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
      PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
      else -> "unknown"
    } else "unavailable"
    return mapOf(
      "batteryLevel" to if (level >= 0 && scale > 0) level.toDouble() / scale else null,
      "batteryState" to when (status) {
        BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
        BatteryManager.BATTERY_STATUS_FULL -> "full"
        BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
        BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not-charging"
        else -> "unknown"
      },
      "powerSaveMode" to (power?.isPowerSaveMode ?: false),
      "thermalState" to thermal,
      "capturedAt" to isoNow(),
    )
  }

  private fun storageStatus(context: Context): Map<String, Any?> {
    val stats = StatFs(context.filesDir.absolutePath)
    val activity = context.getSystemService(ActivityManager::class.java)
    val memory = ActivityManager.MemoryInfo().also { activity?.getMemoryInfo(it) }
    return mapOf(
      "totalBytes" to stats.totalBytes,
      "availableBytes" to stats.availableBytes,
      "memoryTotalBytes" to memory.totalMem,
      "memoryAvailableBytes" to memory.availMem,
      "lowMemory" to memory.lowMemory,
      "capturedAt" to isoNow(),
    )
  }

  @SuppressLint("MissingPermission")
  private fun wifiStatus(context: Context): Map<String, Any?> {
    val manager = context.applicationContext.getSystemService(WifiManager::class.java)
      ?: return mapOf("supported" to false, "capturedAt" to isoNow())
    val info = runCatching { manager.connectionInfo }.getOrNull()
    val ssid = cleanSsid(info?.ssid)
    return mapOf(
      "supported" to true,
      "enabled" to manager.isWifiEnabled,
      "connected" to (ssid != null),
      "ssid" to ssid,
      "rssi" to info?.rssi?.takeUnless { it == -127 },
      "frequencyMHz" to info?.frequency?.takeIf { it > 0 },
      "linkSpeedMbps" to info?.linkSpeed?.takeIf { it >= 0 },
      "capturedAt" to isoNow(),
    )
  }

  @SuppressLint("MissingPermission")
  private suspend fun scanWifi(
    context: Context,
    timeoutMs: Int,
    maxResults: Int,
  ): Map<String, Any?> {
    if (timeoutMs !in 500..15_000 || maxResults !in 1..64) {
      throw DeviceCapabilityException("Wi-Fi scan limits are invalid.")
    }
    val manager = context.applicationContext.getSystemService(WifiManager::class.java)
      ?: throw DeviceCapabilityException("Wi-Fi hardware is unavailable.")
    if (!manager.isWifiEnabled) throw DeviceCapabilityException("Wi-Fi is turned off.")
    val completion = CompletableDeferred<Boolean>()
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (!completion.isCompleted) {
          completion.complete(
            intent?.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false) == true,
          )
        }
      }
    }
    var registered = false
    val started: Boolean
    val fresh: Boolean
    try {
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(
          receiver,
          IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
          Context.RECEIVER_NOT_EXPORTED,
        )
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
      }
      registered = true
      @Suppress("DEPRECATION")
      started = manager.startScan()
      fresh = if (started) withTimeoutOrNull(timeoutMs.toLong()) { completion.await() } ?: false
      else false
    } finally {
      if (registered) runCatching { context.unregisterReceiver(receiver) }
    }
    val nowElapsedMicros = SystemClock.elapsedRealtime() * 1_000L
    val nowWall = System.currentTimeMillis()
    val results = manager.scanResults
      .asSequence()
      .filter { cleanSsid(it.SSID) != null }
      .distinctBy(ScanResult::BSSID)
      .sortedByDescending(ScanResult::level)
      .take(maxResults)
      .map { result ->
        val ageMs = ((nowElapsedMicros - result.timestamp) / 1_000L).coerceAtLeast(0)
        mapOf(
          "networkId" to "wifi-${sha256(wifiSalt + result.BSSID.toByteArray()).take(24)}",
          "ssid" to cleanSsid(result.SSID),
          "rssi" to result.level,
          "frequencyMHz" to result.frequency,
          "security" to cleanDeviceText(result.capabilities, 160),
          "capturedAtEpochMs" to (nowWall - ageMs).coerceAtLeast(0),
        )
      }
      .toList()
    return mapOf(
      "supported" to true,
      "fresh" to fresh,
      "scanStarted" to started,
      "possiblyThrottled" to (!started || !fresh),
      "networks" to results,
      "count" to results.size,
      "capturedAt" to isoNow(),
    )
  }

  private fun cleanSsid(value: String?): String? {
    val cleaned = cleanDeviceText(value?.removeSurrounding("\""), 64)
    return cleaned?.takeUnless { it.equals("<unknown ssid>", ignoreCase = true) }
  }
}
