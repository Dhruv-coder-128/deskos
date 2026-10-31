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
 * Dynamically queries and streams real hardware sensors on the device.
 * Guarantees zero crashes if gyroscope, magnetometer, or ambient light sensors are absent.
 * Returns honest null/N/A values for missing sensors (e.g. Galaxy M01s).
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
    private val gyroscope: Sensor?
    private val magnetometer: Sensor?
    private val lightSensor: Sensor?
    private val proximitySensor: Sensor?

    // Live readings
    @Volatile var accelX: Float = 0.0f
    @Volatile var accelY: Float = 0.0f
    @Volatile var accelZ: Float = 0.0f
    @Volatile var vibrationMagnitude: Float = 0.0f

    @Volatile var gyroX: Float = 0.0f
    @Volatile var gyroY: Float = 0.0f
    @Volatile var gyroZ: Float = 0.0f

    @Volatile var magX: Float = 0.0f
    @Volatile var magY: Float = 0.0f
    @Volatile var magZ: Float = 0.0f
    @Volatile var compassAzimuthDeg: Float = 0.0f

    @Volatile var ambientLux: Float = 0.0f
    @Volatile var proximityDistanceCm: Float = 0.0f
    @Volatile var isNear: Boolean = false

    private val gravityValues = FloatArray(3)
    private val geomagneticValues = FloatArray(3)
    private var isListening = false

    init {
        val allSensors = sensorManager?.getSensorList(Sensor.TYPE_ALL)?.map { it.type }?.toSet() ?: emptySet()

        hasAccelerometer = allSensors.contains(Sensor.TYPE_ACCELEROMETER)
        hasGyroscope = allSensors.contains(Sensor.TYPE_GYROSCOPE)
        hasMagnetometer = allSensors.contains(Sensor.TYPE_MAGNETIC_FIELD)
        hasLightSensor = allSensors.contains(Sensor.TYPE_LIGHT)
        hasProximity = allSensors.contains(Sensor.TYPE_PROXIMITY)

        accelerometer = if (hasAccelerometer) sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) else null
        gyroscope = if (hasGyroscope) sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) else null
        magnetometer = if (hasMagnetometer) sensorManager?.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) else null
        lightSensor = if (hasLightSensor) sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT) else null
        proximitySensor = if (hasProximity) sensorManager?.getDefaultSensor(Sensor.TYPE_PROXIMITY) else null
    }

    fun startListening() {
        if (!isListening && sensorManager != null) {
            try {
                accelerometer?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
                gyroscope?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
                magnetometer?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
                lightSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
                proximitySensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
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
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                accelX = event.values[0]
                accelY = event.values[1]
                accelZ = event.values[2]
                System.arraycopy(event.values, 0, gravityValues, 0, 3)

                val totalG = sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ)
                vibrationMagnitude = abs(totalG - 9.81f)
                updateCompass()
            }
            Sensor.TYPE_GYROSCOPE -> {
                gyroX = event.values[0]
                gyroY = event.values[1]
                gyroZ = event.values[2]
            }
            Sensor.TYPE_MAGNETIC_FIELD -> {
                magX = event.values[0]
                magY = event.values[1]
                magZ = event.values[2]
                System.arraycopy(event.values, 0, geomagneticValues, 0, 3)
                updateCompass()
            }
            Sensor.TYPE_LIGHT -> {
                ambientLux = event.values[0]
            }
            Sensor.TYPE_PROXIMITY -> {
                proximityDistanceCm = event.values[0]
                val maxRange = event.sensor.maximumRange
                isNear = proximityDistanceCm < maxRange && proximityDistanceCm < 5.0f
            }
        }
    }

    private fun updateCompass() {
        if (!hasMagnetometer || !hasAccelerometer) return
        val r = FloatArray(9)
        val i = FloatArray(9)
        if (SensorManager.getRotationMatrix(r, i, gravityValues, geomagneticValues)) {
            val orientation = FloatArray(3)
            SensorManager.getOrientation(r, orientation)
            val azimuthRad = orientation[0]
            var azimuthDeg = Math.toDegrees(azimuthRad.toDouble()).toFloat()
            if (azimuthDeg < 0) azimuthDeg += 360.0f
            compassAzimuthDeg = azimuthDeg
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    fun getCapabilitiesJson(): JSONObject {
        val sensorsArray = JSONArray().apply {
            put(JSONObject().apply {
                put("name", "Accelerometer")
                put("available", hasAccelerometer)
                put("type", "3-axis motion")
                put("vendor", accelerometer?.vendor ?: "N/A")
            })
            put(JSONObject().apply {
                put("name", "Gyroscope")
                put("available", hasGyroscope)
                put("type", "angular velocity")
                put("vendor", gyroscope?.vendor ?: "N/A")
            })
            put(JSONObject().apply {
                put("name", "Magnetometer")
                put("available", hasMagnetometer)
                put("type", "compass heading")
                put("vendor", magnetometer?.vendor ?: "N/A")
            })
            put(JSONObject().apply {
                put("name", "Light Sensor")
                put("available", hasLightSensor)
                put("type", "ambient lux")
                put("vendor", lightSensor?.vendor ?: "N/A")
            })
            put(JSONObject().apply {
                put("name", "Proximity")
                put("available", hasProximity)
                put("type", "distance flag")
                put("vendor", proximitySensor?.vendor ?: "N/A")
            })
        }

        return JSONObject().apply {
            put("sensors", sensorsArray)
            put("hardwarePlatform", "Dynamic Android Hardware Detection")
        }
    }

    fun getLiveReadingsJson(): JSONObject {
        return JSONObject().apply {
            // Legacy backwards-compatible fields
            put("hasAccel", hasAccelerometer)
            put("x", String.format(java.util.Locale.US, "%.2f", accelX))
            put("y", String.format(java.util.Locale.US, "%.2f", accelY))
            put("z", String.format(java.util.Locale.US, "%.2f", accelZ))
            put("vibration", String.format(java.util.Locale.US, "%.2f", vibrationMagnitude))

            // Expanded Phase 7 live sensor contract
            put("accelerometer", JSONObject().apply {
                put("available", hasAccelerometer)
                if (hasAccelerometer) {
                    put("x", accelX)
                    put("y", accelY)
                    put("z", accelZ)
                    put("vibration", vibrationMagnitude)
                }
            })

            put("gyroscope", JSONObject().apply {
                put("available", hasGyroscope)
                if (hasGyroscope) {
                    put("x", gyroX)
                    put("y", gyroY)
                    put("z", gyroZ)
                }
            })

            put("magnetometer", JSONObject().apply {
                put("available", hasMagnetometer)
                if (hasMagnetometer) {
                    put("x", magX)
                    put("y", magY)
                    put("z", magZ)
                    put("azimuthDeg", compassAzimuthDeg)
                }
            })

            put("light", JSONObject().apply {
                put("available", hasLightSensor)
                if (hasLightSensor) {
                    put("lux", ambientLux)
                }
            })

            put("proximity", JSONObject().apply {
                put("available", hasProximity)
                if (hasProximity) {
                    put("distanceCm", proximityDistanceCm)
                    put("isNear", isNear)
                }
            })
        }
    }
}
