package com.deskos.panel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Manages battery and thermal telemetry harvesters.
 * Compatible with Android 11 (Galaxy M01s) through Android 16 (API 36).
 * Safely handles broadcast receiver export flags and sticky battery intents.
 */
class PowerHelper(private val context: Context) {

    @Volatile var batteryPercent: Int = -1
        private set
    @Volatile var isCharging: Boolean = false
        private set
    @Volatile var chargeType: String = "unplugged"
        private set
    @Volatile var voltageMv: Int = 0
        private set
    @Volatile var temperatureCelsius: Float = 0.0f
        private set

    private var isRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent == null || intent.action != Intent.ACTION_BATTERY_CHANGED) return
            parseBatteryIntent(intent)
        }
    }

    private fun parseBatteryIntent(intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        batteryPercent = if (level >= 0 && scale > 0) {
            (level * 100 / scale)
        } else {
            -1
        }

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL

        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        chargeType = when (plugged) {
            BatteryManager.BATTERY_PLUGGED_AC -> "ac"
            BatteryManager.BATTERY_PLUGGED_USB -> "usb"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
            else -> if (isCharging) "charging" else "unplugged"
        }

        val rawVoltage = intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)
        // Voltage unit normalization:
        // 1. Standard Android reports millivolts (e.g. 3700-4450 mV for Li-ion).
        // 2. Non-standard device HALs (e.g. MediaTek or custom ROMs) incorrectly report integer Volts (e.g. 3 or 4) -> convert to mV (*1000).
        // 3. Some devices report microvolts (uV) > 100,000 -> convert to mV (/1000).
        // 4. Any value <= 0 or missing -> -1 (N/A).
        voltageMv = when {
            rawVoltage <= 0 -> -1
            rawVoltage in 1..10 -> rawVoltage * 1000
            rawVoltage > 100_000 -> rawVoltage / 1000
            else -> rawVoltage
        }

        // Android reports temperature in tenths of a degree Celsius (e.g., 325 = 32.5°C)
        val rawTemp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -999)
        temperatureCelsius = if (rawTemp > -400 && rawTemp < 1000) {
            rawTemp / 10.0f
        } else {
            -999.0f
        }
    }

    fun startListening() {
        if (!isRegistered) {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)

            // Step 1: Immediately read current sticky state without requiring a dynamic receiver
            try {
                val stickyIntent = context.registerReceiver(null, filter)
                stickyIntent?.let { parseBatteryIntent(it) }
            } catch (_: Exception) {}

            // Step 2: Register dynamic receiver using ContextCompat.RECEIVER_NOT_EXPORTED
            // Enforces Android 14+ (API 34/35/36) receiver security while safely falling back on API 30
            try {
                val registeredIntent = ContextCompat.registerReceiver(
                    context,
                    receiver,
                    filter,
                    ContextCompat.RECEIVER_NOT_EXPORTED
                )
                registeredIntent?.let { parseBatteryIntent(it) }
                isRegistered = true
            } catch (e: Exception) {
                // Failsafe: if dynamic registration is restricted by device policy, app remains functional via sticky query
                isRegistered = false
            }
        }
    }

    fun stopListening() {
        if (isRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (_: Exception) {}
            isRegistered = false
        }
    }

    fun getStatusJson(): JSONObject {
        val hasValidTemp = temperatureCelsius > -100.0f
        return JSONObject().apply {
            put("percent", batteryPercent)
            put("isCharging", isCharging)
            put("chargeType", chargeType)
            put("voltageMv", voltageMv)
            put("temperatureC", if (hasValidTemp) String.format(java.util.Locale.US, "%.1f", temperatureCelsius) else "N/A")
            put("isOverheating", hasValidTemp && temperatureCelsius >= 40.0f)
            put("isNearLimit", batteryPercent >= 80 && isCharging)
        }
    }
}
