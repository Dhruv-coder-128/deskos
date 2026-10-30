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
        },

        showNotification(title, message) {
            if (isNative && window.DeskOSBridge.showNotification) {
                return window.DeskOSBridge.showNotification(title, message);
            } else if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body: message });
                return true;
            }
            return false;
        },

        checkNotificationPermission() {
            if (isNative && window.DeskOSBridge.checkNotificationPermission) {
                return window.DeskOSBridge.checkNotificationPermission();
            } else if ('Notification' in window) {
                return Notification.permission === 'granted';
            }
            return true;
        },

        requestNotificationPermission() {
            if (isNative && window.DeskOSBridge.requestNotificationPermission) {
                window.DeskOSBridge.requestNotificationPermission();
            } else if ('Notification' in window && Notification.permission !== 'granted') {
                Notification.requestPermission();
            }
        },

        // PC Agent Host Link Bridge Methods
        getAgentStatus() {
            if (isNative && window.DeskOSBridge.getAgentStatus) {
                try {
                    return JSON.parse(window.DeskOSBridge.getAgentStatus());
                } catch (e) {
                    console.error('[UIBridge] parse agent status error:', e);
                }
            }
            return {
                state: 'NOT_PAIRED',
                isPaired: false,
                hostName: 'Lenovo LOQ',
                hostIp: '',
                port: 8765
            };
        },

        pairAgent(hostIp, port, pairingCode, fingerprint) {
            if (isNative && window.DeskOSBridge.pairAgent) {
                try {
                    const res = window.DeskOSBridge.pairAgent(hostIp, Number(port), pairingCode, fingerprint);
                    return JSON.parse(res);
                } catch (e) {
                    return { success: false, message: e.message || 'Bridge invocation failed' };
                }
            }
            return { success: false, message: 'Native bridge unavailable in standalone browser' };
        },

        connectAgent() {
            if (isNative && window.DeskOSBridge.connectAgent) {
                return window.DeskOSBridge.connectAgent();
            }
            return false;
        },

        disconnectAgent() {
            if (isNative && window.DeskOSBridge.disconnectAgent) {
                return window.DeskOSBridge.disconnectAgent();
            }
            return false;
        },

        forgetAgentDevice() {
            if (isNative && window.DeskOSBridge.forgetAgentDevice) {
                return window.DeskOSBridge.forgetAgentDevice();
            }
            return false;
        }
    };
})();

