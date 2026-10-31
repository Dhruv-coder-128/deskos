/**
 * DESK OS — Live PC Monitor 2.0 Engine
 * Real-time hardware telemetry and responsive oscilloscope visualization
 * for Lenovo LOQ 15IRX9 (Intel Core i5-13450HX 16-thread & NVIDIA RTX 3050 6GB GDDR6).
 */

const PCMonitor = (function () {
    'use strict';

    let activeRefreshRateSec = 1.0;
    const MAX_HISTORY = 40;
    const history = {
        cpu: [],
        gpu: [],
        netDown: [],
        netUp: []
    };

    const analytics = {
        cpu: { min: 100, max: 0, peak: 0, sum: 0, count: 0 },
        gpu: { min: 100, max: 0, peak: 0, sum: 0, count: 0 },
        ram: { min: 100, max: 0, peak: 0, sum: 0, count: 0 },
        temp: { min: 120, max: 0, peak: 0, sum: 0, count: 0 }
    };

    function init() {
        console.log('[PCMonitor 2.0] Initializing Live PC Monitor Engine...');
        bindControls();
        setupGraphCanvases();
        window.addEventListener('resize', debounce(setupGraphCanvases, 150));
    }

    function setupGraphCanvases() {
        ['graph-cpu-hist', 'graph-gpu-hist', 'graph-net-hist'].forEach(id => {
            const canvas = document.getElementById(id);
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const width = rect.width > 0 ? rect.width : (canvas.parentElement ? canvas.parentElement.clientWidth : 280);
                canvas.width = Math.floor(Math.max(200, width) * dpr);
                canvas.height = Math.floor(85 * dpr);
            }
        });
    }

    function bindControls() {
        const rateBtns = document.querySelectorAll('.rate-toggle-btn');
        rateBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                rateBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeRefreshRateSec = parseFloat(btn.dataset.rate || 1.0);
                if (typeof UIBridge !== 'undefined') {
                    UIBridge.triggerHaptic('click');
                }
            });
        });
    }

    function updateTelemetry(data) {
        if (!data) return;

        const cpu = data.cpu || {};
        const gpu = data.gpu || {};
        const ram = data.ram || {};
        const storage = data.storage || {};
        const net = data.network || {};
        const sys = data.system || {};

        // 1. Host Info Bar
        if (sys.hostname) updateElementText('mon-pc-model', `Lenovo LOQ 15IRX9 (${sys.hostname})`);
        if (sys.power_plan) updateElementText('mon-pc-powerplan', sys.power_plan.toUpperCase());
        if (sys.battery_percent !== null && sys.battery_percent !== undefined) {
            const acPlugged = sys.ac_plugged ? '⚡ [AC PLUGGED]' : '[BATTERY]';
            updateElementText('mon-battery-badge', `BAT: ${Math.round(sys.battery_percent)}% ${acPlugged}`);
        }

        // 2. CPU Metrics (Intel i5-13450HX)
        const cpuOverall = typeof cpu.overall_percent === 'number' ? cpu.overall_percent : 0;
        updateElementText('mon-cpu-pct', `${cpuOverall.toFixed(1)}%`);
        if (cpu.frequency_mhz) updateElementText('mon-cpu-freq', `${Math.round(cpu.frequency_mhz)} MHz`);
        if (cpu.core_count) updateElementText('mon-cpu-cores', `${cpu.core_count} Cores / 16T`);
        if (cpu.model) updateElementText('mon-cpu-name', cpu.model.toUpperCase());

        const cpuTempText = (cpu.temperature_c !== null && cpu.temperature_c !== undefined) 
            ? `${Math.round(cpu.temperature_c)}°C` 
            : 'N/A';
        updateElementText('mon-cpu-temp', cpuTempText);

        const cpuMeter = document.getElementById('mon-cpu-meter-fill');
        if (cpuMeter) {
            cpuMeter.style.width = `${Math.min(100, Math.max(0, cpuOverall))}%`;
            cpuMeter.style.backgroundColor = cpuOverall >= 85 ? 'var(--color-status-error)' : (cpuOverall >= 60 ? 'var(--color-accent-amber)' : 'var(--color-accent-primary)');
        }

        // 16-Thread grid
        renderCpuThreadsGrid(cpu.per_core_percent || []);

        // 3. GPU Metrics (RTX 3050 Laptop)
        const gpuUtil = typeof gpu.utilization_percent === 'number' ? gpu.utilization_percent : 0;
        updateElementText('mon-gpu-pct', `${gpuUtil.toFixed(1)}%`);
        if (gpu.name) updateElementText('mon-gpu-name', gpu.name.toUpperCase());
        if (gpu.graphics_clock_mhz) updateElementText('mon-gpu-clock-gfx', `${gpu.graphics_clock_mhz} MHz GFX`);
        if (gpu.memory_clock_mhz) updateElementText('mon-gpu-clock-mem', `${gpu.memory_clock_mhz} MHz MEM`);
        if (gpu.power_draw_w !== null && gpu.power_draw_w !== undefined) {
            updateElementText('mon-gpu-power', `${gpu.power_draw_w.toFixed(1)} W`);
        }
        if (gpu.temperature_c !== null && gpu.temperature_c !== undefined) {
            updateElementText('mon-gpu-temp', `${Math.round(gpu.temperature_c)}°C`);
            updateAnalytics('temp', gpu.temperature_c);
        }

        const gpuMeter = document.getElementById('mon-gpu-meter-fill');
        if (gpuMeter) {
            gpuMeter.style.width = `${Math.min(100, Math.max(0, gpuUtil))}%`;
        }

        // Dedicated & Shared VRAM
        const vramUsedGB = gpu.vram_used_bytes ? (gpu.vram_used_bytes / (1024 ** 3)).toFixed(2) : '0.00';
        const vramTotalGB = gpu.vram_total_bytes ? (gpu.vram_total_bytes / (1024 ** 3)).toFixed(1) : '6.0';
        const vramDedicatedPct = gpu.vram_total_bytes ? Math.round((gpu.vram_used_bytes / gpu.vram_total_bytes) * 100) : 0;
        updateElementText('mon-vram-text', `${vramUsedGB} GB / ${vramTotalGB} GB (${vramDedicatedPct}%)`);
        const vramMeter = document.getElementById('mon-vram-meter-fill');
        if (vramMeter) {
            vramMeter.style.width = `${Math.min(100, vramDedicatedPct)}%`;
        }

        // 4. Memory & Storage Metrics
        const ramUsedGB = ram.used_bytes ? (ram.used_bytes / (1024 ** 3)).toFixed(1) : '0.0';
        const ramTotalGB = ram.total_bytes ? (ram.total_bytes / (1024 ** 3)).toFixed(1) : '16.0';
        const ramPct = typeof ram.percent === 'number' ? Math.round(ram.percent) : 0;
        updateElementText('mon-ram-text', `${ramUsedGB} GB / ${ramTotalGB} GB (${ramPct}%)`);
        const ramMeter = document.getElementById('mon-ram-meter-fill');
        if (ramMeter) {
            ramMeter.style.width = `${Math.min(100, ramPct)}%`;
        }

        renderStorageDrives(storage.drives || [], storage.read_bytes_per_sec || 0, storage.write_bytes_per_sec || 0);

        // 5. Network Telemetry
        const downSpeed = net.download_speed_bps || 0;
        const upSpeed = net.upload_speed_bps || 0;
        updateElementText('mon-net-down', `DOWN: ${formatThroughput(downSpeed)}`);
        updateElementText('mon-net-up', `UP: ${formatThroughput(upSpeed)}`);

        // 6. Push to history buffers
        pushHistory('cpu', cpuOverall);
        pushHistory('gpu', gpuUtil);
        pushHistory('netDown', downSpeed / 1024); // KB/s
        pushHistory('netUp', upSpeed / 1024);

        updateAnalytics('cpu', cpuOverall);
        updateAnalytics('gpu', gpuUtil);
        updateAnalytics('ram', ramPct);

        renderAnalyticsBadges();
        drawOscilloscopeGraphs();
    }

    function renderCpuThreadsGrid(perCore) {
        const container = document.getElementById('mon-threads-grid');
        if (!container) return;

        const count = Math.max(16, perCore.length || 16);
        let html = '';

        for (let i = 0; i < count; i++) {
            const pct = (perCore && perCore[i] !== undefined) ? perCore[i] : 0;
            const coreLabel = i < 9 ? `T0${i + 1}` : `T${i + 1}`;
            const isPerformanceCore = i < 12; // 6 P-cores with HT = 12 threads

            let color = 'var(--color-accent-primary)';
            if (pct >= 85) color = 'var(--color-status-error)';
            else if (pct >= 60) color = 'var(--color-accent-amber)';
            else if (pct >= 30) color = 'var(--color-accent-secondary)';

            html += `
                <div class="thread-card">
                    <div class="thread-id-row">
                        <span class="thread-name">${coreLabel}</span>
                        <span class="thread-type-badge ${isPerformanceCore ? 'p-core' : 'e-core'}">${isPerformanceCore ? 'P' : 'E'}</span>
                    </div>
                    <div class="thread-pct" style="color: ${color};">${Math.round(pct)}%</div>
                    <div class="thread-bar-bg">
                        <div class="thread-bar-fill" style="width: ${Math.min(100, Math.max(2, pct))}%; background-color: ${color};"></div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    function renderStorageDrives(drives, readBps, writeBps) {
        const container = document.getElementById('mon-storage-list');
        if (!container) return;

        let html = `
            <div class="disk-io-strip">
                <span class="disk-io-pill"><i class="disk-io-dot pulse"></i> READ: ${formatThroughput(readBps)}</span>
                <span class="disk-io-pill"><i class="disk-io-dot pulse" style="background:#00FFAA;"></i> WRITE: ${formatThroughput(writeBps)}</span>
            </div>
        `;

        if (drives && drives.length > 0) {
            drives.forEach(d => {
                const usedGB = (d.used_bytes / (1024 ** 3)).toFixed(1);
                const totalGB = (d.total_bytes / (1024 ** 3)).toFixed(1);
                const pct = d.percent || 0;
                html += `
                    <div class="storage-drive-item">
                        <div class="drive-info-row">
                            <span class="drive-name"><strong style="color:var(--color-accent-primary);">${d.drive || d.mount}</strong></span>
                            <span class="drive-stats">${usedGB} / ${totalGB} GB (${Math.round(pct)}%)</span>
                        </div>
                        <div class="drive-bar-bg">
                            <div class="drive-bar-fill" style="width: ${Math.min(100, pct)}%;"></div>
                        </div>
                    </div>
                `;
            });
        } else {
            html += `<div style="color:var(--color-text-dim); font-size:12px;">Storage discovery active...</div>`;
        }

        container.innerHTML = html;
    }

    function pushHistory(key, val) {
        if (!history[key]) history[key] = [];
        history[key].push(val);
        if (history[key].length > MAX_HISTORY) {
            history[key].shift();
        }
    }

    function updateAnalytics(key, val) {
        const a = analytics[key];
        if (!a || val === null || val === undefined) return;
        a.min = Math.min(a.min, val);
        a.max = Math.max(a.max, val);
        a.peak = Math.max(a.peak, val);
        a.sum += val;
        a.count++;
    }

    function renderAnalyticsBadges() {
        ['cpu', 'gpu', 'ram', 'temp'].forEach(k => {
            const a = analytics[k];
            if (!a || a.count === 0) return;
            const avg = a.sum / a.count;
            const suffix = k === 'temp' ? '°C' : '%';
            updateElementText(`mon-stat-${k}-min`, `${Math.round(a.min)}${suffix}`);
            updateElementText(`mon-stat-${k}-avg`, `${Math.round(avg)}${suffix}`);
            updateElementText(`mon-stat-${k}-peak`, `${Math.round(a.peak)}${suffix}`);
        });
    }

    function drawOscilloscopeGraphs() {
        drawGraph('graph-cpu-hist', history.cpu, '#00F0FF', 'CPU USAGE %');
        drawGraph('graph-gpu-hist', history.gpu, '#FF007F', 'GPU USAGE %');
        drawGraph('graph-net-hist', history.netDown, '#00FF41', 'DOWNLOAD SPEED');
    }

    function drawGraph(canvasId, dataArr, strokeColor, label) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Auto-adapt canvas pixel buffer to clientWidth
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.floor((canvas.clientWidth || 280) * dpr);
        const targetH = Math.floor(85 * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Scientific Grid
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        const gridStep = w / 8;
        for (let x = 0; x < w; x += gridStep) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += h / 3) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        if (!dataArr || dataArr.length < 2) return;

        // Waveform
        ctx.beginPath();
        const step = w / (MAX_HISTORY - 1);
        const maxVal = Math.max(100, ...dataArr);

        for (let i = 0; i < dataArr.length; i++) {
            const x = i * step;
            const y = h - (dataArr[i] / maxVal) * (h * 0.85) - 4;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Area gradient fill
        ctx.lineTo((dataArr.length - 1) * step, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, strokeColor.replace(')', ', 0.22)').replace('rgb', 'rgba'));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fill();
    }

    function formatThroughput(bps) {
        if (!bps || bps <= 0) return '0.0 KB/s';
        if (bps >= 1024 * 1024) {
            return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
        }
        return `${(bps / 1024).toFixed(1)} KB/s`;
    }

    function updateElementText(id, text) {
        const el = document.getElementById(id);
        if (el && el.textContent !== text) {
            el.textContent = text;
        }
    }

    function debounce(fn, ms) {
        let t;
        return function () {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, arguments), ms);
        };
    }

    return {
        init,
        setupGraphCanvases,
        updateTelemetry
    };
})();

window.PCMonitor = PCMonitor;
