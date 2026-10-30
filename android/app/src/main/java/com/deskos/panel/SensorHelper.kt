package com.deskos.panel

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Dynamically queries available hardware sensors on the device.
 * Guarantees zero crashes if gyroscope, magnetometer, or ambient light sensors are absent.
 */
class SensorHelper(context: Context) : SensorEventListener {

    private val sensorManager: SensorManager? =
        context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

    val hasAccelerometer: Boolean
    val hasGyroscope: Boolean
    val hasMagnetometer: Boolean
    val hasLightSensor: Boolean
    val hasProximity: Boolean

    private val accelerometer: Sensor?

    @Volatile var accelX: Float = 0.0f
    @Volatile var accelY: Float = 0.0f
    @Volatile var accelZ: Float = 0.0f
    @Volatile var vibrationMagnitude: Float = 0.0f

    private var isListening = false

    init {
        val allSensors = sensorManager?.getSensorList(Sensor.TYPE_ALL)?.map { it.type }?.toSet() ?: emptySet()

        hasAccelerometer = allSensors.contains(Sensor.TYPE_ACCELEROMETER)
        hasGyroscope = allSensors.contains(Sensor.TYPE_GYROSCOPE)
        hasMagnetometer = allSensors.contains(Sensor.TYPE_MAGNETIC_FIELD)
        hasLightSensor = allSensors.contains(Sensor.TYPE_LIGHT)
        hasProximity = allSensors.contains(Sensor.TYPE_PROXIMITY)

        accelerometer = if (hasAccelerometer) {
            sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        } else {
            null
        }
    }

    fun startListening() {
        if (!isListening && accelerometer != null && sensorManager != null) {
            try {
                sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI)
                isListening = true
            } catch (_: Exception) {}
        }
    }

    fun stopListening() {
        if (isListening && sensorManager != null) {
            try {
                sensorManager.unregisterListener(this)
            } catch (_: Exception) {}
            isListening = false
        }
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null) return
        if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
            accelX = event.values[0]
            accelY = event.values[1]
            accelZ = event.values[2]

            // Calculate total acceleration minus Earth gravity (9.81 m/s^2) for vibration spike tracking
            val totalG = sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ)
            vibrationMagnitude = abs(totalG - 9.81f)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    fun getCapabilitiesJson(): JSONObject {
        val sensorsArray = JSONArray().apply {
            put(JSONObject().apply {
                put("name", "Accelerometer")
                put("available", hasAccelerometer)
                put("type", "3-axis motion")
            })
            put(JSONObject().apply {
                put("name", "Gyroscope")
                put("available", hasGyroscope)
                put("type", "angular velocity")
            })
            put(JSONObject().apply {
                put("name", "Magnetometer")
                put("available", hasMagnetometer)
                put("type", "compass heading")
            })
            put(JSONObject().apply {
                put("name", "Light Sensor")
                put("available", hasLightSensor)
                put("type", "ambient lux")
            })
            put(JSONObject().apply {
                put("name", "Proximity")
                put("available", hasProximity)
                put("type", "distance flag")
            })
        }

        return JSONObject().apply {
            put("sensors", sensorsArray)
            put("hardwarePlatform", "Dynamic Hardware Detection")
        }
    }

    fun getLiveReadingsJson(): JSONObject {
        return JSONObject().apply {
            put("hasAccel", hasAccelerometer)
            put("x", String.format(java.util.Locale.US, "%.2f", accelX))
            put("y", String.format(java.util.Locale.US, "%.2f", accelY))
            put("z", String.format(java.util.Locale.US, "%.2f", accelZ))
            put("vibration", String.format(java.util.Locale.US, "%.2f", vibrationMagnitude))
        }
    }
}
