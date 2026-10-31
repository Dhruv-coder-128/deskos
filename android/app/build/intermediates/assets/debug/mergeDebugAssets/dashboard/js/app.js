/**
 * DESK OS — Core Application Orchestrator
 * Coordinates Clock, Mode Transitions, Power Governor, and Personal Space Suite.
 */

const DeskOS = (() => {
    // 5 Interface Modes
    const MODES = {
        ACTIVE: 'active',
        IDLE: 'idle',
        DIM: 'dim',
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

    // Control Deck 2.0 State
    let _allDiscoveredApps = [];
    let _selectedAppCategory = 'all';
    let _appSearchQuery = '';
    let _lastMediaState = null;

    const INACTIVITY_IDLE_MS = 2 * 60 * 1000;       // 2 Minutes -> Idle Mode
    const INACTIVITY_SCREENSAVER_MS = 10 * 60 * 1000; // 10 Minutes -> Screensaver Mode

    return {
        async init() {
            console.log('[DESK OS] Booting Phase 1 + Phase 2 Workstation Panel...');

            // Initialize Subsystems
            const deviceInfo = UIBridge.getDeviceInfo();
            CanvasGraphs.initSparkline('sensor-sparkline');
            CanvasGraphs.initCpuGraph('pc-cpu-sparkline');
            CanvasGraphs.initScreensaver('screensaver-canvas');
            SensorsLab.init(deviceInfo.sensorCapabilities || {});
            await WidgetManager.init();

            // Hook global telemetry callback invoked from native Android bridge
            window.onDeskOSTelemetry = (msg) => {
                if (!msg) return;
                const payload = (msg.type === 'telemetry' && msg.data) ? msg.data : (msg.cpu ? msg : null);
                if (payload) {
                    this.renderLiveTelemetry(payload);
                }
            };

            // Hook global message callback for control results, apps list, volume, and screenshots
            window.onDeskOSMessage = (msg) => {
                if (!msg) return;
                this.handleDeskOSMessage(msg);
            };

            // Initialize App Launcher with default allowlist
            this.renderDefaultApps();

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

                // Main & Overlay Clocks
                const hEl = document.getElementById('clock-hours-mins');
                const sEl = document.getElementById('clock-seconds');
                const dEl = document.getElementById('clock-date');
                const dimEl = document.getElementById('dim-clock-display');
                const idleEl = document.getElementById('idle-clock-display');
                const idleDateEl = document.getElementById('idle-date-display');
                const ssEl = document.getElementById('screensaver-time');

                const timeStr = `${hours}:${minutes}`;
                if (hEl) hEl.textContent = timeStr;
                if (sEl) sEl.textContent = `:${seconds}`;
                if (dimEl) dimEl.textContent = timeStr;
                if (idleEl) idleEl.textContent = `${timeStr}:${seconds}`;
                if (ssEl) ssEl.textContent = `${timeStr}:${seconds}`;

                const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                const formattedDate = `${days[now.getDay()]} // ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
                if (dEl) dEl.textContent = formattedDate;
                if (idleDateEl) idleDateEl.textContent = formattedDate;
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

            // Idle overlay battery mirror
            const idleBatt = document.getElementById('idle-battery-display');
            if (idleBatt && b.percent !== undefined) {
                idleBatt.textContent = `BATTERY: ${b.percent}% ${b.isCharging ? '[CHARGING]' : ''}`;
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
            const hostModePill = document.getElementById('connection-mode-pill');
            const hostNameEl = document.getElementById('pc-host-name-val');
            const hostAddrEl = document.getElementById('pc-host-addr-val');
            const rateEl = document.getElementById('pc-telemetry-rate-val');
            const staleAlert = document.getElementById('pc-stale-alert');
            const btnPair = document.getElementById('btn-pc-pair');
            const btnReconnect = document.getElementById('btn-pc-reconnect');
            const btnForget = document.getElementById('btn-pc-forget');

            const state = agent.state || 'NOT_PAIRED';

            if (hostModePill) {
                if (state === 'CONNECTED') {
                    hostModePill.textContent = 'HOST LINKED';
                    hostModePill.classList.add('active');
                } else {
                    hostModePill.textContent = 'STANDALONE';
                    hostModePill.classList.remove('active');
                }
            }

            if (hostNameEl) {
                hostNameEl.textContent = agent.isPaired ? agent.hostName : 'Not Paired';
            }
            if (hostAddrEl) {
                const addr = agent.hostIp || agent.localIp || agent.remoteIp || 'N/A';
                hostAddrEl.textContent = agent.isPaired ? `${addr}:${agent.port}` : 'N/A';
            }

            const routeValEl = document.getElementById('pc-route-val');
            if (routeValEl) {
                const modeStr = agent.connectionMode || 'AUTO';
                const routeStr = agent.activeRoute && agent.activeRoute !== 'NONE' ? agent.activeRoute : (state === 'CONNECTED' ? 'LOCAL' : 'STANDBY');
                routeValEl.textContent = `${modeStr} (${routeStr})`;
                routeValEl.className = `telemetry-val ${routeStr === 'REMOTE' ? 'cyan' : 'neon'}`;
            }

            const btnModeToggle = document.getElementById('btn-pc-mode-toggle');
            if (btnModeToggle) {
                btnModeToggle.style.display = agent.isPaired ? 'inline-flex' : 'none';
                btnModeToggle.textContent = `ROUTE: ${agent.connectionMode || 'AUTO'}`;
            }

            if (pill) {
                pill.className = 'status-pill';
                pill.removeAttribute('style');
                switch (state) {
                    case 'CONNECTED':
                        if (agent.activeRoute === 'REMOTE') {
                            pill.textContent = 'REMOTE (TAILSCALE)';
                            pill.classList.add('cyan');
                        } else {
                            pill.textContent = 'LOCAL (LAN)';
                            pill.classList.add('active');
                        }
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

            // Control Deck State
            const offlineBanner = document.getElementById('pc-controls-offline-banner');
            const controlsBody = document.getElementById('pc-controls-body');
            const controlsBadge = document.getElementById('pc-controls-status-badge');

            if (state === 'CONNECTED') {
                if (!this._pcConnected) {
                    this._pcConnected = true;
                    UIBridge.requestAppsList();
                    UIBridge.requestVolumeState();
                    UIBridge.requestDiscoveredApps();
                    UIBridge.requestMediaState();
                    UIBridge.requestRunningWindows();
                }
                if (offlineBanner) offlineBanner.style.display = 'none';
                if (controlsBody) {
                    controlsBody.style.opacity = '1';
                    controlsBody.style.pointerEvents = 'auto';
                }
                if (controlsBadge) {
                    controlsBadge.textContent = 'SECURE IPC // ACTIVE';
                    controlsBadge.style.color = 'var(--color-accent-primary)';
                }
            } else {
                this._pcConnected = false;
                if (offlineBanner) {
                    offlineBanner.style.display = 'block';
                    offlineBanner.textContent = state === 'NOT_PAIRED' 
                        ? 'WORKSTATION UNLINKED // PAIR PC TO ENABLE CONTROLS' 
                        : `WORKSTATION ${state} // CONNECT HOST TO ENABLE CONTROLS`;
                }
                if (controlsBody) {
                    controlsBody.style.opacity = '0.5';
                    controlsBody.style.pointerEvents = 'none';
                }
                if (controlsBadge) {
                    controlsBadge.textContent = 'STANDBY';
                    controlsBadge.style.color = 'var(--color-text-dim)';
                }
            }

            // Stale & Polling Fallback Handling
            const now = Date.now();
            if (state === 'CONNECTED') {
                // Poll fallback in case push event was queued
                const latestTelem = UIBridge.getLatestTelemetry();
                if (latestTelem && (!this._lastTelemTime || latestTelem.timestamp * 1000 > this._lastTelemTime)) {
                    this.renderLiveTelemetry(latestTelem.data || latestTelem);
                }

                const telemAge = this._lastTelemReceipt ? (now - this._lastTelemReceipt) : 99999;
                if (telemAge > 3500) {
                    if (staleAlert) staleAlert.style.display = 'block';
                    if (rateEl) {
                        rateEl.textContent = 'STALE DATA';
                        rateEl.className = 'telemetry-val warn';
                    }
                } else {
                    if (staleAlert) staleAlert.style.display = 'none';
                    if (rateEl) {
                        rateEl.textContent = 'LIVE 1.0 Hz';
                        rateEl.className = 'telemetry-val neon';
                    }
                }
            } else {
                if (staleAlert) staleAlert.style.display = 'none';
                if (rateEl) {
                    rateEl.textContent = state === 'NOT_PAIRED' ? 'UNLINKED' : 'OFFLINE';
                    rateEl.className = 'telemetry-val';
                }
                this.renderDisconnectedTelemetry(state);
            }
        },

        renderLiveTelemetry(telem) {
            if (!telem || !telem.cpu) return;
            this._lastTelemReceipt = Date.now();
            this._lastTelemTime = telem.timestamp ? telem.timestamp * 1000 : Date.now();

            // 1. Uptime
            const uptimeEl = document.getElementById('pc-uptime-val');
            if (uptimeEl && telem.system) {
                const s = Math.floor(telem.system.uptime_seconds || 0);
                const h = Math.floor(s / 3600);
                const m = Math.floor((s % 3600) / 60);
                const sec = s % 60;
                uptimeEl.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
            }

            // 2. CPU
            const cpuPctEl = document.getElementById('pc-cpu-pct-val');
            const cpuBarEl = document.getElementById('pc-cpu-bar');
            const cpuCoresEl = document.getElementById('pc-cpu-cores-val');
            const cpuFreqEl = document.getElementById('pc-cpu-freq-val');
            const cpuTempEl = document.getElementById('pc-cpu-temp-val');
            const coresGrid = document.getElementById('pc-cpu-cores-grid');

            const cpuLoad = typeof telem.cpu.overall_percent === 'number' ? telem.cpu.overall_percent : 0;
            if (cpuPctEl) cpuPctEl.textContent = `${cpuLoad.toFixed(1)}%`;
            if (cpuBarEl) cpuBarEl.style.width = `${Math.min(100, Math.max(0, cpuLoad))}%`;
            CanvasGraphs.addCpuPoint(cpuLoad);

            if (cpuCoresEl) {
                const phys = telem.cpu.core_count_physical;
                const log = telem.cpu.core_count_logical;
                if (phys && log > phys) {
                    cpuCoresEl.textContent = `${phys}P+${log - phys}E (${log} Threads)`;
                } else {
                    cpuCoresEl.textContent = `${log || '--'} Logical Cores`;
                }
            }

            if (cpuFreqEl) {
                cpuFreqEl.textContent = telem.cpu.frequency_mhz
                    ? `${(telem.cpu.frequency_mhz / 1000).toFixed(2)} GHz`
                    : 'N/A';
            }

            if (cpuTempEl) {
                if (telem.cpu.temperature_c !== null && telem.cpu.temperature_c !== undefined) {
                    cpuTempEl.textContent = `${telem.cpu.temperature_c}°C`;
                    cpuTempEl.className = telem.cpu.temperature_c >= 80 ? 'telemetry-val danger' : (telem.cpu.temperature_c >= 70 ? 'telemetry-val warn' : 'telemetry-val neon');
                } else {
                    cpuTempEl.textContent = 'N/A (WMI Elev. Req.)';
                    cpuTempEl.className = 'telemetry-val';
                }
            }

            // Multi-core grid bars
            if (coresGrid && Array.isArray(telem.cpu.per_core_percent)) {
                const coreArr = telem.cpu.per_core_percent;
                if (coresGrid.children.length !== coreArr.length) {
                    coresGrid.innerHTML = '';
                    coreArr.forEach((val, idx) => {
                        const box = document.createElement('div');
                        box.className = 'core-meter-box';
                        box.innerHTML = `
                            <div class="core-bar-track">
                                <div class="core-bar-fill" id="core-bar-${idx}" style="height: ${Math.min(100, Math.max(0, val))}%;"></div>
                            </div>
                            <span class="core-num-label">${idx + 1}</span>
                        `;
                        coresGrid.appendChild(box);
                    });
                } else {
                    coreArr.forEach((val, idx) => {
                        const fill = document.getElementById(`core-bar-${idx}`);
                        if (fill) fill.style.height = `${Math.min(100, Math.max(0, val))}%`;
                    });
                }
            }

            // 3. GPU
            const gpuBadge = document.getElementById('pc-gpu-badge');
            const gpuUtilEl = document.getElementById('pc-gpu-util-val');
            const gpuBarEl = document.getElementById('pc-gpu-bar');
            const gpuTempEl = document.getElementById('pc-gpu-temp-val');
            const gpuVramEl = document.getElementById('pc-gpu-vram-val');
            const vramBarEl = document.getElementById('pc-vram-bar');
            const gpuPwrEl = document.getElementById('pc-gpu-power-val');

            if (telem.gpu && telem.gpu.available) {
                if (gpuBadge) gpuBadge.textContent = 'RTX 3050';
                const gpuLoad = typeof telem.gpu.utilization_percent === 'number' ? telem.gpu.utilization_percent : 0;
                if (gpuUtilEl) gpuUtilEl.textContent = `${gpuLoad.toFixed(1)}%`;
                if (gpuBarEl) gpuBarEl.style.width = `${Math.min(100, Math.max(0, gpuLoad))}%`;

                if (gpuTempEl) {
                    gpuTempEl.textContent = telem.gpu.temperature_c !== null ? `${telem.gpu.temperature_c}°C` : 'N/A';
                    gpuTempEl.className = telem.gpu.temperature_c >= 80 ? 'telemetry-val danger' : (telem.gpu.temperature_c >= 70 ? 'telemetry-val warn' : 'telemetry-val neon');
                }

                if (gpuVramEl && telem.gpu.vram_used_bytes && telem.gpu.vram_total_bytes) {
                    const usedGb = (telem.gpu.vram_used_bytes / (1024 ** 3)).toFixed(2);
                    const totalGb = (telem.gpu.vram_total_bytes / (1024 ** 3)).toFixed(2);
                    gpuVramEl.textContent = `${usedGb} / ${totalGb} GB (${telem.gpu.vram_percent || 0}%)`;
                }
                if (vramBarEl) vramBarEl.style.width = `${Math.min(100, Math.max(0, telem.gpu.vram_percent || 0))}%`;

                if (gpuPwrEl) {
                    gpuPwrEl.textContent = telem.gpu.power_watts !== null ? `${telem.gpu.power_watts} W` : 'N/A';
                }
            } else {
                if (gpuBadge) gpuBadge.textContent = 'UNAVAILABLE';
                if (gpuUtilEl) gpuUtilEl.textContent = 'N/A';
                if (gpuBarEl) gpuBarEl.style.width = '0%';
                if (gpuTempEl) gpuTempEl.textContent = 'N/A';
                if (gpuVramEl) gpuVramEl.textContent = 'N/A';
                if (vramBarEl) vramBarEl.style.width = '0%';
                if (gpuPwrEl) gpuPwrEl.textContent = 'N/A';
            }

            // 4. RAM
            const ramValEl = document.getElementById('pc-ram-val');
            const ramBarEl = document.getElementById('pc-ram-bar');
            if (telem.ram) {
                const usedGb = (telem.ram.used_bytes / (1024 ** 3)).toFixed(1);
                const totalGb = (telem.ram.total_bytes / (1024 ** 3)).toFixed(1);
                if (ramValEl) ramValEl.textContent = `${usedGb} / ${totalGb} GB (${telem.ram.percent.toFixed(1)}%)`;
                if (ramBarEl) ramBarEl.style.width = `${Math.min(100, Math.max(0, telem.ram.percent))}%`;
            }

            // 5. Storage
            const drivesContainer = document.getElementById('pc-storage-drives-container');
            if (drivesContainer && Array.isArray(telem.storage)) {
                drivesContainer.innerHTML = '';
                telem.storage.forEach(drive => {
                    const usedGb = (drive.used_bytes / (1024 ** 3)).toFixed(0);
                    const totalGb = (drive.total_bytes / (1024 ** 3)).toFixed(0);
                    const freeGb = (drive.free_bytes / (1024 ** 3)).toFixed(0);
                    const row = document.createElement('div');
                    row.style.marginBottom = '4px';
                    row.innerHTML = `
                        <div class="telemetry-row" style="padding: 2px 0;">
                            <span class="telemetry-label">${drive.drive} (${freeGb} GB FREE)</span>
                            <span class="telemetry-val cyan" style="font-size: 10px;">${usedGb}/${totalGb} GB (${drive.percent.toFixed(0)}%)</span>
                        </div>
                        <div class="meter-track" style="height: 5px; margin-top: 1px;">
                            <div class="meter-bar cyan" style="width: ${Math.min(100, Math.max(0, drive.percent))}%;"></div>
                        </div>
                    `;
                    drivesContainer.appendChild(row);
                });
            }

            // 6. Network
            const netDownEl = document.getElementById('pc-net-down-val');
            const netUpEl = document.getElementById('pc-net-up-val');
            const netTotalsEl = document.getElementById('pc-net-totals-val');

            const fmtSpeed = (bps) => {
                if (!bps || bps <= 0) return '0.0 B/s';
                if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
                if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
                return `${bps.toFixed(0)} B/s`;
            };

            if (telem.network) {
                if (netDownEl) netDownEl.textContent = `↓ ${fmtSpeed(telem.network.download_speed_bps)}`;
                if (netUpEl) netUpEl.textContent = `↑ ${fmtSpeed(telem.network.upload_speed_bps)}`;
                if (netTotalsEl) {
                    const rxGb = (telem.network.total_bytes_recv / (1024 ** 3)).toFixed(2);
                    const txGb = (telem.network.total_bytes_sent / (1024 ** 3)).toFixed(2);
                    netTotalsEl.textContent = `RX: ${rxGb} GB // TX: ${txGb} GB`;
                }
            }
        },

        renderDisconnectedTelemetry(state) {
            // When disconnected, do not fabricate fake placeholder numbers; clear bars and show disconnected indicator
            const elements = {
                'pc-cpu-pct-val': '--%',
                'pc-cpu-cores-val': '--',
                'pc-cpu-freq-val': '---- MHz',
                'pc-cpu-temp-val': '--',
                'pc-gpu-util-val': '--%',
                'pc-gpu-temp-val': '--°C',
                'pc-gpu-vram-val': '-.-- / -.-- GB',
                'pc-gpu-power-val': '-.-- W',
                'pc-ram-val': '-.-- / -.-- GB (--%)',
                'pc-uptime-val': '--',
                'pc-net-down-val': '↓ 0.0 KB/s',
                'pc-net-up-val': '↑ 0.0 KB/s',
                'pc-net-totals-val': 'RX: - GB // TX: - GB'
            };

            Object.entries(elements).forEach(([id, placeholder]) => {
                const el = document.getElementById(id);
                if (el) el.textContent = placeholder;
            });

            ['pc-cpu-bar', 'pc-gpu-bar', 'pc-vram-bar', 'pc-ram-bar'].forEach(id => {
                const bar = document.getElementById(id);
                if (bar) bar.style.width = '0%';
            });
        },

        openPairingModal() {
            const modal = document.getElementById('pairing-modal');
            const feedback = document.getElementById('pairing-status-feedback');
            if (feedback) feedback.style.display = 'none';

            const status = UIBridge.getAgentStatus ? UIBridge.getAgentStatus() : {};
            const ipInput = document.getElementById('pair-input-ip');
            const remoteInput = document.getElementById('pair-input-remote');
            const portInput = document.getElementById('pair-input-port');
            const pinInput = document.getElementById('pair-input-pin');

            if (ipInput && status.localIp) ipInput.value = status.localIp;
            if (remoteInput && status.remoteIp) remoteInput.value = status.remoteIp;
            if (portInput) portInput.value = status.port || '8765';
            if (pinInput) pinInput.value = '';

            this.selectPairMode(status.connectionMode || 'AUTO');

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

        selectPairMode(mode) {
            this._selectedPairMode = (mode || 'AUTO').toUpperCase();
            ['auto', 'local', 'remote'].forEach(m => {
                const btn = document.getElementById(`pair-mode-${m}`);
                if (btn) btn.classList.toggle('active', m === this._selectedPairMode.toLowerCase());
            });
        },

        openTailscaleGuide() {
            const guide = document.getElementById('tailscale-guide-modal');
            if (guide) guide.classList.add('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        closeTailscaleGuide() {
            const guide = document.getElementById('tailscale-guide-modal');
            if (guide) guide.classList.remove('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        submitPairing() {
            const ipInput = document.getElementById('pair-input-ip');
            const remoteInput = document.getElementById('pair-input-remote');
            const portInput = document.getElementById('pair-input-port');
            const pinInput = document.getElementById('pair-input-pin');
            const feedback = document.getElementById('pairing-status-feedback');
            const submitBtn = document.getElementById('btn-submit-pair');

            const ip = ipInput ? ipInput.value.trim() : '';
            const remote = remoteInput ? remoteInput.value.trim() : '';
            const port = portInput ? portInput.value.trim() : '8765';
            const pin = pinInput ? pinInput.value.trim() : '';
            const mode = this._selectedPairMode || 'AUTO';

            if (!ip || !pin) {
                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.textContent = 'ERROR: Workstation address and 6-Digit OTP are required.';
                    feedback.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                    feedback.style.color = '#EF4444';
                }
                AudioSynth.playChime('alert');
                UIBridge.triggerHaptic('warning');
                return;
            }

            if (feedback) {
                feedback.style.display = 'block';
                feedback.textContent = 'ESTABLISHING SECURE PAKE SESSION & PINNING TLS IDENTITY...';
                feedback.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
                feedback.style.color = '#38BDF8';
            }
            if (submitBtn) submitBtn.disabled = true;

            setTimeout(() => {
                const res = UIBridge.pairAgent(ip, port, pin, remote, mode);
                if (submitBtn) submitBtn.disabled = false;

                if (res.success) {
                    if (feedback) {
                        feedback.textContent = 'PAIRING SUCCESSFUL! TLS PINNED & CONNECTED.';
                        feedback.style.backgroundColor = 'rgba(0, 255, 71, 0.2)';
                        feedback.style.color = '#00FF47';
                    }
                    AudioSynth.playChime('success');
                    UIBridge.triggerHaptic('pulse');
                    setTimeout(() => {
                        this.closePairingModal();
                        this.updateAgentTelemetry();
                    }, 1000);
                } else {
                    if (feedback) {
                        feedback.textContent = `PAIRING FAILED: ${res.message || 'Check terminal OTP'}`;
                        feedback.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                        feedback.style.color = '#EF4444';
                    }
                    AudioSynth.playChime('alert');
                    UIBridge.triggerHaptic('alarm');
                }
            }, 100);
        },

        cycleConnectionMode() {
            const current = (UIBridge.getConnectionMode ? UIBridge.getConnectionMode() : 'AUTO').toUpperCase();
            const modes = ['AUTO', 'LOCAL', 'REMOTE'];
            const nextIdx = (modes.indexOf(current) + 1) % modes.length;
            const nextMode = modes[nextIdx];

            if (UIBridge.setConnectionMode) {
                UIBridge.setConnectionMode(nextMode);
            }
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            this.updateAgentTelemetry();
        },

        reconnectAgent() {
            UIBridge.connectAgent();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            this.updateAgentTelemetry();
        },

        unpairDevice() {
            if (confirm('REVOKE & UNPAIR WORKSTATION? Pairing credentials will be deleted from Android Keystore.')) {
                if (UIBridge.unpairAgent) {
                    UIBridge.unpairAgent();
                } else {
                    UIBridge.forgetAgentDevice();
                }
                AudioSynth.playChime('click');
                UIBridge.triggerHaptic('warning');
                this.resetPcTelemetryDisplay();
                this.updateAgentTelemetry();
            }
        },

        forgetAgent() {
            this.unpairDevice();
        },

        // =====================================================================
        // PHASE 5: WORKSTATION CONTROLS (ALLOWLIST APPS, AUDIO, MEDIA, SCREENSHOT, LOCK)
        // =====================================================================
        handleDeskOSMessage(msg) {
            if (!msg || !msg.type) return;

            switch (msg.type) {
                case 'apps_list':
                    if (Array.isArray(msg.apps)) {
                        this.renderAppsList(msg.apps);
                    }
                    break;
                case 'discovered_apps':
                    if (Array.isArray(msg.apps)) {
                        this.renderDiscoveredApps(msg.apps, msg.diagnostic);
                    }
                    break;
                case 'media_state':
                    this.renderMediaState(msg);
                    break;
                case 'running_windows':
                    const wCount = typeof msg.window_count === 'number' ? msg.window_count : (typeof msg.open_count === 'number' ? msg.open_count : (Array.isArray(msg.windows) ? msg.windows.length : 0));
                    this.renderRunningWindows(msg.windows, wCount, msg.foreground_hwnd, msg.diagnostic);
                    break;
                case 'volume_state':
                    this.renderVolumeState(msg);
                    break;
                case 'control_result':
                    this.handleControlResult(msg);
                    break;
                case 'screenshot_result':
                    this.renderScreenshotResult(msg);
                    break;
                case 'auth_success':
                    UIBridge.requestAppsList();
                    UIBridge.requestVolumeState();
                    UIBridge.requestDiscoveredApps();
                    UIBridge.requestMediaState();
                    UIBridge.requestRunningWindows();
                    break;
            }
        },

        renderDefaultApps() {
            const defaultApps = [
                { id: 'chrome', name: 'Chrome', icon: '🌐', available: false },
                { id: 'edge', name: 'Edge', icon: '🌍', available: false },
                { id: 'vscode', name: 'VS Code', icon: '💻', available: false },
                { id: 'studio', name: 'Android Studio', icon: '🤖', available: false },
                { id: 'brave', name: 'Brave', icon: '🦁', available: false },
                { id: 'terminal', name: 'Terminal', icon: '⚡', available: false },
                { id: 'calculator', name: 'Calculator', icon: '🧮', available: false },
                { id: 'notepad', name: 'Notepad', icon: '📝', available: false }
            ];
            this.renderAppsList(defaultApps);
        },

        renderAppsList(apps) {
            const container = document.getElementById('pc-app-launcher-grid');
            if (!container || !Array.isArray(apps)) return;

            container.innerHTML = '';
            apps.forEach(app => {
                const tile = document.createElement('div');
                tile.className = `app-tile ${app.available ? '' : 'disabled'}`;
                tile.title = app.available ? `Launch ${app.name}` : `${app.name} (Not Installed / Not in Allowlist)`;
                if (app.available) {
                    tile.onclick = () => this.launchPcApp(app.id);
                }
                tile.innerHTML = `
                    <div class="app-tile-icon">${app.icon || '📦'}</div>
                    <div class="app-tile-name">${app.name}</div>
                    <div class="app-tile-status">${app.available ? 'READY' : 'OFFLINE'}</div>
                `;
                container.appendChild(tile);
            });
        },

        launchPcApp(appId) {
            if (!appId) return;
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
            UIBridge.sendControlAction('launch_app', { app_id: appId });
        },

        onVolumeSliderInput(val) {
            const label = document.getElementById('pc-volume-label');
            if (label) label.textContent = `${val}%`;
        },

        onVolumeSliderChange(val) {
            AudioSynth.playChime('tick');
            const v = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
            UIBridge.sendControlAction('set_volume', { volume: v });
        },

        togglePcMute() {
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
            UIBridge.sendControlAction('toggle_mute', {});
        },

        renderVolumeState(data) {
            if (!data) return;
            const slider = document.getElementById('pc-volume-slider');
            const label = document.getElementById('pc-volume-label');
            const muteBtn = document.getElementById('btn-pc-mute');

            if (typeof data.volume === 'number') {
                if (slider && document.activeElement !== slider) {
                    slider.value = data.volume;
                }
                if (label) {
                    label.textContent = data.muted ? `MUTED (${data.volume}%)` : `${data.volume}%`;
                    label.className = data.muted ? 'telemetry-val warn' : 'telemetry-val neon';
                }
            }

            if (muteBtn && typeof data.muted === 'boolean') {
                if (data.muted) {
                    muteBtn.textContent = 'UNMUTE';
                    muteBtn.classList.add('active');
                } else {
                    muteBtn.textContent = 'MUTE';
                    muteBtn.classList.remove('active');
                }
            }
        },

        sendMediaKey(action) {
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            UIBridge.sendControlAction(action, {});
        },

        handleControlResult(result) {
            if (!result) return;
            if (result.success) {
                if (result.action === 'lock_workstation') {
                    AudioSynth.playChime('success');
                }
            } else {
                AudioSynth.playChime('alert');
                UIBridge.triggerHaptic('warning');
            }
        },

        // =====================================================================
        // CONTROL DECK 2.1: DISCOVERED APPS, GSMTC MEDIA PLAYER & TASK SWITCHER
        // =====================================================================
        renderDiscoveredApps(apps, diagnostic = null) {
            _allDiscoveredApps = Array.isArray(apps) ? apps : [];
            this._lastAppsDiagnostic = diagnostic;
            const countEl = document.getElementById('pc-apps-count-val');
            if (countEl) countEl.textContent = `${_allDiscoveredApps.length} APPS`;
            this.applyAppFilter();
        },

        selectAppCategory(category, element) {
            _selectedAppCategory = category || 'all';
            const chips = document.querySelectorAll('#pc-app-category-chips .cat-chip');
            chips.forEach(chip => chip.classList.remove('active'));
            if (element) {
                element.classList.add('active');
            }
            this.applyAppFilter();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        filterDiscoveredApps(query) {
            _appSearchQuery = (query || '').toLowerCase().trim();
            this.applyAppFilter();
        },

        applyAppFilter() {
            const container = document.getElementById('pc-discovered-apps-grid');
            if (!container) return;

            let filtered = _allDiscoveredApps.slice();
            if (_selectedAppCategory !== 'all') {
                filtered = filtered.filter(app => (app.category || 'general') === _selectedAppCategory);
            }
            if (_appSearchQuery) {
                filtered = filtered.filter(app => (app.name || '').toLowerCase().includes(_appSearchQuery));
            }
            filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (filtered.length === 0) {
                const diag = this._lastAppsDiagnostic || (_allDiscoveredApps.length === 0 ? 'NO APPLICATIONS DISCOVERED // CLICK RESCAN HOST' : 'NO MATCHING APPLICATIONS');
                container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--color-text-dim); padding: 14px 6px; font-size: 11px; font-family: var(--font-mono);">${this.escapeHtml(diag)}</div>`;
                return;
            }

            container.innerHTML = '';
            filtered.forEach(app => {
                const tile = document.createElement('div');
                tile.className = 'discovered-app-tile';
                tile.title = app.name;
                tile.onclick = () => this.launchDiscoveredApp(app.id);

                let iconHtml = '';
                const b64 = app.icon_base64 || app.icon_b64;
                if (b64) {
                    const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
                    iconHtml = `<img src="${src}" class="app-tile-icon-img" alt="">`;
                } else {
                    iconHtml = `<span style="font-size: 15px;">${this.getCategoryIcon(app.category)}</span>`;
                }

                tile.innerHTML = `
                    ${iconHtml}
                    <span class="discovered-app-name">${this.escapeHtml(app.name)}</span>
                `;
                container.appendChild(tile);
            });
        },

        launchDiscoveredApp(appId) {
            if (!appId) return;
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
            UIBridge.launchDiscoveredApp(appId);
        },

        refreshDiscoveredApps() {
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            UIBridge.requestDiscoveredApps(true);
        },

        getCategoryIcon(category) {
            switch (category) {
                case 'browser': return '🌐';
                case 'developer': return '💻';
                case 'media': return '🎵';
                case 'utility': return '🛠️';
                case 'system': return '⚙️';
                default: return '📦';
            }
        },

        formatSeconds(sec) {
            const s = Math.floor(sec || 0);
            const m = Math.floor(s / 60);
            const r = s % 60;
            return `${m}:${String(r).padStart(2, '0')}`;
        },

        renderMediaState(state) {
            _lastMediaState = state;
            const pill = document.getElementById('pc-media-status-pill');
            const titleEl = document.getElementById('pc-media-title');
            const artistEl = document.getElementById('pc-media-artist');
            const albumEl = document.getElementById('pc-media-album');
            const artImg = document.getElementById('pc-media-art-img');
            const artPlaceholder = document.getElementById('pc-media-art-placeholder');
            const curTimeEl = document.getElementById('pc-media-time-cur');
            const totalTimeEl = document.getElementById('pc-media-time-total');
            const progressBar = document.getElementById('pc-media-progress-bar');
            const playBtn = document.getElementById('btn-media-play');

            const hasSession = Boolean(state && (state.has_session || state.available || (state.title && state.title.trim().length > 0)));

            if (!hasSession) {
                if (this._mediaProgressTimer) {
                    clearInterval(this._mediaProgressTimer);
                    this._mediaProgressTimer = null;
                }
                if (pill) { pill.textContent = 'STANDBY'; pill.className = 'status-pill'; }
                if (titleEl) titleEl.textContent = 'NO ACTIVE MEDIA SESSION';
                if (artistEl) artistEl.textContent = (state && state.diagnostic) ? state.diagnostic : 'Start playback on PC (Spotify, Chrome, Brave, YouTube, etc.)';
                if (albumEl) albumEl.textContent = 'Desktop Audio Standby';
                if (artImg) { artImg.style.display = 'none'; artImg.src = ''; }
                if (artPlaceholder) artPlaceholder.style.display = 'block';
                if (curTimeEl) curTimeEl.textContent = '0:00';
                if (totalTimeEl) totalTimeEl.textContent = '0:00';
                if (progressBar) progressBar.style.width = '0%';
                if (playBtn) {
                    playBtn.textContent = '▶ PLAY';
                    playBtn.classList.remove('active');
                }
                return;
            }

            const rawStatus = (state.playback_status || state.status || 'PAUSED').toUpperCase();
            const isPlaying = rawStatus === 'PLAYING';

            if (pill) {
                pill.textContent = rawStatus;
                pill.className = `status-pill ${isPlaying ? 'active' : ''}`;
            }
            if (titleEl) titleEl.textContent = state.title || 'Unknown Track';
            if (artistEl) artistEl.textContent = state.artist || (state.source_app ? `Source: ${state.source_app}` : 'Windows Media');
            if (albumEl) albumEl.textContent = state.album ? `Album: ${state.album}` : (state.source_app ? `Application: ${state.source_app}` : 'Media Playback');

            const art = state.artwork_base64 || state.artwork_b64;
            if (art) {
                const src = art.startsWith('data:') ? art : `data:image/jpeg;base64,${art}`;
                if (artImg) {
                    artImg.src = src;
                    artImg.style.display = 'block';
                }
                if (artPlaceholder) artPlaceholder.style.display = 'none';
            } else {
                if (artImg) { artImg.style.display = 'none'; artImg.src = ''; }
                if (artPlaceholder) artPlaceholder.style.display = 'block';
            }

            const pos = state.position_seconds || 0;
            const dur = state.duration_seconds || 0;
            if (curTimeEl) curTimeEl.textContent = this.formatSeconds(pos);
            if (totalTimeEl) totalTimeEl.textContent = dur > 0 ? this.formatSeconds(dur) : '--:--';
            if (progressBar) {
                const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;
                progressBar.style.width = `${pct}%`;
            }

            // Smooth progress interpolation while playing
            if (this._mediaProgressTimer) {
                clearInterval(this._mediaProgressTimer);
                this._mediaProgressTimer = null;
            }

            if (isPlaying && dur > 0) {
                const basePos = pos;
                const baseTime = Date.now();
                this._mediaProgressTimer = setInterval(() => {
                    const elapsed = (Date.now() - baseTime) / 1000;
                    const estPos = Math.min(dur, basePos + elapsed);
                    if (curTimeEl) curTimeEl.textContent = this.formatSeconds(estPos);
                    if (progressBar) {
                        const estPct = Math.min(100, (estPos / dur) * 100);
                        progressBar.style.width = `${estPct}%`;
                    }
                }, 1000);
            }

            if (playBtn) {
                playBtn.textContent = isPlaying ? '⏸ PAUSE' : '▶ PLAY';
                playBtn.classList.toggle('active', isPlaying);
            }
        },

        togglePlayPause() {
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            const state = _lastMediaState;
            const rawStatus = (state && (state.playback_status || state.status || 'PAUSED')).toUpperCase();
            if (rawStatus === 'PLAYING') {
                // EXPLICIT PAUSE: NEVER send a toggle key that could restart music
                UIBridge.sendControlAction('media_action', { media_action: 'pause' });
            } else {
                // EXPLICIT PLAY: Only starts music when user explicitly taps Play
                UIBridge.sendControlAction('media_action', { media_action: 'play' });
            }
        },

        sendMediaAction(action) {
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            UIBridge.sendControlAction('media_action', { media_action: action });
        },

        renderRunningWindows(windows, count, fgHwnd, diagnostic = null) {
            const countEl = document.getElementById('pc-tasks-count-val');
            const grid = document.getElementById('pc-tasks-grid');
            const openCount = typeof count === 'number' ? count : (Array.isArray(windows) ? windows.length : 0);

            if (countEl) countEl.textContent = `${openCount} OPEN`;
            if (!grid) return;

            if (!Array.isArray(windows) || windows.length === 0) {
                const diag = diagnostic || 'NO ACCESSIBLE WINDOWS // OPEN AN APP ON PC';
                grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--color-text-dim); padding: 12px 6px; font-size: 11px; font-family: var(--font-mono);">${this.escapeHtml(diag)}</div>`;
                return;
            }

            grid.innerHTML = '';
            windows.forEach(w => {
                const card = document.createElement('div');
                const isFg = Boolean(w.is_foreground || (fgHwnd && w.hwnd === fgHwnd));
                const isMin = Boolean(w.is_minimized);

                // Phase 6 Requirement: Icon-only responsive cards with tooltip & active border
                card.className = `task-window-card ${isFg ? 'foreground' : ''} ${isMin ? 'minimized' : ''}`;
                card.title = `${w.title || 'Window'} (${w.process_name || 'App'}) [HWND ${w.hwnd}]`;
                card.setAttribute('aria-label', `${w.title || 'Window'}`);
                card.onclick = () => this.switchWindow(w.hwnd);

                let iconHtml = '';
                const b64 = w.icon_base64 || w.icon_b64;
                if (b64) {
                    const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
                    iconHtml = `<img src="${src}" class="task-window-icon-img" alt="" loading="lazy">`;
                } else {
                    iconHtml = `<span style="font-size: 20px;">🪟</span>`;
                }

                // NO title, process name, or HWND text inside the card - ONLY the icon!
                card.innerHTML = iconHtml;
                grid.appendChild(card);
            });
        },

        switchWindow(hwnd) {
            if (!hwnd) return;
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
            UIBridge.switchWindow(hwnd);
        },

        refreshRunningWindows() {
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
            UIBridge.requestRunningWindows();
        },

        escapeHtml(text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        requestScreenshot() {
            const modal = document.getElementById('screenshot-modal');
            const loading = document.getElementById('screenshot-loading');
            const container = document.getElementById('screenshot-container');
            const errBox = document.getElementById('screenshot-error');

            if (modal) modal.classList.add('active');
            if (loading) loading.style.display = 'flex';
            if (container) container.style.display = 'none';
            if (errBox) errBox.style.display = 'none';

            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
            UIBridge.sendControlAction('screenshot', {});
        },

        closeScreenshotModal() {
            const modal = document.getElementById('screenshot-modal');
            if (modal) modal.classList.remove('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        renderScreenshotResult(msg) {
            const loading = document.getElementById('screenshot-loading');
            const container = document.getElementById('screenshot-container');
            const previewImg = document.getElementById('screenshot-preview-img');
            const timeEl = document.getElementById('screenshot-timestamp');
            const metaEl = document.getElementById('screenshot-meta-info');
            const errBox = document.getElementById('screenshot-error');

            if (loading) loading.style.display = 'none';

            const imgB64 = msg.image_data || msg.image_b64;
            if (msg.success && imgB64) {
                if (container) container.style.display = 'block';
                if (errBox) errBox.style.display = 'none';
                if (previewImg) previewImg.src = `data:image/jpeg;base64,${imgB64}`;
                if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
                if (metaEl) {
                    const w = msg.width || 1280;
                    const h = msg.height || 720;
                    metaEl.textContent = `${w}x${h} // JPEG Q70`;
                }
                AudioSynth.playChime('success');
                UIBridge.triggerHaptic('pulse');
            } else {
                if (container) container.style.display = 'none';
                if (errBox) {
                    errBox.style.display = 'block';
                    errBox.textContent = `CAPTURE FAILED: ${msg.error || 'Workstation screen capture unavailable in this session'}`;
                }
                AudioSynth.playChime('alert');
                UIBridge.triggerHaptic('warning');
            }
        },

        promptLockWorkstation() {
            const modal = document.getElementById('lock-confirm-modal');
            if (modal) modal.classList.add('active');
            AudioSynth.playChime('alert');
            UIBridge.triggerHaptic('warning');
        },

        closeLockModal() {
            const modal = document.getElementById('lock-confirm-modal');
            if (modal) modal.classList.remove('active');
            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('click');
        },

        confirmLockWorkstation() {
            this.closeLockModal();
            AudioSynth.playChime('alarm');
            UIBridge.triggerHaptic('alarm');
            UIBridge.sendControlAction('lock_workstation', { confirm: true });
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

        setMode(mode, e = null) {
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
            currentMode = mode;

            const idleOverlay = document.getElementById('idle-overlay');
            const dimOverlay = document.getElementById('dim-overlay');
            const ssOverlay = document.getElementById('screensaver-overlay');
            const modalOverlay = document.getElementById('customize-modal');

            // Deactivate all overlays
            if (idleOverlay) idleOverlay.classList.remove('active');
            if (dimOverlay) dimOverlay.classList.remove('active');
            if (ssOverlay) ssOverlay.classList.remove('active');
            if (modalOverlay) modalOverlay.classList.remove('active');
            CanvasGraphs.stopScreensaver();

            // Clear inactivity timers when switching modes
            clearTimeout(inactivityTimer);
            clearTimeout(screensaverTimer);

            // Highlight active mode button in top navigation
            const modeBtnMap = {
                'dim': 'btn-mode-dim',
                'idle': 'btn-mode-idle',
                'screensaver': 'btn-mode-radar',
                'customize': 'btn-mode-config'
            };
            Object.values(modeBtnMap).forEach(btnId => {
                const btn = document.getElementById(btnId);
                if (btn) btn.classList.remove('active');
            });
            const activeBtnId = modeBtnMap[mode];
            if (activeBtnId) {
                const activeBtn = document.getElementById(activeBtnId);
                if (activeBtn) activeBtn.classList.add('active');
            }

            switch (mode) {
                case MODES.ACTIVE:
                    UIBridge.setBrightnessLevel(-1.0);
                    UIBridge.setScreenDimmed(false);
                    SensorsLab.startLiveStream();
                    this.resetInactivityTimer();
                    break;

                case MODES.DIM:
                    // Phase 6 Requirement: Subtle dimming (0.35 = 35% backlight). Interface remains clearly visible.
                    UIBridge.setBrightnessLevel(0.35);
                    UIBridge.setScreenDimmed(true);
                    if (dimOverlay) dimOverlay.classList.add('active');
                    SensorsLab.stopLiveStream();
                    break;

                case MODES.IDLE:
                    UIBridge.setBrightnessLevel(0.30);
                    UIBridge.setScreenDimmed(true);
                    if (idleOverlay) idleOverlay.classList.add('active');
                    SensorsLab.stopLiveStream();
                    break;

                case MODES.SCREENSAVER:
                    UIBridge.setBrightnessLevel(0.50);
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

            // ONLY arm timers when currently in ACTIVE mode!
            if (currentMode === MODES.ACTIVE) {
                inactivityTimer = setTimeout(() => {
                    this.setMode(MODES.IDLE);
                }, INACTIVITY_IDLE_MS);

                screensaverTimer = setTimeout(() => {
                    this.setMode(MODES.SCREENSAVER);
                }, INACTIVITY_SCREENSAVER_MS);
            }
        },

        bindTouchEvents() {
            const resetAction = () => {
                if (currentMode === MODES.ACTIVE) {
                    this.resetInactivityTimer();
                }
            };

            window.addEventListener('touchstart', resetAction, { passive: true });
            window.addEventListener('click', resetAction, { passive: true });
            window.addEventListener('mousemove', resetAction, { passive: true });

            // Overlays tap-to-wake explicitly
            ['dim-overlay', 'idle-overlay', 'screensaver-overlay'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.setMode(MODES.ACTIVE, e);
                    });
                }
            });
        }
    };
})();

// Expose globally for inline DOM event handlers
window.DeskOS = DeskOS;

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    DeskOS.init();
});
