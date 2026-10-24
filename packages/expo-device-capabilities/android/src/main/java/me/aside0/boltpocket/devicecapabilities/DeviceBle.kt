package dev.boltpocket.app.devicecapabilities

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.SystemClock
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout

private val CLIENT_CHARACTERISTIC_CONFIGURATION =
  UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

internal data class BleRecovery(
  val address: String,
  val serviceUuid: UUID,
  val characteristicUuid: UUID,
  val previousValue: ByteArray,
)

private data class BleDeviceHandle(
  val address: String,
  val expiresAtElapsedMs: Long,
)

private const val BLE_DEVICE_HANDLE_TTL_MS = 10 * 60_000L

internal class DeviceBle(private val context: Context) {
  private val salt = ByteArray(32).also(SecureRandom()::nextBytes)
  private val deviceAddresses = ConcurrentHashMap<String, BleDeviceHandle>()
  private val recoveries = LinkedHashMap<String, BleRecovery>()

  fun status(): Map<String, Any?> {
    val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
    return mapOf(
      "supported" to (adapter != null),
      "enabled" to runCatching { adapter?.isEnabled == true }.getOrDefault(false),
      "lowEnergy" to context.packageManager.hasSystemFeature("android.hardware.bluetooth_le"),
      "capturedAt" to isoNow(),
    )
  }

  @SuppressLint("MissingPermission")
  suspend fun scan(durationMs: Int, maxResults: Int): Map<String, Any?> {
    if (durationMs !in 500..10_000 || maxResults !in 1..64) {
      throw DeviceCapabilityException("Bluetooth scan limits are invalid.")
    }
    val adapter = requiredAdapter()
    val scanner = adapter.bluetoothLeScanner
      ?: throw DeviceCapabilityException("Bluetooth is turned off.")
    discardExpiredDeviceHandles()
    val results = ConcurrentHashMap<String, Map<String, Any?>>()
    val scanFailure = AtomicInteger(0)
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        captureScanResult(result, results)
      }

      override fun onBatchScanResults(batchResults: MutableList<ScanResult>) {
        batchResults.forEach { captureScanResult(it, results) }
      }

