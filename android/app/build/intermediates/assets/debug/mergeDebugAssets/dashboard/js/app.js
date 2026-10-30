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

            // Set initial active views
            this.switchView('command-center', true);
            this.switchPersonalSubTab('notes', true);

            // Load saved scratchpad note (Phase 1 widget)
            this.initNotes();

            // Start Lifecycle Loops
            this.startClock();
            this.startTelemetryLoop();
            this.bindTouchEvents();
            this.resetInactivityTimer();

            // Initial Telemetry Render
            this.updateBatteryTelemetry();
            this.updateAgentTelemetry();
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
            // Poll battery, thermal & PC agent link telemetry every 1.0 second
            telemetryInterval = setInterval(() => {
                this.updateBatteryTelemetry();
                this.updateAgentTelemetry();
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

            if (pctEl) pctEl.textContent = (b.percent >= 0 && b.percent <= 100) ? `${b.percent}%` : 'N/A';
            if (barEl) barEl.style.width = `${(b.percent >= 0 && b.percent <= 100) ? b.percent : 0}%`;

            if (statusEl) {
                statusEl.textContent = b.isCharging ? `CHARGING (${b.chargeType.toUpperCase()})` : 'ON BATTERY';
                statusEl.className = `status-pill ${b.isCharging ? 'active' : ''}`;
            }

            // Validated Battery Voltage (never fabricate or show raw single-digit mV)
            if (voltEl) {
                if (b.voltageMv && b.voltageMv >= 2000 && b.voltageMv <= 6000) {
                    const volts = (b.voltageMv / 1000).toFixed(2);
                    voltEl.textContent = `${volts} V (${b.voltageMv} mV)`;
                } else {
                    voltEl.textContent = 'N/A';
                }
            }

            // Validated Battery Temperature
            if (tempEl) {
                if (b.temperatureC && b.temperatureC !== 'N/A') {
                    tempEl.textContent = `${b.temperatureC}°C`;
                    const tempNum = parseFloat(b.temperatureC);
                    if (tempNum >= 40.0) {
                        tempEl.className = 'telemetry-val danger';
                    } else if (tempNum >= 38.0) {
                        tempEl.className = 'telemetry-val warn';
                    } else {
                        tempEl.className = 'telemetry-val neon';
                    }
                } else {
                    tempEl.textContent = 'N/A';
                    tempEl.className = 'telemetry-val';
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

        updateAgentTelemetry() {
            const agent = UIBridge.getAgentStatus();
            if (!agent) return;

            const pill = document.getElementById('pc-agent-status-pill');
            const hostNameEl = document.getElementById('pc-host-name-val');
            const hostAddrEl = document.getElementById('pc-host-addr-val');
            const btnPair = document.getElementById('btn-pc-pair');
            const btnReconnect = document.getElementById('btn-pc-reconnect');
            const btnForget = document.getElementById('btn-pc-forget');

            const state = agent.state || 'NOT_PAIRED';

            if (hostNameEl) {
                hostNameEl.textContent = agent.isPaired ? agent.hostName : 'Not Paired';
            }
            if (hostAddrEl) {
                hostAddrEl.textContent = agent.isPaired ? `${agent.hostIp}:${agent.port}` : 'N/A';
            }

            if (pill) {
                pill.className = 'status-pill';
                pill.removeAttribute('style');
                switch (state) {
                    case 'CONNECTED':
                        pill.textContent = 'CONNECTED';
                        pill.classList.add('active');
                        break;
                    case 'CONNECTING':
                        pill.textContent = 'CONNECTING...';
                        pill.classList.add('cyan');
                        break;
                    case 'AUTH_FAILED':
                        pill.textContent = 'AUTH FAILED';
                        pill.style.borderColor = '#EF4444';
                        pill.style.color = '#EF4444';
                        break;
                    case 'OFFLINE':
                    case 'DISCONNECTED':
                        pill.textContent = 'OFFLINE';
                        pill.style.borderColor = '#F59E0B';
                        pill.style.color = '#F59E0B';
                        break;
                    case 'NOT_PAIRED':
                    default:
                        pill.textContent = 'NOT PAIRED';
                        pill.style.color = '#9CA3AF';
                        break;
                }
            }

            // Buttons visibility
            if (agent.isPaired) {
                if (btnPair) btnPair.style.display = 'none';
                if (btnForget) btnForget.style.display = 'inline-flex';
                if (btnReconnect) {
                    btnReconnect.style.display = (state === 'CONNECTED' || state === 'CONNECTING') ? 'none' : 'inline-flex';
                }
            } else {
                if (btnPair) btnPair.style.display = 'inline-flex';
                if (btnReconnect) btnReconnect.style.display = 'none';
                if (btnForget) btnForget.style.display = 'none';
            }
        },

        openPairingModal() {
            const modal = document.getElementById('pairing-modal');
            const feedback = document.getElementById('pairing-status-feedback');
            if (feedback) feedback.style.display = 'none';
            if (modal) modal.classList.add('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        closePairingModal() {
            const modal = document.getElementById('pairing-modal');
            if (modal) modal.classList.remove('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        submitPairing() {
            const ipInput = document.getElementById('pair-input-ip');
            const portInput = document.getElementById('pair-input-port');
            const pinInput = document.getElementById('pair-input-pin');
            const fpInput = document.getElementById('pair-input-fp');
            const feedback = document.getElementById('pairing-status-feedback');
            const submitBtn = document.getElementById('btn-submit-pair');

            const ip = ipInput ? ipInput.value.trim() : '';
            const port = portInput ? portInput.value.trim() : '8765';
            const pin = pinInput ? pinInput.value.trim() : '';
            const fp = fpInput ? fpInput.value.trim() : '';

            if (!ip || !pin || !fp) {
                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.textContent = 'ERROR: IP, Pairing PIN, and Fingerprint are required.';
                    feedback.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                    feedback.style.color = '#EF4444';
                }
                AudioSynth.playChime('alert');
                UIBridge.triggerHaptic('warning');
                return;
            }

            if (feedback) {
                feedback.style.display = 'block';
                feedback.textContent = 'CONNECTING & VERIFYING TLS PINNING...';
                feedback.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
                feedback.style.color = '#38BDF8';
            }
            if (submitBtn) submitBtn.disabled = true;

            setTimeout(() => {
                const res = UIBridge.pairAgent(ip, port, pin, fp);
                if (submitBtn) submitBtn.disabled = false;

                if (res.success) {
                    if (feedback) {
                        feedback.textContent = 'PAIRING SUCCESSFUL! LINKING...';
                        feedback.style.backgroundColor = 'rgba(0, 255, 71, 0.2)';
                        feedback.style.color = '#00FF47';
                    }
                    AudioSynth.playChime('success');
                    UIBridge.triggerHaptic('pulse');
                    setTimeout(() => {
                        this.closePairingModal();
                        this.updateAgentTelemetry();
                    }, 1200);
                } else {
                    if (feedback) {
                        feedback.textContent = `PAIRING FAILED: ${res.message || 'Check terminal'}`;
                        feedback.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                        feedback.style.color = '#EF4444';
                    }
                    AudioSynth.playChime('alert');
                    UIBridge.triggerHaptic('alarm');
                }
            }, 100);
        },

        reconnectAgent() {
            UIBridge.connectAgent();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            this.updateAgentTelemetry();
        },

        forgetAgent() {
            if (confirm('FORGET WORKSTATION PAIRING? You will need to re-enter pairing credentials to reconnect.')) {
                UIBridge.forgetAgentDevice();
                AudioSynth.playChime('click');
                UIBridge.triggerHaptic('warning');
                this.updateAgentTelemetry();
            }
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
        switchView(viewName, quiet = false) {
            activeMainView = viewName;
            const ccView = document.getElementById('view-command-center');
            const psView = document.getElementById('view-personal-space');

            const isCC = viewName === 'command-center';
            if (ccView) ccView.style.display = isCC ? 'block' : 'none';
            if (psView) psView.style.display = isCC ? 'none' : 'flex';

            ['tab-btn-cc', 'tab-btn-cc-m'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('active', isCC);
            });

            ['tab-btn-ps', 'tab-btn-ps-m'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('active', !isCC);
            });

            if (!quiet) {
                AudioSynth.playChime('tick');
                UIBridge.triggerHaptic('click');
            }
        },

        switchPersonalSubTab(tabName, quiet = false) {
            activePersonalSubTab = tabName;
            const tabs = ['notes', 'tasks', 'timers', 'calendar'];

            tabs.forEach(t => {
                const pane = document.getElementById(`pane-${t}`);
                const btn = document.getElementById(`subnav-${t}`);
                if (pane) pane.classList.toggle('active', t === tabName);
                if (btn) btn.classList.toggle('active', t === tabName);
            });

            if (!quiet) {
                AudioSynth.playChime('tick');
                UIBridge.triggerHaptic('click');
            }
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
