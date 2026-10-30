/**
 * DESK OS — Core Application Orchestrator
 * Coordinates Clock, Mode Transitions, Power Governor, and Personal Space Suite.
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
    let activeMainView = 'command-center'; // 'command-center' or 'personal-space'
    let activePersonalSubTab = 'notes';   // 'notes', 'tasks', 'timers', 'calendar'

    let inactivityTimer = null;
    let screensaverTimer = null;
    let clockInterval = null;
    let telemetryInterval = null;

    const INACTIVITY_IDLE_MS = 2 * 60 * 1000;       // 2 Minutes -> Idle Mode
    const INACTIVITY_SCREENSAVER_MS = 10 * 60 * 1000; // 10 Minutes -> Screensaver Mode

    return {
        async init() {
            console.log('[DESK OS] Booting Phase 1 + Phase 2 Workstation Panel...');

            // Initialize Subsystems
            const deviceInfo = UIBridge.getDeviceInfo();
            CanvasGraphs.initSparkline('sensor-sparkline');
            CanvasGraphs.initScreensaver('screensaver-canvas');
            SensorsLab.init(deviceInfo.sensorCapabilities || {});
            await WidgetManager.init();

            // Initialize Phase 2 Personal Space Modules
            await NotesModule.init();
            await TasksModule.init();
            await TimersModule.init();
            await CalendarModule.init();

            // Load saved scratchpad note (Phase 1 widget)
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

            // Corrected, Normalized Battery Voltage
            if (voltEl) {
                const rawMv = b.voltageMv;
                if (rawMv > 0) {
                    const normalizedMv = rawMv > 100000 ? Math.round(rawMv / 1000) : rawMv;
                    voltEl.textContent = `${(normalizedMv / 1000).toFixed(2)} V (${normalizedMv} mV)`;
                } else {
                    voltEl.textContent = '---- mV';
                }
            }

            // Corrected Battery Temperature
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

        // =====================================================================
        // VIEW SWITCHING (COMMAND CENTER vs PERSONAL SPACE)
        // =====================================================================
        switchView(viewName) {
            activeMainView = viewName;
            const ccView = document.getElementById('view-command-center');
            const psView = document.getElementById('view-personal-space');
            const tabCc = document.getElementById('tab-btn-cc');
            const tabPs = document.getElementById('tab-btn-ps');

            if (viewName === 'command-center') {
                if (ccView) ccView.style.display = 'block';
                if (psView) psView.style.display = 'none';
                if (tabCc) tabCc.classList.add('active');
                if (tabPs) tabPs.classList.remove('active');
            } else {
                if (ccView) ccView.style.display = 'none';
                if (psView) psView.style.display = 'flex';
                if (tabCc) tabCc.classList.remove('active');
                if (tabPs) tabPs.classList.add('active');
            }

            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        switchPersonalSubTab(tabName) {
            activePersonalSubTab = tabName;
            const tabs = ['notes', 'tasks', 'timers', 'calendar'];

            tabs.forEach(t => {
                const pane = document.getElementById(`pane-${t}`);
                const btn = document.getElementById(`subnav-${t}`);
                if (pane) pane.classList.toggle('active', t === tabName);
                if (btn) btn.classList.toggle('active', t === tabName);
            });

            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        setMode(mode) {
            currentMode = mode;

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
