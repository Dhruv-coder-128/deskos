/**
 * DESK OS — Core Application Orchestrator
 * Coordinates Clock, Mode Transitions, Power Governor, and Touch Lifecycle.
 */

const DeskOS = (() => {
    // 4 Interface Modes
    const MODES = {
        ACTIVE: 'active',
        IDLE: 'idle',
        SCREENSAVER: 'screensaver',
        CUSTOMIZE: 'customize'
    };

    let currentMode = MODES.ACTIVE;
    let inactivityTimer = null;
    let screensaverTimer = null;
    let clockInterval = null;
    let telemetryInterval = null;

    const INACTIVITY_IDLE_MS = 2 * 60 * 1000;       // 2 Minutes -> Idle Mode
    const INACTIVITY_SCREENSAVER_MS = 10 * 60 * 1000; // 10 Minutes -> Screensaver Mode

    return {
        async init() {
            console.log('[DESK OS] Booting Phase 1 Cyberpunk Dashboard...');

            // Initialize Subsystems
            const deviceInfo = UIBridge.getDeviceInfo();
            CanvasGraphs.initSparkline('sensor-sparkline');
            CanvasGraphs.initScreensaver('screensaver-canvas');
            SensorsLab.init(deviceInfo.sensorCapabilities || {});
            await WidgetManager.init();

            // Load saved scratchpad note
            this.initNotes();

            // Start Lifecycle Loops
            this.startClock();
            this.startTelemetryLoop();
            this.bindTouchEvents();
            this.resetInactivityTimer();

            // Initial Telemetry Render
            this.updateBatteryTelemetry();
            this.updateDeviceInfo(deviceInfo);
        },

        startClock() {
            const update = () => {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');

                // Main Clock
                const hEl = document.getElementById('clock-hours-mins');
                const sEl = document.getElementById('clock-seconds');
                const dEl = document.getElementById('clock-date');
                const idleEl = document.getElementById('idle-clock-display');
                const ssEl = document.getElementById('screensaver-time');

                const timeStr = `${hours}:${minutes}`;
                if (hEl) hEl.textContent = timeStr;
                if (sEl) sEl.textContent = `:${seconds}`;
                if (idleEl) idleEl.textContent = `${timeStr}:${seconds}`;
                if (ssEl) ssEl.textContent = `${timeStr}:${seconds}`;

                if (dEl) {
                    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                    dEl.textContent = `${days[now.getDay()]} // ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
                }
            };

            update();
            clockInterval = setInterval(update, 1000);
        },

        startTelemetryLoop() {
            // Poll battery & thermal telemetry every 1.0 second
            telemetryInterval = setInterval(() => {
                this.updateBatteryTelemetry();
            }, 1000);
        },

        updateBatteryTelemetry() {
            const b = UIBridge.getBatteryStatus();
            if (!b) return;

            // Percentage & Progress Bar
            const pctEl = document.getElementById('battery-pct-val');
            const barEl = document.getElementById('battery-bar');
            const statusEl = document.getElementById('battery-status-tag');
            const voltEl = document.getElementById('battery-volt-val');
            const tempEl = document.getElementById('battery-temp-val');
            const alertBadge = document.getElementById('battery-alert-badge');

            if (pctEl) pctEl.textContent = `${b.percent >= 0 ? b.percent : '--'}%`;
            if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, b.percent))}%`;

            if (statusEl) {
                statusEl.textContent = b.isCharging ? `CHARGING (${b.chargeType.toUpperCase()})` : 'ON BATTERY';
                statusEl.className = `status-pill ${b.isCharging ? 'active' : ''}`;
            }

            if (voltEl) voltEl.textContent = `${b.voltageMv} mV`;

            if (tempEl) {
                tempEl.textContent = `${b.temperatureC}°C`;
                // Thermal Color Governance
                const tempNum = parseFloat(b.temperatureC);
                if (tempNum >= 40.0) {
                    tempEl.className = 'telemetry-val danger';
                } else if (tempNum >= 38.0) {
                    tempEl.className = 'telemetry-val warn';
                } else {
                    tempEl.className = 'telemetry-val neon';
                }
            }

            // 80% Charge Warning & Overheat Warning
            if (alertBadge) {
                if (b.isOverheating) {
                    alertBadge.style.display = 'block';
                    alertBadge.textContent = 'THERMAL GOVERNOR: OVERHEAT (>40°C)';
                    alertBadge.style.color = '#EF4444';
                    UIBridge.setScreenDimmed(true);
                } else if (b.isNearLimit) {
                    alertBadge.style.display = 'block';
                    alertBadge.textContent = 'CONSERVATIVE CHARGE ALERT: REACHED 80%';
                    alertBadge.style.color = '#F59E0B';
                } else {
                    alertBadge.style.display = 'none';
                }
            }
        },

        updateDeviceInfo(info) {
            const devEl = document.getElementById('device-model-val');
            const osEl = document.getElementById('device-os-val');
            if (devEl) devEl.textContent = `${info.manufacturer} ${info.model}`;
            if (osEl) osEl.textContent = `Android ${info.androidVersion} (API ${info.sdkInt})`;
        },

        async initNotes() {
            const notesInput = document.getElementById('quick-notes-textarea');
            if (!notesInput) return;

            const savedNote = await DeskStorage.get('quick_notes', '');
            notesInput.value = savedNote;

            notesInput.addEventListener('input', async (e) => {
                await DeskStorage.set('quick_notes', e.target.value);
            });
        },

        setMode(mode) {
            currentMode = mode;
            console.log('[DESK OS] Mode switched to:', mode);

            const idleOverlay = document.getElementById('idle-overlay');
            const ssOverlay = document.getElementById('screensaver-overlay');
            const modalOverlay = document.getElementById('customize-modal');

            // Deactivate all overlays
            if (idleOverlay) idleOverlay.classList.remove('active');
            if (ssOverlay) ssOverlay.classList.remove('active');
            if (modalOverlay) modalOverlay.classList.remove('active');
            CanvasGraphs.stopScreensaver();

            switch (mode) {
                case MODES.ACTIVE:
                    UIBridge.setScreenDimmed(false);
                    SensorsLab.startLiveStream();
                    break;

                case MODES.IDLE:
                    UIBridge.setScreenDimmed(true);
                    if (idleOverlay) idleOverlay.classList.add('active');
                    SensorsLab.stopLiveStream();
                    break;

                case MODES.SCREENSAVER:
                    UIBridge.setScreenDimmed(true);
                    if (ssOverlay) ssOverlay.classList.add('active');
                    CanvasGraphs.startScreensaver();
                    SensorsLab.stopLiveStream();
                    break;

                case MODES.CUSTOMIZE:
                    if (modalOverlay) modalOverlay.classList.add('active');
                    break;
            }

            UIBridge.triggerHaptic('click');
        },

        resetInactivityTimer() {
            clearTimeout(inactivityTimer);
            clearTimeout(screensaverTimer);

            if (currentMode !== MODES.ACTIVE && currentMode !== MODES.CUSTOMIZE) {
                this.setMode(MODES.ACTIVE);
            }

            // 2 min -> Idle Mode
            inactivityTimer = setTimeout(() => {
                this.setMode(MODES.IDLE);
            }, INACTIVITY_IDLE_MS);

            // 10 min -> Screensaver Mode
            screensaverTimer = setTimeout(() => {
                this.setMode(MODES.SCREENSAVER);
            }, INACTIVITY_SCREENSAVER_MS);
        },

        bindTouchEvents() {
            const resetAction = () => this.resetInactivityTimer();

            window.addEventListener('touchstart', resetAction, { passive: true });
            window.addEventListener('click', resetAction, { passive: true });
            window.addEventListener('mousemove', resetAction, { passive: true });

            // Idle view tap-to-wake
            const idleOverlay = document.getElementById('idle-overlay');
            if (idleOverlay) {
                idleOverlay.addEventListener('click', () => this.setMode(MODES.ACTIVE));
            }

            // Screensaver view tap-to-wake
            const ssOverlay = document.getElementById('screensaver-overlay');
            if (ssOverlay) {
                ssOverlay.addEventListener('click', () => this.setMode(MODES.ACTIVE));
            }
        }
    };
})();

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    DeskOS.init();
});

