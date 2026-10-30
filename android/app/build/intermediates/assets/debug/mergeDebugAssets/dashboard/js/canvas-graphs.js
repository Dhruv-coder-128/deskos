/**
 * DESK OS — High-Efficiency Canvas 2D Graphics Engine
 * Lightweight sparklines and 5 FPS low-power screensaver radar.
 */

const CanvasGraphs = (() => {
    // Sparkline Buffer
    const SPARKLINE_MAX_POINTS = 30;
    const vibrationHistory = new Array(SPARKLINE_MAX_POINTS).fill(0);

    let sparklineCanvas = null;
    let sparklineCtx = null;

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

            // Throttled to 5 FPS (200ms per frame) to prevent battery drain on Samsung M01s LCD
            screensaverInterval = setInterval(() => {
                this.renderScreensaverFrame();
            }, 200);
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
            const radius = Math.min(cx, cy) * 0.75;

            screensaverCtx.clearRect(0, 0, w, h);

            // Concentric Radar Rings
            screensaverCtx.strokeStyle = 'rgba(0, 255, 71, 0.15)';
            screensaverCtx.lineWidth = 1;

            [0.3, 0.6, 1.0].forEach(factor => {
                screensaverCtx.beginPath();
                screensaverCtx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
                screensaverCtx.stroke();
            });

            // Crosshairs
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx - radius * 1.05, cy);
            screensaverCtx.lineTo(cx + radius * 1.05, cy);
            screensaverCtx.moveTo(cx, cy - radius * 1.05);
            screensaverCtx.lineTo(cx, cy + radius * 1.05);
            screensaverCtx.stroke();

            // Rotating Scanner Sweep (5 FPS increment: 0.1 rad per frame)
            screensaverAngle += 0.1;
            if (screensaverAngle > Math.PI * 2) screensaverAngle = 0;

            const sweepX = cx + Math.cos(screensaverAngle) * radius;
            const sweepY = cy + Math.sin(screensaverAngle) * radius;

            screensaverCtx.strokeStyle = '#00FF47';
            screensaverCtx.lineWidth = 2;
            screensaverCtx.beginPath();
            screensaverCtx.moveTo(cx, cy);
            screensaverCtx.lineTo(sweepX, sweepY);
            screensaverCtx.stroke();

            // Terminal Coordinate Readout
            screensaverCtx.fillStyle = '#38BDF8';
            screensaverCtx.font = '11px monospace';
            screensaverCtx.fillText(`BEACON: ACTIVE | SWEEP: ${(screensaverAngle * (180 / Math.PI)).toFixed(0)}°`, 20, 30);
            screensaverCtx.fillText('STATUS: LOW-POWER 5 FPS STANDBY', 20, 48);
        },

        resizeCanvas(canvas) {
            if (!canvas) return;
            canvas.width = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
            canvas.height = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
        }
    };
})();

