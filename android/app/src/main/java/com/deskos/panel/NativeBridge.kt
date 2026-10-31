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

    private var previousBrightness: Float = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE

    @JavascriptInterface
    fun setScreenDimmed(dimmed: Boolean) {
        // Sensible subtle dimming level (0.35f = 35% backlight). Interface remains clearly visible.
        setBrightnessLevel(if (dimmed) 0.35f else -1.0f)
    }

    @JavascriptInterface
    fun setBrightnessLevel(fraction: Float) {
        activity.runOnUiThread {
            val win = activity.window
            val layoutParams = win.attributes
            val currentBrightness = layoutParams.screenBrightness

            val targetBrightness = when {
                fraction < 0f -> {
                    val restore = if (previousBrightness >= 0f) previousBrightness else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    previousBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    restore
                }
                else -> {
                    if (previousBrightness < 0f && currentBrightness >= 0f) {
                        previousBrightness = currentBrightness
                    }
                    fraction.coerceIn(0.25f, 1.0f) // Sensible minimum prevents excessive blacking out
                }
            }

            // Smooth transition
            if (targetBrightness >= 0f && currentBrightness >= 0f && Math.abs(targetBrightness - currentBrightness) > 0.05f) {
                val anim = android.animation.ValueAnimator.ofFloat(currentBrightness, targetBrightness).apply {
                    duration = 250L
                    addUpdateListener { va ->
                        layoutParams.screenBrightness = va.animatedValue as Float
                        win.attributes = layoutParams
                    }
                }
                anim.start()
            } else {
                layoutParams.screenBrightness = targetBrightness
                win.attributes = layoutParams
            }
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
    fun getLatestTelemetry(): String {
        return pcAgentManager.getLatestTelemetryJson()
    }

    @JavascriptInterface
    @JvmOverloads
    fun pairAgent(
        hostIp: String?,
        port: Int,
        pairingCode: String?,
        remoteAddress: String? = null,
        connectionMode: String? = "AUTO"
    ): String {
        val safeIp = hostIp?.trim()?.take(64) ?: ""
        val safePort = if (port in 1..65535) port else 8765
        val safePin = pairingCode?.trim()?.take(16) ?: ""
        val cleanRemote = if (!remoteAddress.isNullOrBlank() && !remoteAddress.contains(":")) remoteAddress.trim() else null
        val cleanMode = (connectionMode ?: "AUTO").trim().uppercase()

        if (safeIp.isBlank() || safePin.isBlank()) {
            return JSONObject().apply {
                put("success", false)
                put("message", "Workstation address and 6-digit OTP are required.")
            }.toString()
        }

        val lock = java.util.concurrent.CountDownLatch(1)
        var pairSuccess = false
        var pairMessage = ""

        pcAgentManager.pairDevice(safeIp, safePort, safePin, cleanRemote, cleanMode) { success, msg ->
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
            put("activeRoute", pcAgentManager.activeRoute)
        }.toString()
    }

    @JavascriptInterface
    fun setConnectionMode(mode: String?): Boolean {
        return pcAgentManager.setConnectionMode(mode ?: "AUTO")
    }

    @JavascriptInterface
    fun getConnectionMode(): String {
        return pcAgentManager.getConnectionMode()
    }

    @JavascriptInterface
    fun unpairAgent(): Boolean {
        return pcAgentManager.forgetDevice()
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

    @JavascriptInterface
    fun sendControlAction(action: String?, payloadJson: String?): String {
        val safeAction = action?.trim()?.take(32) ?: ""
        if (safeAction.isBlank()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "Action cannot be empty")
            }.toString()
        }

        val payload = try {
            if (!payloadJson.isNullOrBlank()) JSONObject(payloadJson) else null
        } catch (_: Exception) {
            null
        }

        val sent = pcAgentManager.sendControlAction(safeAction, payload)
        return JSONObject().apply {
            put("success", sent)
            if (!sent) put("error", "Workstation offline or transmission failed")
        }.toString()
    }

    @JavascriptInterface
    fun requestAppsList(): Boolean {
        val msg = JSONObject().apply { put("type", "get_apps") }
        return pcAgentManager.sendWsMessage(msg.toString())
    }

    @JavascriptInterface
    fun requestVolumeState(): Boolean {
        val msg = JSONObject().apply { put("type", "get_volume") }
        return pcAgentManager.sendWsMessage(msg.toString())
    }

    @JavascriptInterface
    fun sendWsJson(jsonStr: String?): Boolean {
        if (jsonStr.isNullOrBlank()) return false
        return pcAgentManager.sendWsMessage(jsonStr)
    }
}
