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

        getLatestTelemetry() {
            if (isNative && window.DeskOSBridge.getLatestTelemetry) {
                try {
                    const raw = window.DeskOSBridge.getLatestTelemetry();
                    if (!raw || raw.trim() === '') return null;
                    return JSON.parse(raw);
                } catch (e) {
                    console.error('[UIBridge] parse latest telemetry error:', e);
                }
            }
            return null;
        },

        pairAgent(hostIp, port, pairingOtp, remoteIp = null, connectionMode = 'AUTO') {
            if (isNative && window.DeskOSBridge.pairAgent) {
                try {
                    const res = window.DeskOSBridge.pairAgent(hostIp, Number(port), pairingOtp, remoteIp, connectionMode);
                    return JSON.parse(res);
                } catch (e) {
                    return { success: false, message: e.message || 'Bridge invocation failed' };
                }
            }
            return { success: false, message: 'Native bridge unavailable in standalone browser' };
        },

        setConnectionMode(mode = 'AUTO') {
            if (isNative && window.DeskOSBridge.setConnectionMode) {
                return window.DeskOSBridge.setConnectionMode(mode);
            }
            return false;
        },

        getConnectionMode() {
            if (isNative && window.DeskOSBridge.getConnectionMode) {
                return window.DeskOSBridge.getConnectionMode();
            }
            return 'AUTO';
        },

        unpairAgent() {
            if (isNative && window.DeskOSBridge.unpairAgent) {
                return window.DeskOSBridge.unpairAgent();
            }
            return this.forgetAgentDevice();
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
        },

        sendControlAction(action, payload = null) {
            if (isNative && window.DeskOSBridge.sendControlAction) {
                try {
                    const res = window.DeskOSBridge.sendControlAction(action, payload ? JSON.stringify(payload) : null);
                    return JSON.parse(res);
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }
            return { success: false, error: 'Bridge unavailable in browser' };
        },

        requestAppsList() {
            if (isNative && window.DeskOSBridge.requestAppsList) {
                return window.DeskOSBridge.requestAppsList();
            }
            return false;
        },

        requestVolumeState() {
            if (isNative && window.DeskOSBridge.requestVolumeState) {
                return window.DeskOSBridge.requestVolumeState();
            }
            return false;
        },

        setBrightnessLevel(fraction) {
            if (isNative && window.DeskOSBridge.setBrightnessLevel) {
                window.DeskOSBridge.setBrightnessLevel(fraction);
            }
        },

        sendWsJson(obj) {
            if (isNative && window.DeskOSBridge.sendWsJson) {
                try {
                    return window.DeskOSBridge.sendWsJson(JSON.stringify(obj));
                } catch (e) {
                    return false;
                }
            }
            return false;
        },

        requestDiscoveredApps(refresh = false) {
            return this.sendWsJson({ type: 'get_discovered_apps', refresh: Boolean(refresh) });
        },

        requestMediaState() {
            return this.sendWsJson({ type: 'get_media_state' });
        },

        requestRunningWindows() {
            return this.sendWsJson({ type: 'get_running_windows' });
        },

        launchDiscoveredApp(appId) {
            return this.sendControlAction('launch_discovered_app', { app_id: appId });
        },

        switchWindow(targetHwnd) {
            return this.sendControlAction('switch_window', { target_hwnd: targetHwnd });
        },

        sendMediaAction(action) {
            return this.sendControlAction('media_action', { media_action: action });
        },

        // Cyber Radar 2.0: Bluetooth LE Discovery
        startBleScan() {
            if (isNative && window.DeskOSBridge.startBleScan) {
                return window.DeskOSBridge.startBleScan();
            }
            return false;
        },

        stopBleScan() {
            if (isNative && window.DeskOSBridge.stopBleScan) {
                return window.DeskOSBridge.stopBleScan();
            }
            return false;
        },

        isBleScanning() {
            if (isNative && window.DeskOSBridge.isBleScanning) {
                return window.DeskOSBridge.isBleScanning();
            }
            return false;
        },

        getDiscoveredBleDevices() {
            if (isNative && window.DeskOSBridge.getDiscoveredBleDevices) {
                try {
                    return JSON.parse(window.DeskOSBridge.getDiscoveredBleDevices());
                } catch (e) {
                    return [];
                }
            }
            return [];
        },

        checkBluetoothPermission() {
            if (isNative && window.DeskOSBridge.checkBluetoothPermission) {
                return window.DeskOSBridge.checkBluetoothPermission();
            }
            return true;
        },

        requestBluetoothPermission() {
            if (isNative && window.DeskOSBridge.requestBluetoothPermission) {
                window.DeskOSBridge.requestBluetoothPermission();
            }
        },

        // Location Permissions (Aircraft Radar GPS)
        checkLocationPermission() {
            if (isNative && window.DeskOSBridge.checkLocationPermission) {
                return window.DeskOSBridge.checkLocationPermission();
            }
            return false;
        },

        requestLocationPermission() {
            if (isNative && window.DeskOSBridge.requestLocationPermission) {
                window.DeskOSBridge.requestLocationPermission();
            }
        },

        // Phase 7: Security Camera
        checkCameraPermission() {
            if (isNative && window.DeskOSBridge.checkCameraPermission) {
                return window.DeskOSBridge.checkCameraPermission();
            }
            return false;
        },

        requestCameraPermission() {
            if (isNative && window.DeskOSBridge.requestCameraPermission) {
                window.DeskOSBridge.requestCameraPermission();
            }
        },

        streamCameraFrame(frameBase64) {
            if (isNative && window.DeskOSBridge.streamCameraFrame) {
                return window.DeskOSBridge.streamCameraFrame(frameBase64);
            }
            return this.sendWsJson({ type: 'camera_frame', data: frameBase64 });
        },

        // Phase 7: Real Sensor Dashboard
        getRealSensorReadings() {
            if (isNative && window.DeskOSBridge.getRealSensorReadings) {
                try {
                    return JSON.parse(window.DeskOSBridge.getRealSensorReadings());
                } catch (e) {
                    return null;
                }
            }
            return null;
        },

        requestNetworkDevices() {
            if (isNative && window.DeskOSBridge.requestNetworkDevices) {
                return window.DeskOSBridge.requestNetworkDevices();
            }
            return this.sendWsJson({ type: 'get_network_devices' });
        },

        fetchOpenSky(lamin, lomin, lamax, lomax) {
            if (isNative && window.DeskOSBridge.fetchOpenSky) {
                try {
                    return window.DeskOSBridge.fetchOpenSky(String(lamin), String(lomin), String(lamax), String(lomax));
                } catch (e) {
                    console.error('[Bridge] Native fetchOpenSky error:', e);
                }
            }
            return null;
        },

        requestAircraftData(lamin, lomin, lamax, lomax) {
            return this.sendWsJson({
                type: 'control',
                action: 'get_aircraft',
                lamin: Number(lamin),
                lomin: Number(lomin),
                lamax: Number(lamax),
                lomax: Number(lomax)
            });
        },

        // =====================================================================
        // Phase 8: DESK AI & Multilingual Voice Bridge Methods
        // =====================================================================
        checkMicrophonePermission() {
            if (isNative && window.DeskOSBridge.checkMicrophonePermission) {
                return window.DeskOSBridge.checkMicrophonePermission();
            }
            return false;
        },

        requestMicrophonePermission() {
            if (isNative && window.DeskOSBridge.requestMicrophonePermission) {
                window.DeskOSBridge.requestMicrophonePermission();
            }
        },

        startVoiceRecognition(lang = 'AUTO') {
            if (isNative && window.DeskOSBridge.startVoiceRecognition) {
                return window.DeskOSBridge.startVoiceRecognition(lang);
            }
            return false;
        },

        stopVoiceRecognition() {
            if (isNative && window.DeskOSBridge.stopVoiceRecognition) {
                return window.DeskOSBridge.stopVoiceRecognition();
            }
            return false;
        },

        speakText(text, lang = 'gu-IN', rate = 1.0) {
            if (isNative && window.DeskOSBridge.speakText) {
                return window.DeskOSBridge.speakText(text, lang, Number(rate));
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.rate = rate;
                window.speechSynthesis.speak(utter);
                return true;
            }
            return false;
        },

        stopSpeaking() {
            if (isNative && window.DeskOSBridge.stopSpeaking) {
                return window.DeskOSBridge.stopSpeaking();
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                return true;
            }
            return false;
        },

        getVoiceCapabilities() {
            if (isNative && window.DeskOSBridge.getVoiceCapabilities) {
                try {
                    return JSON.parse(window.DeskOSBridge.getVoiceCapabilities());
                } catch (_) {}
            }
            return {
                speechRecognizerAvailable: false,
                ttsAvailable: true,
                gujaratiTtsSupported: false,
                englishTtsSupported: true
            };
        },

        hasGeminiApiKey() {
            if (isNative && window.DeskOSBridge.hasGeminiApiKey) {
                return window.DeskOSBridge.hasGeminiApiKey();
            }
            return false;
        },

        saveGeminiApiKey(key) {
            if (isNative && window.DeskOSBridge.saveGeminiApiKey) {
                return window.DeskOSBridge.saveGeminiApiKey(key);
            }
            return false;
        },

        removeGeminiApiKey() {
            if (isNative && window.DeskOSBridge.removeGeminiApiKey) {
                return window.DeskOSBridge.removeGeminiApiKey();
            }
            return false;
        },

        getGeminiModel() {
            if (isNative && window.DeskOSBridge.getGeminiModel) {
                return window.DeskOSBridge.getGeminiModel();
            }
            return 'gemini-1.5-flash';
        },

        setGeminiModel(model) {
            if (isNative && window.DeskOSBridge.setGeminiModel) {
                return window.DeskOSBridge.setGeminiModel(model);
            }
            return false;
        },

        testGeminiApiKey(key) {
            if (isNative && window.DeskOSBridge.testGeminiApiKey) {
                try {
                    const candidate = (typeof key === 'string') ? key : '';
                    const raw = window.DeskOSBridge.testGeminiApiKey(candidate);
                    const parsed = JSON.parse(raw);
                    return {
                        success: parsed.status === 'ok' || parsed.success === true,
                        ...parsed
                    };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }
            return { success: false, error: 'Native bridge unavailable' };
        },

        sendAiPrompt(userText, lang = 'AUTO', systemContext = {}) {
            if (isNative && window.DeskOSBridge.sendAiPrompt) {
                try {
                    const ctxStr = typeof systemContext === 'string' ? systemContext : JSON.stringify(systemContext);
                    return JSON.parse(window.DeskOSBridge.sendAiPrompt(userText, lang, ctxStr));
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }
            return { success: false, error: 'Native bridge unavailable' };
        },

        searchSongOnPc(query) {
            if (isNative && window.DeskOSBridge.searchSongOnPc) {
                return window.DeskOSBridge.searchSongOnPc(query);
            }
            return this.sendWsJson({
                type: 'control_action',
                action: 'search_song',
                search_query: query
            });
        }
    };
})();

