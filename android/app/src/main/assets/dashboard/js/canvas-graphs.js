/**
 * DESK OS — High-Efficiency Canvas 2D Graphics Engine
 * Lightweight sparklines and Cyber Radar 2.0 tactical display.
 */

const CanvasGraphs = (() => {
    // Sparkline Buffer (Phone Accelerometer Vibration)
    const SPARKLINE_MAX_POINTS = 30;
    const vibrationHistory = new Array(SPARKLINE_MAX_POINTS).fill(0);

    let sparklineCanvas = null;
    let sparklineCtx = null;

    // Workstation CPU Sparkline Buffer (Phase 4 Live PC Telemetry)
    const CPU_GRAPH_MAX_POINTS = 30;
    const cpuHistory = new Array(CPU_GRAPH_MAX_POINTS).fill(0);
    let cpuCanvas = null;
    let cpuCtx = null;

    let screensaverCanvas = null;
    let screensaverCtx = null;
    let screensaverAngle = 0;
    let screensaverInterval = null;

    return {
        initSparkline(canvasId) {
            sparklineCanvas = document.getElementById(canvasId);
            if (!sparklineCanvas) return;
            sparklineCtx = sparklineCanvas.getContext('2d');
            this.resizeCanvas(sparklineCanvas);
        },

        initCpuGraph(canvasId) {
            cpuCanvas = document.getElementById(canvasId);
            if (!cpuCanvas) return;
            cpuCtx = cpuCanvas.getContext('2d');
            this.resizeCanvas(cpuCanvas);
            this.renderCpuGraph();
        },

        addCpuPoint(val) {
            const clamped = Math.max(0, Math.min(100, typeof val === 'number' ? val : 0));
            cpuHistory.push(clamped);
            if (cpuHistory.length > CPU_GRAPH_MAX_POINTS) {
                cpuHistory.shift();
            }
            this.renderCpuGraph();
        },

        renderCpuGraph() {
            if (!cpuCtx || !cpuCanvas) return;
            if (cpuCanvas.width <= 0 || cpuCanvas.height <= 0) {
                this.resizeCanvas(cpuCanvas);
            }

            const w = cpuCanvas.width;
            const h = cpuCanvas.height;
            if (w <= 0 || h <= 0) return;
            cpuCtx.clearRect(0, 0, w, h);

            // Grid guidelines (25%, 50%, 75%)
            cpuCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            cpuCtx.lineWidth = 1;
            [0.25, 0.5, 0.75].forEach(pct => {
                cpuCtx.beginPath();
                cpuCtx.moveTo(0, h * pct);
                cpuCtx.lineTo(w, h * pct);
                cpuCtx.stroke();
            });

            // CPU load wave trace
            const step = w / (CPU_GRAPH_MAX_POINTS - 1);
            cpuCtx.beginPath();
            cpuCtx.strokeStyle = '#00FF47';
            cpuCtx.lineWidth = 2;

            for (let i = 0; i < cpuHistory.length; i++) {
                const norm = cpuHistory[i] / 100.0;
                const y = h - (norm * (h - 6)) - 3;
                const x = i * step;

                if (i === 0) cpuCtx.moveTo(x, y);
                else cpuCtx.lineTo(x, y);
            }
            cpuCtx.stroke();

            // Gradient Fill beneath curve
            cpuCtx.lineTo(w, h);
            cpuCtx.lineTo(0, h);
            cpuCtx.closePath();
            const grad = cpuCtx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(0, 255, 71, 0.28)');
            grad.addColorStop(1, 'rgba(0, 255, 71, 0.0)');
            cpuCtx.fillStyle = grad;
            cpuCtx.fill();
        },

        addVibrationPoint(val) {
            vibrationHistory.push(Math.min(val, 15));
            if (vibrationHistory.length > SPARKLINE_MAX_POINTS) {
                vibrationHistory.shift();
            }
            this.renderSparkline();
        },

        renderSparkline() {
            if (!sparklineCtx || !sparklineCanvas) return;
            if (sparklineCanvas.width <= 0 || sparklineCanvas.height <= 0) {
                this.resizeCanvas(sparklineCanvas);
            }

            const w = sparklineCanvas.width;
            const h = sparklineCanvas.height;
            if (w <= 0 || h <= 0) return;
            sparklineCtx.clearRect(0, 0, w, h);

            // Subtle background grid
            sparklineCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sparklineCtx.lineWidth = 1;
            sparklineCtx.beginPath();
            sparklineCtx.moveTo(0, h * 0.5);
            sparklineCtx.lineTo(w, h * 0.5);
            sparklineCtx.stroke();

            // Vibration Waveform Trace
            const step = w / (SPARKLINE_MAX_POINTS - 1);
            sparklineCtx.beginPath();
            sparklineCtx.strokeStyle = '#00FF47';
            sparklineCtx.lineWidth = 2;

            for (let i = 0; i < vibrationHistory.length; i++) {
                const norm = Math.min(vibrationHistory[i] / 5.0, 1.0);
                const y = h - (norm * (h - 6)) - 3;
                const x = i * step;

                if (i === 0) sparklineCtx.moveTo(x, y);
                else sparklineCtx.lineTo(x, y);
            }
            sparklineCtx.stroke();

            // Gradient Fill beneath curve
            sparklineCtx.lineTo(w, h);
            sparklineCtx.lineTo(0, h);
            sparklineCtx.closePath();
            const grad = sparklineCtx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(0, 255, 71, 0.25)');
            grad.addColorStop(1, 'rgba(0, 255, 71, 0.0)');
            sparklineCtx.fillStyle = grad;
            sparklineCtx.fill();
        },

        initScreensaver(canvasId) {
            screensaverCanvas = document.getElementById(canvasId);
            if (!screensaverCanvas) return;
            screensaverCtx = screensaverCanvas.getContext('2d');
            this.resizeCanvas(screensaverCanvas);
        },

        startScreensaver() {
            if (!screensaverCtx || screensaverInterval) return;
            this.resizeCanvas(screensaverCanvas);

            // Controlled 20 FPS (50ms per frame) - battery optimized for 3GB RAM, silky smooth sweep
            screensaverInterval = setInterval(() => {
                this.renderScreensaverFrame();
            }, 50);
        },

        stopScreensaver() {
            if (screensaverInterval) {
                clearInterval(screensaverInterval);
                screensaverInterval = null;
            }
        },

        renderScreensaverFrame() {
            if (!screensaverCtx || !screensaverCanvas) return;
            if (screensaverCanvas.width <= 0 || screensaverCanvas.height <= 0) {
                this.resizeCanvas(screensaverCanvas);
            }

            const w = screensaverCanvas.width;
            const h = screensaverCanvas.height;
            if (w <= 0 || h <= 0) return;
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.min(cx, cy) * 0.74;
            if (radius <= 10) return;

            // Restrained dark tactical background
            screensaverCtx.fillStyle = '#060a0f';
            screensaverCtx.fillRect(0, 0, w, h);

            const hasRadarEngine = typeof RadarEngine !== 'undefined';
            const observer = hasRadarEngine ? RadarEngine.getObserver() : { label: 'Local Station' };
            const currentRange = hasRadarEngine ? RadarEngine.getRange() : 100;
            const targets = hasRadarEngine ? RadarEngine.getAllTargets() : [];

            // 1. Concentric Radar Range Rings
            const rings = [0.25, 0.5, 0.75, 1.0];
            screensaverCtx.lineWidth = 1;

            rings.forEach((factor) => {
                const r = radius * factor;
                screensaverCtx.strokeStyle = factor === 1.0 ? 'rgba(0, 255, 71, 0.40)' : 'rgba(0, 255, 71, 0.15)';
                screensaverCtx.beginPath();
                screensaverCtx.arc(cx, cy, r, 0, Math.PI * 2);
                screensaverCtx.stroke();

                // Range label on Y-axis
                screensaverCtx.fillStyle = 'rgba(56, 189, 248, 0.55)';
                screensaverCtx.font = '9px monospace';
                const distLabel = Math.round(currentRange * factor) + ' km';
                screensaverCtx.fillText(distLabel, cx + 5, cy - r + 11);
            });

            // 2. 8-Axis Radial Crosshairs
            screensaverCtx.strokeStyle = 'rgba(0, 255, 71, 0.12)';
            for (let i = 0; i < 8; i++) {
                const angle = (i * Math.PI) / 4;
                const x2 = cx + Math.cos(angle) * (radius * 1.02);
                const y2 = cy + Math.sin(angle) * (radius * 1.02);
                screensaverCtx.beginPath();
                screensaverCtx.moveTo(cx, cy);
                screensaverCtx.lineTo(x2, y2);
                screensaverCtx.stroke();
            }

            // 3. Outer Azimuth Ticks & True Cardinal Directions (0° North = Top)
            const cardinals = [
                { deg: 0, label: 'N', color: '#00FF47' },
                { deg: 45, label: 'NE', color: '#38BDF8' },
                { deg: 90, label: 'E', color: '#38BDF8' },
                { deg: 135, label: 'SE', color: '#38BDF8' },
                { deg: 180, label: 'S', color: '#38BDF8' },
                { deg: 225, label: 'SW', color: '#38BDF8' },
                { deg: 270, label: 'W', color: '#38BDF8' },
                { deg: 315, label: 'NW', color: '#38BDF8' }
            ];

            // Outer degree ticks every 15°
            for (let deg = 0; deg < 360; deg += 15) {
                const rad = ((deg - 90) * Math.PI) / 180.0;
                const isMajor = deg % 45 === 0;
                const innerR = radius - (isMajor ? 6 : 3);
                screensaverCtx.strokeStyle = isMajor ? 'rgba(56, 189, 248, 0.5)' : 'rgba(56, 189, 248, 0.2)';
                screensaverCtx.beginPath();
                screensaverCtx.moveTo(cx + Math.cos(rad) * innerR, cy + Math.sin(rad) * innerR);
                screensaverCtx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
                screensaverCtx.stroke();
            }

            // Cardinal labels
            cardinals.forEach(c => {
                const rad = ((c.deg - 90) * Math.PI) / 180.0;
                const lx = cx + Math.cos(rad) * (radius + 14);
                const ly = cy + Math.sin(rad) * (radius + 14);
                screensaverCtx.fillStyle = c.color;
                screensaverCtx.font = c.deg === 0 ? 'bold 11px monospace' : '9px monospace';
                screensaverCtx.textAlign = 'center';
                screensaverCtx.textBaseline = 'middle';
                screensaverCtx.fillText(c.label, lx, ly);
            });
            screensaverCtx.textAlign = 'left';
            screensaverCtx.textBaseline = 'alphabetic';

            // 4. Rotating Radar Sweep (20 FPS increment)
            screensaverAngle = (screensaverAngle + 0.045) % (Math.PI * 2);

            // 5. Phosphor Trail (Fan wedge behind sweep)
            const trailAngle = 0.45;
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx, cy);
            screensaverCtx.arc(cx, cy, radius, screensaverAngle - trailAngle, screensaverAngle);
            screensaverCtx.closePath();
            const grad = screensaverCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            grad.addColorStop(0, 'rgba(0, 255, 71, 0.22)');
            grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.07)');
            grad.addColorStop(1, 'rgba(0, 255, 71, 0.01)');
            screensaverCtx.fillStyle = grad;
            screensaverCtx.fill();

            // 6. Crisp Sweep Line
            const sweepX = cx + Math.cos(screensaverAngle) * radius;
            const sweepY = cy + Math.sin(screensaverAngle) * radius;
            screensaverCtx.strokeStyle = '#00FF47';
            screensaverCtx.lineWidth = 1.5;
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx, cy);
            screensaverCtx.lineTo(sweepX, sweepY);
            screensaverCtx.stroke();

            // 7. Dynamic Targets from RadarEngine with Sweep Ping
            const now = Date.now();
            targets.forEach(t => {
                const bearingDeg = t.bearingDeg != null ? t.bearingDeg : 0;
                // Standard navigation bearing (0° = North = -Y axis on screen)
                const rad = ((bearingDeg - 90) * Math.PI) / 180.0;

                let rFactor = 0.5;
                if (t.type === 'AIRCRAFT') {
                    rFactor = Math.min(0.98, Math.max(0.08, t.distanceKm / currentRange));
                } else if (t.radialFactor != null) {
                    rFactor = t.radialFactor;
                }

                const tx = cx + Math.cos(rad) * (radius * rFactor);
                const ty = cy + Math.sin(rad) * (radius * rFactor);

                // Store screen coordinates for tactile tap selection
                t._screenX = tx;
                t._screenY = ty;

                // Ping calculation
                const normalizedRad = ((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                let angleDiff = Math.abs(screensaverAngle - normalizedRad);
                if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                if (angleDiff < 0.08) {
                    t.lastSweep = now;
                }

                const elapsed = now - (t.lastSweep || 0);
                const isPing = elapsed < 1400;
                const pingFactor = isPing ? Math.max(0, 1 - elapsed / 1400) : 0;

                // Echo wave when swept
                if (isPing && pingFactor > 0.05) {
                    screensaverCtx.strokeStyle = 'rgba(0, 255, 71, ' + (pingFactor * 0.7).toFixed(2) + ')';
                    screensaverCtx.lineWidth = 1;
                    screensaverCtx.beginPath();
                    screensaverCtx.arc(tx, ty, 5 + (1 - pingFactor) * 14, 0, Math.PI * 2);
                    screensaverCtx.stroke();
                }

                // Render distinctive glyphs by target type
                if (t.type === 'AIRCRAFT') {
                    // Aircraft chevron rotated by heading
                    screensaverCtx.save();
                    screensaverCtx.translate(tx, ty);
                    const headingRad = ((t.headingDeg != null ? t.headingDeg : bearingDeg) - 90) * Math.PI / 180.0;
                    screensaverCtx.rotate(headingRad);

                    const acColor = t.onGround ? '#F59E0B' : (isPing ? '#00FF47' : 'rgba(0, 255, 71, 0.75)');
                    screensaverCtx.fillStyle = acColor;
                    screensaverCtx.strokeStyle = acColor;
                    screensaverCtx.lineWidth = 1;

                    // Tactical arrow glyph
                    screensaverCtx.beginPath();
                    screensaverCtx.moveTo(7, 0);
                    screensaverCtx.lineTo(-5, -4);
                    screensaverCtx.lineTo(-2, 0);
                    screensaverCtx.lineTo(-5, 4);
                    screensaverCtx.closePath();
                    screensaverCtx.fill();
                    screensaverCtx.restore();

                    // Aircraft label
                    screensaverCtx.fillStyle = isPing ? '#00FF47' : '#94A3B8';
                    screensaverCtx.font = '8px monospace';
                    screensaverCtx.fillText(`${t.callsign} [${t.distanceKm}k]`, tx + 7, ty - 3);

                } else if (t.type === 'BLUETOOTH') {
                    // BLE Diamond Glyph
                    const bleColor = isPing ? '#38BDF8' : 'rgba(56, 189, 248, 0.75)';
                    screensaverCtx.fillStyle = bleColor;
                    screensaverCtx.beginPath();
                    screensaverCtx.moveTo(tx, ty - 4);
                    screensaverCtx.lineTo(tx + 4, ty);
                    screensaverCtx.lineTo(tx, ty + 4);
                    screensaverCtx.lineTo(tx - 4, ty);
                    screensaverCtx.closePath();
                    screensaverCtx.fill();

                    screensaverCtx.fillStyle = isPing ? '#38BDF8' : '#94A3B8';
                    screensaverCtx.font = '8px monospace';
                    screensaverCtx.fillText(`${(t.name || 'BLE').substring(0, 11)}`, tx + 7, ty - 2);

                } else if (t.type === 'TAILSCALE') {
                    // Tailscale Mesh Node (Purple Glyph)
                    screensaverCtx.fillStyle = isPing ? '#C084FC' : '#A855F7';
                    screensaverCtx.beginPath();
                    screensaverCtx.arc(tx, ty, 3.5, 0, Math.PI * 2);
                    screensaverCtx.fill();

                    screensaverCtx.fillStyle = '#C084FC';
                    screensaverCtx.font = '8px monospace';
                    screensaverCtx.fillText(`${(t.hostname || t.ip)} [TS]`, tx + 6, ty - 2);

                } else if (t.type === 'HOST') {
                    // Main DESK OS Workstation (Cyan Double Ring)
                    screensaverCtx.fillStyle = '#00F0FF';
                    screensaverCtx.beginPath();
                    screensaverCtx.arc(tx, ty, 4, 0, Math.PI * 2);
                    screensaverCtx.fill();
                    screensaverCtx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
                    screensaverCtx.lineWidth = 1;
                    screensaverCtx.beginPath();
                    screensaverCtx.arc(tx, ty, 7, 0, Math.PI * 2);
                    screensaverCtx.stroke();

                    screensaverCtx.fillStyle = '#00F0FF';
                    screensaverCtx.font = 'bold 8px monospace';
                    screensaverCtx.fillText(`HOST PC [LOQ]`, tx + 9, ty - 2);

                } else {
                    // LAN Node (Emerald Square)
                    screensaverCtx.fillStyle = isPing ? '#10B981' : 'rgba(16, 185, 129, 0.7)';
                    screensaverCtx.fillRect(tx - 3, ty - 3, 6, 6);

                    screensaverCtx.fillStyle = '#94A3B8';
                    screensaverCtx.font = '8px monospace';
                    screensaverCtx.fillText(`${t.hostname || t.ip}`, tx + 6, ty - 2);
                }
            });

            // 8. Tactical Telemetry HUD in Bottom-Left Corner (Clean, zero overlap with top HUD buttons)
            screensaverCtx.fillStyle = 'rgba(0, 255, 71, 0.8)';
            screensaverCtx.font = '10px monospace';
            screensaverCtx.fillText(`CYBER RADAR 2.0 // OBSERVER: ${observer.label}`, 14, h - 38);

            const acCount = targets.filter(t => t.type === 'AIRCRAFT').length;
            const bleCount = targets.filter(t => t.type === 'BLUETOOTH').length;
            const netCount = targets.filter(t => t.type !== 'AIRCRAFT' && t.type !== 'BLUETOOTH').length;

            screensaverCtx.fillStyle = '#38BDF8';
            screensaverCtx.font = '9px monospace';
            screensaverCtx.fillText(`RANGE: ${currentRange} KM // TRACKS: ${targets.length} TOTAL (${acCount} AC, ${bleCount} BLE, ${netCount} NET)`, 14, h - 25);

            screensaverCtx.fillStyle = 'rgba(156, 163, 175, 0.6)';
            screensaverCtx.fillText('[ TAP ANY TARGET FOR TELEMETRY // USE TOP HUD CONTROLS ]', 14, h - 12);
        },

        handleRadarClick(clientX, clientY) {
            if (!screensaverCanvas) return false;
            const rect = screensaverCanvas.getBoundingClientRect();
            const clickX = clientX - rect.left;
            const clickY = clientY - rect.top;

            if (typeof RadarEngine === 'undefined') return false;
            const targets = RadarEngine.getAllTargets();
            let closestTarget = null;
            let minDistance = 28; // 28px touch tolerance

            targets.forEach(t => {
                if (t._screenX != null && t._screenY != null) {
                    const dx = clickX - t._screenX;
                    const dy = clickY - t._screenY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestTarget = t;
                    }
                }
            });

            if (closestTarget) {
                RadarEngine.selectTarget(closestTarget);
                return true;
            }
            return false;
        },

        resizeCanvas(canvas) {
            if (!canvas) return;
            canvas.width = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
            canvas.height = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
        }
    };
})();

window.addEventListener('resize', () => {
    CanvasGraphs.resizeCanvas(document.getElementById('sensor-sparkline'));
    const cpuCanvas = document.getElementById('pc-cpu-sparkline');
    if (cpuCanvas) {
        CanvasGraphs.resizeCanvas(cpuCanvas);
        CanvasGraphs.renderCpuGraph();
    }
    CanvasGraphs.resizeCanvas(document.getElementById('screensaver-canvas'));
});
