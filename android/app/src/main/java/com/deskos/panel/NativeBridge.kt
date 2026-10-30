package com.deskos.panel

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Hardened JavaScript Interface exposed to the locally bundled dashboard.
 * Enforces strict input validation and zero access to system secrets or shell execution.
 */
class NativeBridge(
    private val activity: Activity,
    private val powerHelper: PowerHelper,
    private val sensorHelper: SensorHelper,
    private val notificationHelper: NotificationHelper,
    private val pcAgentManager: PcAgentManager
) {

    @JavascriptInterface
    fun getDeviceInfo(): String {
        val json = JSONObject().apply {
            put("appVersion", "1.2.0 (Phase 3 Workstation Linked)")
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("device", Build.DEVICE)
            put("androidVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("battery", powerHelper.getStatusJson())
            put("sensorCapabilities", sensorHelper.getCapabilitiesJson())
            put("hasNotificationPermission", notificationHelper.hasNotificationPermission())
            put("agent", pcAgentManager.getStatusJson())
        }
        return json.toString()
    }

    @JavascriptInterface
    fun getBatteryStatus(): String {
        return powerHelper.getStatusJson().toString()
    }

    @JavascriptInterface
    fun getSensorCapabilities(): String {
        return sensorHelper.getCapabilitiesJson().toString()
    }

    @JavascriptInterface
    fun getLiveSensors(): String {
        return sensorHelper.getLiveReadingsJson().toString()
    }

    @JavascriptInterface
    fun setScreenDimmed(dimmed: Boolean) {
        activity.runOnUiThread {
            val layoutParams = activity.window.attributes
            layoutParams.screenBrightness = if (dimmed) {
                0.05f // Low-power 5% brightness for Idle and Screensaver modes
            } else {
                WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE // Restore user preference
            }
            activity.window.attributes = layoutParams
        }
    }

    @JavascriptInterface
    fun setKeepScreenOn(enabled: Boolean) {
        activity.runOnUiThread {
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    @JavascriptInterface
    fun triggerHaptic(type: String?) {
        val safeType = type?.trim()?.lowercase() ?: "click"
        if (safeType.length > 20) return // Length bound rejection

        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        } ?: return

        if (!vibrator.hasVibrator()) return

        val durationMs: Long = when (safeType) {
            "click" -> 20L
            "warning" -> 150L
            "pulse" -> 50L
            "alarm" -> 300L
            else -> 20L
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(durationMs)
        }
    }

    @JavascriptInterface
    fun showNotification(title: String?, message: String?): Boolean {
        val safeTitle = title?.take(100) ?: "DESK OS Reminder"
        val safeMsg = message?.take(250) ?: "Scheduled alert"
        return notificationHelper.sendNotification(safeTitle, safeMsg)
    }

    @JavascriptInterface
    fun checkNotificationPermission(): Boolean {
        return notificationHelper.hasNotificationPermission()
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
        activity.runOnUiThread {
            notificationHelper.requestNotificationPermission(activity)
        }
    }

    @JavascriptInterface
    fun getAgentStatus(): String {
        return pcAgentManager.getStatusJson().toString()
    }

    @JavascriptInterface
    fun pairAgent(hostIp: String?, port: Int, pairingCode: String?, fingerprint: String?): String {
        val safeIp = hostIp?.trim()?.take(64) ?: ""
        val safePort = if (port in 1..65535) port else 8765
        val safePin = pairingCode?.trim()?.take(16) ?: ""
        val safeFp = fingerprint?.trim()?.take(128) ?: ""

        if (safeIp.isBlank() || safePin.isBlank() || safeFp.isBlank()) {
            return JSONObject().apply {
                put("success", false)
                put("message", "IP, PIN, and TLS Fingerprint are required.")
            }.toString()
        }

        val lock = java.util.concurrent.CountDownLatch(1)
        var pairSuccess = false
        var pairMessage = ""

        pcAgentManager.pairDevice(safeIp, safePort, safePin, safeFp) { success, msg ->
            pairSuccess = success
            pairMessage = msg
            lock.countDown()
        }

        try {
            lock.await(8, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: Exception) {
            pairMessage = "Pairing request timed out."
        }

        return JSONObject().apply {
            put("success", pairSuccess)
            put("message", pairMessage)
            put("state", pcAgentManager.connectionState)
        }.toString()
    }

    @JavascriptInterface
    fun connectAgent(): Boolean {
        pcAgentManager.connect()
        return true
    }

    @JavascriptInterface
    fun disconnectAgent(): Boolean {
        pcAgentManager.disconnect()
        return true
    }

    @JavascriptInterface
    fun forgetAgentDevice(): Boolean {
        return pcAgentManager.forgetDevice()
    }
}
