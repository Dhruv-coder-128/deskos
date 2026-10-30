/**
 * DESK OS — Native Bridge Interface Wrapper
 * Securely communicates with Android Kotlin layer via @JavascriptInterface.
 * Tokens are kept strictly outside JavaScript and Web Storage.
 */

const UIBridge = (() => {
    const isNative = typeof window.DeskOSBridge !== 'undefined';

    return {
        isAvailable() {
            return isNative;
        },

        getDeviceInfo() {
            if (isNative && window.DeskOSBridge.getDeviceInfo) {
                try {
                    return JSON.parse(window.DeskOSBridge.getDeviceInfo());
                } catch (e) {
                    console.error('[Bridge] Failed to parse device info:', e);
                }
            }
            // Sensible fallback for non-Android browser testing
            return {
                appVersion: '1.0.0 (Phase 1 Sandbox)',
                manufacturer: 'Samsung',
                model: 'Galaxy M01s (Simulated)',
                device: 'SM-M017F',
                androidVersion: '11',
                sdkInt: 30,
                battery: {
                    percent: 78,
                    isCharging: true,
                    chargeType: 'ac',
                    voltageMv: 4120,
                    temperatureC: '31.4',
                    isOverheating: false,
                    isNearLimit: false
                },
                sensorCapabilities: {
                    sensors: [
                        { name: 'Accelerometer', available: true, type: '3-axis motion' },
                        { name: 'Gyroscope', available: false, type: 'angular velocity' },
                        { name: 'Magnetometer', available: false, type: 'compass heading' },
                        { name: 'Light Sensor', available: false, type: 'ambient lux' },
                        { name: 'Proximity', available: true, type: 'distance flag' }
                    ]
                }
            };
        },

        getBatteryStatus() {
            if (isNative && window.DeskOSBridge.getBatteryStatus) {
                try {
                    return JSON.parse(window.DeskOSBridge.getBatteryStatus());
                } catch (e) {
                    console.error('[Bridge] Failed to parse battery status:', e);
                }
            }
            return {
                percent: 78,
                isCharging: true,
                chargeType: 'ac',
                voltageMv: 4120,
                temperatureC: '31.4',
                isOverheating: false,
                isNearLimit: false
            };
        },

        getLiveSensors() {
            if (isNative && window.DeskOSBridge.getLiveSensors) {
                try {
                    return JSON.parse(window.DeskOSBridge.getLiveSensors());
                } catch (e) {
                    console.error('[Bridge] Failed to parse live sensors:', e);
                }
            }
            // Simulated subtle motion jitter for browser dev
            const jitter = () => (Math.random() * 0.4 - 0.2).toFixed(2);
            return {
                hasAccel: true,
                x: jitter(),
                y: jitter(),
                z: (9.81 + parseFloat(jitter())).toFixed(2),
                vibration: Math.abs(parseFloat(jitter())).toFixed(2)
            };
        },

        setScreenDimmed(dimmed) {
            if (isNative && window.DeskOSBridge.setScreenDimmed) {
                window.DeskOSBridge.setScreenDimmed(Boolean(dimmed));
            }
        },

        setKeepScreenOn(enabled) {
            if (isNative && window.DeskOSBridge.setKeepScreenOn) {
                window.DeskOSBridge.setKeepScreenOn(Boolean(enabled));
            }
        },

        triggerHaptic(type = 'click') {
            if (isNative && window.DeskOSBridge.triggerHaptic) {
                window.DeskOSBridge.triggerHaptic(type);
            }
        }
    };
})();