      override fun onScanFailed(errorCode: Int) {
        scanFailure.compareAndSet(0, errorCode)
      }
    }
    try {
      scanner.startScan(
        null,
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
        callback,
      )
      delay(durationMs.toLong())
    } finally {
      runCatching { scanner.stopScan(callback) }
    }
    val bounded = results.values
      .sortedByDescending { (it["rssi"] as? Int) ?: Int.MIN_VALUE }
      .take(maxResults)
    if (scanFailure.get() != 0 && bounded.isEmpty()) {
      throw DeviceCapabilityException("Bluetooth scan failed (${scanFailure.get()}).")
    }
    return mapOf(
      "supported" to true,
      "durationMs" to durationMs,
      "devices" to bounded,
      "count" to bounded.size,
      "scanFailureCode" to scanFailure.get().takeIf { it != 0 },
      "capturedAt" to isoNow(),
    )
  }

  @SuppressLint("MissingPermission")
  suspend fun discoverServices(
    deviceId: String,
    timeoutMs: Int,
  ): Map<String, Any?> {
    val client = client(deviceId)
    return try {
      client.connect(timeoutMs)
      val services = client.serviceCatalog()
      mapOf(
        "deviceId" to deviceId,
        "services" to services,
        "serviceCount" to services.size,
        "characteristicCount" to services.sumOf {
          (it["characteristics"] as? List<*>)?.size ?: 0
        },
        "capturedAt" to isoNow(),
      )
    } finally {
      client.close()
    }
  }

  @SuppressLint("MissingPermission")
  suspend fun read(
    deviceId: String,
    serviceUuid: String,
    characteristicUuid: String,
    timeoutMs: Int,
  ): Map<String, Any?> {
    val client = client(deviceId)
    return try {
      client.connect(timeoutMs)
      val value = client.read(uuid(serviceUuid), uuid(characteristicUuid), timeoutMs)
      mapOf(
        "deviceId" to deviceId,
        "valueBase64" to encodeBase64(value),
        "byteLength" to value.size,
        "capturedAt" to isoNow(),
      )
    } finally {
      client.close()
    }
  }

  @SuppressLint("MissingPermission")
  suspend fun subscribe(
    deviceId: String,
    serviceUuid: String,
    characteristicUuid: String,
    durationMs: Int,
  ): Map<String, Any?> {
    if (durationMs !in 500..30_000) {
      throw DeviceCapabilityException("BLE subscription duration is invalid.")
    }
    val client = client(deviceId)
    return try {
      client.connect(minOf(durationMs, 10_000))
      val values = client.subscribe(
        uuid(serviceUuid),
        uuid(characteristicUuid),
        durationMs,
      )
      mapOf(
        "deviceId" to deviceId,
        "values" to values.take(32).map { encodeBase64(it) },
        "count" to minOf(values.size, 32),
        "durationMs" to durationMs,
        "capturedAt" to isoNow(),
      )
    } finally {
      client.close()
    }
  }

  @SuppressLint("MissingPermission")
  suspend fun writeReversible(
    deviceId: String,
    serviceUuid: String,
    characteristicUuid: String,
    valueBase64: String,
    timeoutMs: Int,
  ): Map<String, Any?> {
    val desired = decodeBase64(valueBase64, 512)
    val service = uuid(serviceUuid)
    val characteristic = uuid(characteristicUuid)
    val address = address(deviceId)
    val client = BleGattClient(context, requiredAdapter().getRemoteDevice(address))
    return try {
      client.connect(timeoutMs)
      val previous = client.read(service, characteristic, timeoutMs)
      val beforeHash = sha256(previous)
      val afterHash = sha256(desired)
      val patch = listOf(
        "--- device://ble/$deviceId/$service/$characteristic",
        "+++ device://ble/$deviceId/$service/$characteristic",
        "@@ characteristic value @@",
        "-sha256:$beforeHash",
        "+sha256:$afterHash",
        "",
      ).joinToString("\n")
      val patchHash = sha256(patch.toByteArray())
      val rechecked = client.read(service, characteristic, timeoutMs)
      if (!previous.contentEquals(rechecked)) {
        throw DeviceCapabilityException("BLE target changed before write; no data was written.")
      }
      val recoveryId = "ble-recovery-${UUID.randomUUID()}"
      synchronized(recoveries) {
        while (recoveries.size >= 64) recoveries.remove(recoveries.keys.first())
        recoveries[recoveryId] = BleRecovery(address, service, characteristic, previous.copyOf())
      }
      client.write(service, characteristic, desired, timeoutMs)
      val verified = client.read(service, characteristic, timeoutMs)
      if (!desired.contentEquals(verified)) {
        runCatching { client.write(service, characteristic, previous, timeoutMs) }
        throw DeviceCapabilityException("BLE write verification failed; recovery was attempted.")
      }
      mapOf(
        "deviceId" to deviceId,
        "recoveryId" to recoveryId,
        "patch" to patch,
        "patchHash" to patchHash,
        "beforeSha256" to beforeHash,
        "afterSha256" to afterHash,
        "verified" to true,
        "capturedAt" to isoNow(),
      )
    } finally {
      client.close()
    }
  }

  @SuppressLint("MissingPermission")
  suspend fun recover(recoveryId: String, timeoutMs: Int): Map<String, Any?> {
    val recovery = synchronized(recoveries) { recoveries[recoveryId] }
      ?: throw DeviceCapabilityException("BLE recovery point is unavailable.")
    val client = BleGattClient(context, requiredAdapter().getRemoteDevice(recovery.address))
    return try {
      client.connect(timeoutMs)
      client.write(
        recovery.serviceUuid,
        recovery.characteristicUuid,
        recovery.previousValue,
        timeoutMs,
      )
      val verified = client.read(
        recovery.serviceUuid,
        recovery.characteristicUuid,
        timeoutMs,
      )
      if (!verified.contentEquals(recovery.previousValue)) {
        throw DeviceCapabilityException("BLE recovery verification failed.")
      }
      synchronized(recoveries) { recoveries.remove(recoveryId) }
      mapOf(
        "recoveryId" to recoveryId,
        "recovered" to true,
        "restoredSha256" to sha256(verified),
        "capturedAt" to isoNow(),
      )
    } finally {
      client.close()
    }
  }

  @SuppressLint("MissingPermission")
  private fun captureScanResult(
    result: ScanResult,
    results: ConcurrentHashMap<String, Map<String, Any?>>,
  ) {
    val address = result.device.address ?: return
    val id = opaqueId(address)
    deviceAddresses[id] = BleDeviceHandle(
      address = address,
      expiresAtElapsedMs = SystemClock.elapsedRealtime() + BLE_DEVICE_HANDLE_TTL_MS,
    )
    val record = result.scanRecord
    val serviceUuids = record?.serviceUuids
      ?.mapNotNull { cleanDeviceText(it.uuid.toString().lowercase(), 64) }
      ?.take(24)
      ?: emptyList()
    val manufacturerIds = buildList {
      val data = record?.manufacturerSpecificData
      if (data != null) {
        for (index in 0 until minOf(data.size(), 16)) add(data.keyAt(index))
      }
    }
    results[id] = mapOf(
      "deviceId" to id,
      "name" to cleanDeviceText(record?.deviceName, 120),
      "rssi" to result.rssi,
      "serviceUuids" to serviceUuids,
      "manufacturerIds" to manufacturerIds,
      "connectable" to if (Build.VERSION.SDK_INT >= 26) result.isConnectable else null,
      "deviceIdExpiresInMs" to BLE_DEVICE_HANDLE_TTL_MS,
    )
  }

  private fun opaqueId(address: String): String =
    "ble-${sha256(salt + address.toByteArray()).take(24)}"

  private fun address(deviceId: String): String {
    val handle = deviceAddresses[deviceId]
      ?: throw DeviceCapabilityException("Bluetooth device handle expired; scan again.")
    if (SystemClock.elapsedRealtime() >= handle.expiresAtElapsedMs) {
      deviceAddresses.remove(deviceId, handle)
      throw DeviceCapabilityException("Bluetooth device handle expired; scan again.")
    }
    return handle.address
  }

  private fun discardExpiredDeviceHandles() {
    val now = SystemClock.elapsedRealtime()
    deviceAddresses.entries.removeIf { it.value.expiresAtElapsedMs <= now }
  }

  @SuppressLint("MissingPermission")
  private fun client(deviceId: String) =
    BleGattClient(context, requiredAdapter().getRemoteDevice(address(deviceId)))

  private fun requiredAdapter(): BluetoothAdapter =
    context.getSystemService(BluetoothManager::class.java)?.adapter
      ?: throw DeviceCapabilityException("Bluetooth Low Energy is unavailable.")

  private fun uuid(value: String): UUID = try {
    UUID.fromString(value)
  } catch (error: IllegalArgumentException) {
    throw DeviceCapabilityException("Bluetooth UUID is invalid.", error)
  }
}

