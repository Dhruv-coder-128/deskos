/**
 * DESK OS — High-Efficiency Canvas 2D Graphics Engine
 * Lightweight sparklines and 5 FPS low-power screensaver radar.
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
            const radius = Math.min(cx, cy) * 0.76;

            // Restrained dark slate background
            screensaverCtx.fillStyle = '#070b10';
            screensaverCtx.fillRect(0, 0, w, h);

            // 1. Concentric Radar Rings & Range Labels
            const rings = [0.25, 0.5, 0.75, 1.0];
            const labels = ['50m', '100m', '150m', '200m'];
            screensaverCtx.lineWidth = 1;

            rings.forEach((factor, idx) => {
                const r = radius * factor;
                screensaverCtx.strokeStyle = factor === 1.0 ? 'rgba(0, 255, 71, 0.35)' : 'rgba(0, 255, 71, 0.14)';
                screensaverCtx.beginPath();
                screensaverCtx.arc(cx, cy, r, 0, Math.PI * 2);
                screensaverCtx.stroke();

                screensaverCtx.fillStyle = 'rgba(56, 189, 248, 0.45)';
                screensaverCtx.font = '8px monospace';
                screensaverCtx.fillText(labels[idx], cx + 4, cy - r + 10);
            });

            // 2. 8-Axis Radial Crosshairs
            screensaverCtx.strokeStyle = 'rgba(0, 255, 71, 0.12)';
            for (let i = 0; i < 8; i++) {
                const angle = (i * Math.PI) / 4;
                const x2 = cx + Math.cos(angle) * (radius * 1.03);
                const y2 = cy + Math.sin(angle) * (radius * 1.03);
                screensaverCtx.beginPath();
                screensaverCtx.moveTo(cx, cy);
                screensaverCtx.lineTo(x2, y2);
                screensaverCtx.stroke();
            }

            // Outer azimuth ticks
            screensaverCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            for (let deg = 0; deg < 360; deg += 30) {
                const rad = (deg * Math.PI) / 180;
                const innerX = cx + Math.cos(rad) * (radius - 4);
                const innerY = cy + Math.sin(rad) * (radius - 4);
                const outerX = cx + Math.cos(rad) * radius;
                const outerY = cy + Math.sin(rad) * radius;
                screensaverCtx.beginPath();
                screensaverCtx.moveTo(innerX, innerY);
                screensaverCtx.lineTo(outerX, outerY);
                screensaverCtx.stroke();
            }

            // 3. Rotating Radar Sweep (20 FPS increment)
            screensaverAngle = (screensaverAngle + 0.045) % (Math.PI * 2);

            // 4. Phosphor Trail (Fan wedge behind sweep)
            const trailAngle = 0.42;
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx, cy);
            screensaverCtx.arc(cx, cy, radius, screensaverAngle - trailAngle, screensaverAngle);
            screensaverCtx.closePath();
            const grad = screensaverCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            grad.addColorStop(0, 'rgba(0, 255, 71, 0.18)');
            grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.08)');
            grad.addColorStop(1, 'rgba(0, 255, 71, 0.01)');
            screensaverCtx.fillStyle = grad;
            screensaverCtx.fill();

            // 5. Crisp Sweep Line
            const sweepX = cx + Math.cos(screensaverAngle) * radius;
            const sweepY = cy + Math.sin(screensaverAngle) * radius;
            screensaverCtx.strokeStyle = '#00FF47';
            screensaverCtx.lineWidth = 1.5;
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx, cy);
            screensaverCtx.lineTo(sweepX, sweepY);
            screensaverCtx.stroke();

            // 6. Dynamic Cyber Targets with Sweep Ping
            if (!this._cyberTargets) {
                this._cyberTargets = [
                    { id: 'PC-HOST', a: 0.85, r: 0.55, speed: 0.003, lastSweep: 0, label: 'PC-HOST' },
                    { id: 'LAN-GATEWAY', a: 2.30, r: 0.72, speed: -0.002, lastSweep: 0, label: 'LAN-GW' },
                    { id: 'MOBILE-NODE', a: 4.10, r: 0.38, speed: 0.004, lastSweep: 0, label: 'MOBILE' },
                    { id: 'TAILSCALE', a: 5.40, r: 0.82, speed: -0.003, lastSweep: 0, label: 'TAILSCALE' }
                ];
            }
            const now = Date.now();
            this._cyberTargets.forEach(t => {
                t.a = (t.a + t.speed) % (Math.PI * 2);
                if (t.a < 0) t.a += Math.PI * 2;

                let angleDiff = Math.abs(screensaverAngle - t.a);
                if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                if (angleDiff < 0.06) {
                    t.lastSweep = now;
                }

                const elapsed = now - t.lastSweep;
                const isPing = elapsed < 1200;
                const pingFactor = isPing ? Math.max(0, 1 - elapsed / 1200) : 0;

                const tx = cx + Math.cos(t.a) * (radius * t.r);
                const ty = cy + Math.sin(t.a) * (radius * t.r);

                if (isPing && pingFactor > 0.05) {
                    screensaverCtx.strokeStyle = 
gba(0, 255, 71, );
                    screensaverCtx.lineWidth = 1;
                    screensaverCtx.beginPath();
                    screensaverCtx.arc(tx, ty, 4 + (1 - pingFactor) * 12, 0, Math.PI * 2);
                    screensaverCtx.stroke();
                }

                screensaverCtx.fillStyle = isPing ? '#00FF47' : 'rgba(56, 189, 248, 0.6)';
                screensaverCtx.beginPath();
                screensaverCtx.arc(tx, ty, isPing ? 3.5 : 2.5, 0, Math.PI * 2);
                screensaverCtx.fill();

                screensaverCtx.fillStyle = isPing ? '#00FF47' : 'rgba(156, 163, 175, 0.6)';
                screensaverCtx.font = '8px monospace';
                screensaverCtx.fillText(t.label, tx + 6, ty - 2);
            });

            // 7. Tactical Corner Telemetry HUD
            const deg = Math.round((screensaverAngle * 180) / Math.PI);
            screensaverCtx.fillStyle = '#00FF47';
            screensaverCtx.font = '10px monospace';
            screensaverCtx.fillText("CYBER RADAR // AZIMUTH: " + deg + " DEG", 14, 22);

            screensaverCtx.fillStyle = '#38BDF8';
            screensaverCtx.font = '9px monospace';
            screensaverCtx.fillText("TARGETS: " + this._cyberTargets.length + " ACTIVE // SPECTRUM SECURE", 14, 36);

            screensaverCtx.fillStyle = 'rgba(156, 163, 175, 0.6)';
            screensaverCtx.fillText('[ TAP ANYWHERE TO EXIT RADAR ]', 14, h - 14);
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

