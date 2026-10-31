package com.deskos.panel

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Manages low-power Bluetooth LE discovery for Cyber Radar 2.0.
 * Guarantees zero crashes if Bluetooth hardware is missing, disabled, or unauthorized.
 * Enforces a strict 25-second auto-stop to protect Galaxy M01s battery.
 */
class BluetoothRadarHelper(private val context: Context) {

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private val mainHandler = Handler(Looper.getMainLooper())

    data class DiscoveredBleDevice(
        val address: String,
        val name: String,
        var rssi: Int,
        var lastSeenMs: Long,
        val category: String
    )

    private val devices = ConcurrentHashMap<String, DiscoveredBleDevice>()
    @Volatile var isScanning = false
        private set

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.let { handleScanResult(it) }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { handleScanResult(it) }
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
        }
    }

    @SuppressLint("MissingPermission")
    private fun handleScanResult(result: ScanResult) {
        val device = result.device ?: return
        val addr = device.address ?: return
        val name = try {
            result.scanRecord?.deviceName ?: device.name ?: "BLE Beacon / Peripheral"
        } catch (_: Exception) {
            "BLE Peripheral"
        }

        val rssi = result.rssi
        val category = determineCategory(name, device.bluetoothClass?.majorDeviceClass)

        devices[addr] = DiscoveredBleDevice(
            address = addr,
            name = name,
            rssi = rssi,
            lastSeenMs = System.currentTimeMillis(),
            category = category
        )
    }

    private fun determineCategory(name: String, majorClass: Int?): String {
        val low = name.lowercase()
        return when {
            low.contains("watch") || low.contains("band") || low.contains("fit") -> "wearable"
            low.contains("bud") || low.contains("airpod") || low.contains("headset") || low.contains("speaker") || low.contains("audio") -> "audio"
            low.contains("phone") || low.contains("galaxy") || low.contains("iphone") || low.contains("pixel") -> "phone"
            low.contains("pc") || low.contains("laptop") || low.contains("book") || low.contains("desktop") -> "computer"
            majorClass == 0x0400 -> "audio"
            majorClass == 0x0200 -> "phone"
            majorClass == 0x0100 -> "computer"
            majorClass == 0x0700 -> "wearable"
            else -> "peripheral"
        }
    }

    fun hasScanPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
        }
    }

    @SuppressLint("MissingPermission")
    fun startScan(): Boolean {
        if (isScanning) return true
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) return false
        if (!hasScanPermission()) return false

        val scanner = bluetoothAdapter.bluetoothLeScanner ?: return false
        devices.clear()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .build()

        return try {
            scanner.startScan(null, settings, scanCallback)
            isScanning = true

            // Enforce automatic scan timeout to conserve battery
            mainHandler.postDelayed({
                stopScan()
            }, 25000L)
            true
        } catch (_: Exception) {
            isScanning = false
            false
        }
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        if (!isScanning) return
        isScanning = false
        try {
            bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (_: Exception) {}
    }

    fun getDiscoveredDevicesJson(): JSONArray {
        val array = JSONArray()
        val now = System.currentTimeMillis()

        devices.values.sortedByDescending { it.rssi }.forEach { dev ->
            val proximity = when {
                dev.rssi >= -60 -> "IMMEDIATE"
                dev.rssi >= -75 -> "NEAR"
                else -> "FAR"
            }
            array.put(JSONObject().apply {
                put("address", dev.address)
                put("name", dev.name)
                put("rssi", dev.rssi)
                put("proximity", proximity)
                put("category", dev.category)
                put("ageMs", now - dev.lastSeenMs)
            })
        }
        return array
    }
}