@SuppressLint("MissingPermission")
private class BleGattClient(
  private val context: Context,
  private val device: BluetoothDevice,
) {
  private val connected = CompletableDeferred<Unit>()
  private val servicesReady = CompletableDeferred<Unit>()
  private var readResult: CompletableDeferred<ByteArray>? = null
  private var writeResult: CompletableDeferred<Unit>? = null
  private var descriptorResult: CompletableDeferred<Unit>? = null
  private val notifications = mutableListOf<ByteArray>()
  private lateinit var gatt: BluetoothGatt

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
        connected.complete(Unit)
        if (!gatt.discoverServices()) servicesReady.completeExceptionally(
          DeviceCapabilityException("BLE service discovery could not start."),
        )
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED && !connected.isCompleted) {
        connected.completeExceptionally(DeviceCapabilityException("BLE connection failed ($status)."))
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) servicesReady.complete(Unit)
      else servicesReady.completeExceptionally(DeviceCapabilityException("BLE service discovery failed ($status)."))
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      completeRead(status, characteristic.value ?: ByteArray(0))
    }

    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
      status: Int,
    ) {
      completeRead(status, value)
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      val deferred = writeResult ?: return
      if (status == BluetoothGatt.GATT_SUCCESS) deferred.complete(Unit)
      else deferred.completeExceptionally(DeviceCapabilityException("BLE write failed ($status)."))
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      val deferred = descriptorResult ?: return
      if (status == BluetoothGatt.GATT_SUCCESS) deferred.complete(Unit)
      else deferred.completeExceptionally(DeviceCapabilityException("BLE notification setup failed ($status)."))
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      captureNotification(characteristic.value ?: ByteArray(0))
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      captureNotification(value)
    }
  }

  suspend fun connect(timeoutMs: Int) {
    requireTimeout(timeoutMs)
    gatt = if (Build.VERSION.SDK_INT >= 23) {
      device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    } else {
      device.connectGatt(context, false, callback)
    }
    withTimeout(timeoutMs.toLong()) {
      connected.await()
      servicesReady.await()
    }
  }

  suspend fun read(serviceUuid: UUID, characteristicUuid: UUID, timeoutMs: Int): ByteArray {
    val characteristic = characteristic(serviceUuid, characteristicUuid)
    val deferred = CompletableDeferred<ByteArray>()
    readResult = deferred
    if (!gatt.readCharacteristic(characteristic)) {
      readResult = null
      throw DeviceCapabilityException("BLE read could not start.")
    }
    return try {
      withTimeout(timeoutMs.toLong()) { deferred.await() }.also {
        if (it.size > 512) throw DeviceCapabilityException("BLE value exceeds the 512-byte limit.")
      }
    } finally {
      readResult = null
    }
  }

  fun serviceCatalog(): List<Map<String, Any?>> {
    var remainingCharacteristics = 256
    return gatt.services.take(64).map { service ->
      val characteristics = service.characteristics
        .take(remainingCharacteristics)
        .map { characteristic ->
          mapOf(
            "uuid" to characteristic.uuid.toString().lowercase(),
            "properties" to characteristicProperties(characteristic.properties),
            "descriptors" to characteristic.descriptors
              .take(16)
              .map { it.uuid.toString().lowercase() },
          )
        }
      remainingCharacteristics -= characteristics.size
      mapOf(
        "uuid" to service.uuid.toString().lowercase(),
        "type" to if (service.type == BluetoothGattService.SERVICE_TYPE_PRIMARY) {
          "primary"
        } else {
          "secondary"
        },
        "characteristics" to characteristics,
      )
    }
  }

  suspend fun write(
    serviceUuid: UUID,
    characteristicUuid: UUID,
    value: ByteArray,
    timeoutMs: Int,
  ) {
    val characteristic = characteristic(serviceUuid, characteristicUuid)
    val deferred = CompletableDeferred<Unit>()
    writeResult = deferred
    val started = if (Build.VERSION.SDK_INT >= 33) {
      gatt.writeCharacteristic(
        characteristic,
        value,
        BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
      ) == android.bluetooth.BluetoothStatusCodes.SUCCESS
    } else {
      @Suppress("DEPRECATION")
      characteristic.value = value
      @Suppress("DEPRECATION")
      gatt.writeCharacteristic(characteristic)
    }
    if (!started) {
      writeResult = null
      throw DeviceCapabilityException("BLE write could not start.")
    }
    try {
      withTimeout(timeoutMs.toLong()) { deferred.await() }
    } finally {
      writeResult = null
    }
  }

  suspend fun subscribe(
    serviceUuid: UUID,
    characteristicUuid: UUID,
    durationMs: Int,
  ): List<ByteArray> {
    val characteristic = characteristic(serviceUuid, characteristicUuid)
    if (!gatt.setCharacteristicNotification(characteristic, true)) {
      throw DeviceCapabilityException("BLE notifications are unavailable for this characteristic.")
    }
    val descriptor = characteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIGURATION)
      ?: throw DeviceCapabilityException("BLE notification descriptor is unavailable.")
    val deferred = CompletableDeferred<Unit>()
    descriptorResult = deferred
    val value = if (
      characteristic.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
    ) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
    else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    val started = if (Build.VERSION.SDK_INT >= 33) {
      gatt.writeDescriptor(descriptor, value) == android.bluetooth.BluetoothStatusCodes.SUCCESS
    } else {
      @Suppress("DEPRECATION")
      descriptor.value = value
      @Suppress("DEPRECATION")
      gatt.writeDescriptor(descriptor)
    }
    if (!started) throw DeviceCapabilityException("BLE notification setup could not start.")
    try {
      withTimeout(minOf(durationMs, 10_000).toLong()) { deferred.await() }
    } finally {
      descriptorResult = null
    }
    delay(durationMs.toLong())
    gatt.setCharacteristicNotification(characteristic, false)
    return synchronized(notifications) { notifications.map(ByteArray::copyOf) }
  }

  fun close() {
    if (::gatt.isInitialized) {
      runCatching { gatt.disconnect() }
      runCatching { gatt.close() }
    }
  }

  private fun characteristic(serviceUuid: UUID, characteristicUuid: UUID): BluetoothGattCharacteristic =
    gatt.getService(serviceUuid)?.getCharacteristic(characteristicUuid)
      ?: throw DeviceCapabilityException("BLE service or characteristic is unavailable.")

  private fun completeRead(status: Int, value: ByteArray) {
    val deferred = readResult ?: return
    if (deferred.isCompleted) return
    if (status == BluetoothGatt.GATT_SUCCESS) deferred.complete(value.copyOf())
    else deferred.completeExceptionally(DeviceCapabilityException("BLE read failed ($status)."))
  }

  private fun captureNotification(value: ByteArray) {
    if (value.size > 512) return
    synchronized(notifications) {
      if (notifications.size < 32) notifications.add(value.copyOf())
    }
  }

  private fun requireTimeout(timeoutMs: Int) {
    if (timeoutMs !in 500..30_000) throw DeviceCapabilityException("BLE timeout is invalid.")
  }

  private fun characteristicProperties(value: Int): List<String> = buildList {
    if (value and BluetoothGattCharacteristic.PROPERTY_BROADCAST != 0) add("broadcast")
    if (value and BluetoothGattCharacteristic.PROPERTY_READ != 0) add("read")
    if (value and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
      add("writeWithoutResponse")
    }
    if (value and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) add("write")
    if (value and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) add("notify")
    if (value and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) add("indicate")
    if (value and BluetoothGattCharacteristic.PROPERTY_SIGNED_WRITE != 0) add("signedWrite")
    if (value and BluetoothGattCharacteristic.PROPERTY_EXTENDED_PROPS != 0) {
      add("extendedProperties")
    }
  }
}
