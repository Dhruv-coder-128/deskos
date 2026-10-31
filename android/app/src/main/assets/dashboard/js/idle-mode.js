/**
 * DESK OS — Scientific Futuristic Idle Mode Engine 2.0
 * Transforms the Galaxy M01s into an advanced, sophisticated scientific ambient workstation display.
 * 
 * Features:
 * - Real local chronometer & calendar (12h/24h formats, auto-refresh on wake/resume, zero 00:00:00 bug)
 * - 4 Redesigned Scientific Instrumentation Themes:
 *   1. NEURAL SCIENCE: Synaptic neural architecture, slow Brownian drift, subtle axon pulses, alpha EEG trace
 *   2. SPACE STATION: Orbital trajectory coordinate grid, slow attitude gyro sweep, docking vectors
 *   3. CYBER LAB: Isometric vector grid floor, clean 3D rotating wireframe hypercube, diagnostic reticle
 *   4. QUANTUM CORE: Tokamak toroidal magnetic field coils, gentle plasma fusion core, thermal flux
 * - Configurable Animation Intensity: Minimal, Balanced (default), Advanced
 * - Live PC Hardware HUD telemetry (Lenovo LOQ, i5-13450HX, RTX 3050, RAM, Battery)
 * - Burn-in shift protection & tap-to-wake instant restoration
 */

const IdleModeManager = (function () {
    'use strict';

    let isRunning = false;
    let activeTheme = 'neural'; // 'neural', 'space', 'cyber', 'quantum'
    let animIntensity = 'balanced'; // 'minimal', 'balanced', 'advanced'
    let is24HourFormat = true;
    let clockInterval = null;
    let animFrameId = null;
    let canvas = null;
    let ctx = null;
    let tick = 0;
    let lastRenderTime = 0;

    // Simulation Data
    let neuralNodes = [];
    let quantumRings = [];
    let starField = [];
    let cubeRotation = { x: 0, y: 0, z: 0 };

    // Real Telemetry Cache
    let telemetryData = {
        cpuPercent: 25,
        gpuPercent: 12,
        gpuTemp: 52,
        ramPercent: 55,
        downSpeed: '1.2 MB/s',
        upSpeed: '250 KB/s',
        battery: '85%',
        model: 'Lenovo LOQ 15IRX9'
    };

    let mediaData = {
        hasSession: false,
        title: '',
        artist: ''
    };

    function init() {
        console.log('[IdleMode 2.0] Initializing Scientific Futuristic Idle Mode Engine...');
        canvas = document.getElementById('idle-ambient-canvas');
        if (canvas) {
            ctx = canvas.getContext('2d');
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        }

        bindUIEvents();
        updateClock();
    }

    function resizeCanvas() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        initSimulations();
    }

    function bindUIEvents() {
        // Theme Dock Buttons
        document.querySelectorAll('.idle-theme-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const theme = btn.dataset.theme;
                if (theme) setTheme(theme);
                if (typeof UIBridge !== 'undefined') {
                    UIBridge.triggerHaptic('click');
                }
            });
        });

        // Intensity Dock Buttons
        document.querySelectorAll('.idle-intensity-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const intensity = btn.dataset.intensity;
                if (intensity) setIntensity(intensity);
                if (typeof UIBridge !== 'undefined') {
                    UIBridge.triggerHaptic('click');
                }
            });
        });

        // Container click for tap-to-wake
        const overlay = document.getElementById('idle-overlay');
        if (overlay) {
            overlay.addEventListener('click', handleContainerClick);
        }

        // App resume / screen wake listeners
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                updateClock();
            }
        });
        window.addEventListener('focus', updateClock);
    }

    function initSimulations() {
        if (!canvas) return;
        const w = canvas.width || 1280;
        const h = canvas.height || 720;

        // 1. Neural nodes (fewer, elegant connections)
        neuralNodes = [];
        const nodeCount = animIntensity === 'minimal' ? 14 : (animIntensity === 'balanced' ? 24 : 36);
        for (let i = 0; i < nodeCount; i++) {
            neuralNodes.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                radius: Math.random() * 2.0 + 1.2,
                pulse: Math.random() * Math.PI * 2
            });
        }

        // 2. Space station starfield
        starField = [];
        const starCount = animIntensity === 'minimal' ? 25 : (animIntensity === 'balanced' ? 50 : 80);
        for (let i = 0; i < starCount; i++) {
            starField.push({
                x: Math.random() * w,
                y: Math.random() * h,
                size: Math.random() * 1.5 + 0.4,
                alpha: Math.random() * 0.7 + 0.3
            });
        }

        // 3. Quantum rings
        quantumRings = [
            { radius: 80, speed: 0.008, tilt: 0.35, angle: 0 },
            { radius: 110, speed: -0.006, tilt: -0.4, angle: Math.PI / 4 },
            { radius: 140, speed: 0.005, tilt: 0.6, angle: Math.PI / 2 }
        ];
    }

    function start() {
        if (isRunning) return;
        isRunning = true;
        tick = 0;
        lastRenderTime = performance.now();

        resizeCanvas();
        renderThemeUI();
        updateClock();

        clearInterval(clockInterval);
        clockInterval = setInterval(updateClock, 1000);

        loop(performance.now());
    }

    function stop() {
        isRunning = false;
        clearInterval(clockInterval);
        clockInterval = null;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    }

    function setTheme(themeName) {
        activeTheme = themeName;
        renderThemeUI();
        initSimulations();
    }

    function setIntensity(intensity) {
        animIntensity = intensity;
        document.querySelectorAll('.idle-intensity-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.intensity === intensity);
        });
        initSimulations();
    }

    function toggleClockFormat() {
        is24HourFormat = !is24HourFormat;
        updateClock();
        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('tick');
        }
    }

    function renderThemeUI() {
        const titleEl = document.getElementById('idle-theme-title');
        const descEl = document.getElementById('idle-theme-desc');
        const themeMap = {
            neural: { title: 'NEURAL SCIENCE LAB', desc: 'SYNAPTIC ARCHITECTURE // ALPHA EEG OSCILLATION' },
            space: { title: 'SPACE STATION TELEMETRY', desc: 'ORBITAL TRAJECTORY // ATTITUDE GYRO VECTORS' },
            cyber: { title: 'CYBER LAB DIAGNOSTICS', desc: 'ISOMETRIC MATRIX // 3D HYPERCUBE TESSERACT' },
            quantum: { title: 'QUANTUM CORE REACTOR', desc: 'TOKAMAK CONFINEMENT // PLASMA THERMAL FLUX' }
        };

        const t = themeMap[activeTheme] || themeMap.neural;
        if (titleEl) titleEl.textContent = t.title;
        if (descEl) descEl.textContent = t.desc;

        document.querySelectorAll('.idle-theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.theme === activeTheme);
        });
    }

    function loop(now) {
        if (!isRunning) return;

        // FPS Throttling based on intensity setting
        const targetFps = animIntensity === 'minimal' ? 12 : (animIntensity === 'balanced' ? 30 : 60);
        const minDelta = 1000 / targetFps;
        const delta = now - lastRenderTime;

        if (delta >= minDelta) {
            lastRenderTime = now - (delta % minDelta);
            tick += 0.025;

            if (ctx && canvas) {
                const w = canvas.width;
                const h = canvas.height;
                ctx.clearRect(0, 0, w, h);

                if (activeTheme === 'neural') {
                    renderNeuralTheme(w, h);
                } else if (activeTheme === 'space') {
                    renderSpaceTheme(w, h);
                } else if (activeTheme === 'cyber') {
                    renderCyberTheme(w, h);
                } else if (activeTheme === 'quantum') {
                    renderQuantumTheme(w, h);
                }
            }
        }

        animFrameId = requestAnimationFrame(loop);
    }

    // -------------------------------------------------------------------------
    // THEME 1: NEURAL SCIENCE (Smooth Synaptic Web & EEG Waveform)
    // -------------------------------------------------------------------------
    function renderNeuralTheme(w, h) {
        ctx.save();

        // 1. Synaptic Nodes & Axons
        ctx.lineWidth = 0.8;
        for (let i = 0; i < neuralNodes.length; i++) {
            const n1 = neuralNodes[i];
            n1.x += n1.vx;
            n1.y += n1.vy;
            if (n1.x < 0 || n1.x > w) n1.vx *= -1;
            if (n1.y < 0 || n1.y > h) n1.vy *= -1;

            n1.pulse += 0.03;
            const alphaPulse = 0.3 + 0.3 * Math.sin(n1.pulse);

            for (let j = i + 1; j < neuralNodes.length; j++) {
                const n2 = neuralNodes[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 140) {
                    const edgeAlpha = (1.0 - dist / 140) * 0.22;
                    ctx.strokeStyle = `rgba(0, 240, 255, ${edgeAlpha})`;
                    ctx.beginPath();
                    ctx.moveTo(n1.x, n1.y);
                    ctx.lineTo(n2.x, n2.y);
                    ctx.stroke();
                }
            }

            // Draw Node
            ctx.fillStyle = `rgba(0, 255, 65, ${alphaPulse})`;
            ctx.beginPath();
            ctx.arc(n1.x, n1.y, n1.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Subtle EEG Waveform at bottom
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const baseH = h * 0.78;
        for (let x = 0; x < w; x += 6) {
            const freq = 0.015;
            const eeg = Math.sin(x * freq + tick * 2) * Math.cos(x * freq * 0.5 + tick) * 16;
            if (x === 0) ctx.moveTo(x, baseH + eeg);
            else ctx.lineTo(x, baseH + eeg);
        }
        ctx.stroke();

        ctx.restore();
    }

    // -------------------------------------------------------------------------
    // THEME 2: SPACE STATION (Deep Space Grid & Attitude Gyro Trajectory)
    // -------------------------------------------------------------------------
    function renderSpaceTheme(w, h) {
        ctx.save();

        // 1. Starfield
        for (let i = 0; i < starField.length; i++) {
            const s = starField[i];
            ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Calibrated Orbital Gyro Ring (Center Left)
        const cx = w * 0.32;
        const cy = h * 0.50;
        const radius = Math.min(w, h) * 0.24;

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.arc(cx, cy, radius * 0.65, 0, Math.PI * 2);
        ctx.stroke();

        // Gyro Crosshairs
        ctx.beginPath();
        ctx.moveTo(cx - radius - 15, cy);
        ctx.lineTo(cx + radius + 15, cy);
        ctx.moveTo(cx, cy - radius - 15);
        ctx.lineTo(cx, cy + radius + 15);
        ctx.stroke();

        // Slow radar sweep vector
        const sweepAngle = tick * 0.4;
        ctx.strokeStyle = 'rgba(0, 255, 65, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
        ctx.stroke();

        // Target Satellite Blip
        const satAngle = tick * 0.15;
        const sx = cx + Math.cos(satAngle) * radius * 0.82;
        const sy = cy + Math.sin(satAngle) * radius * 0.82;
        ctx.fillStyle = '#FF007F';
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // -------------------------------------------------------------------------
    // THEME 3: CYBER LAB (Perspective Floor Grid & Rotating Wireframe Hypercube)
    // -------------------------------------------------------------------------
    function renderCyberTheme(w, h) {
        ctx.save();

        // 1. Perspective Grid Floor
        const horizon = h * 0.55;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.10)';
        ctx.lineWidth = 1;

        // Vanishing perspective lines
        const vanishingX = w * 0.45;
        for (let x = -w * 0.5; x <= w * 1.5; x += w / 12) {
            ctx.beginPath();
            ctx.moveTo(vanishingX, horizon);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Horizontal grid rungs with exponential depth spacing
        let depth = 1.0;
        for (let y = horizon + 15; y < h; y += depth) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            depth *= 1.35;
        }

        // 2. Rotating Wireframe Cube in 3D
        cubeRotation.x += 0.008;
        cubeRotation.y += 0.012;

        const size = Math.min(w, h) * 0.12;
        const cubeCenter = { x: w * 0.45, y: h * 0.36 };

        const vertices = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1]
        ];

        // 3D rotation projection
        const proj = vertices.map(v => {
            // Rotate Y
            const cosY = Math.cos(cubeRotation.y);
            const sinY = Math.sin(cubeRotation.y);
            const x1 = v[0] * cosY - v[2] * sinY;
            const z1 = v[0] * sinY + v[2] * cosY;

            // Rotate X
            const cosX = Math.cos(cubeRotation.x);
            const sinX = Math.sin(cubeRotation.x);
            const y2 = v[1] * cosX - z1 * sinX;
            const z2 = v[1] * sinX + z1 * cosX;

            const fov = 3.2;
            const scale = fov / (fov + z2);
            return [cubeCenter.x + x1 * size * scale, cubeCenter.y + y2 * size * scale];
        });

        const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0], // back
            [4, 5], [5, 6], [6, 7], [7, 4], // front
            [0, 4], [1, 5], [2, 6], [3, 7]  // connectors
        ];

        ctx.strokeStyle = 'rgba(0, 255, 65, 0.7)';
        ctx.lineWidth = 1.5;
        edges.forEach(e => {
            ctx.beginPath();
            ctx.moveTo(proj[e[0]][0], proj[e[0]][1]);
            ctx.lineTo(proj[e[1]][0], proj[e[1]][1]);
            ctx.stroke();
        });

        ctx.restore();
    }

    // -------------------------------------------------------------------------
    // THEME 4: QUANTUM CORE (Tokamak Magnetic Toroid & Plasma Core)
    // -------------------------------------------------------------------------
    function renderQuantumTheme(w, h) {
        ctx.save();

        const cx = w * 0.40;
        const cy = h * 0.46;

        // 1. Magnetic Containment Toroid Rings
        for (let i = 0; i < quantumRings.length; i++) {
            const ring = quantumRings[i];
            ring.angle += ring.speed;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(ring.angle);
            ctx.scale(1.0, ring.tilt);

            ctx.strokeStyle = i === 0 ? 'rgba(0, 240, 255, 0.4)' : (i === 1 ? 'rgba(255, 0, 128, 0.35)' : 'rgba(138, 43, 226, 0.35)');
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 2. Central Plasma Reactor Glow
        const pulse = 0.85 + 0.15 * Math.sin(tick * 3);
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 32 * pulse);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        grad.addColorStop(0.3, 'rgba(0, 240, 255, 0.7)');
        grad.addColorStop(0.7, 'rgba(255, 0, 128, 0.3)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 32 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Chronometer & Real Device Date Integration
    // -------------------------------------------------------------------------
    function updateClock() {
        const now = new Date();
        const timeEl = document.getElementById('idle-clock-digits');
        const dateEl = document.getElementById('idle-date-badge');

        if (timeEl) {
            let h = now.getHours();
            let suffix = '';
            if (!is24HourFormat) {
                suffix = h >= 12 ? ' PM' : ' AM';
                h = h % 12;
                if (h === 0) h = 12;
            }
            const hStr = String(h).padStart(2, '0');
            const mStr = String(now.getMinutes()).padStart(2, '0');
            const sStr = String(now.getSeconds()).padStart(2, '0');
            timeEl.textContent = `${hStr}:${mStr}:${sStr}${suffix}`;
        }

        if (dateEl) {
            const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            dateEl.textContent = `${days[now.getDay()]} // ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
        }
    }

    function updateTelemetry(data) {
        if (!data) return;
        if (data.cpu) {
            telemetryData.cpuPercent = Math.round(data.cpu.overall_percent || 0);
            const cpuEl = document.getElementById('idle-val-cpu');
            const cpuBar = document.getElementById('idle-bar-cpu');
            if (cpuEl) cpuEl.textContent = `${telemetryData.cpuPercent}%`;
            if (cpuBar) cpuBar.style.width = `${Math.min(100, telemetryData.cpuPercent)}%`;
        }

        if (data.gpu) {
            telemetryData.gpuPercent = Math.round(data.gpu.utilization_percent || 0);
            if (data.gpu.temperature_c) telemetryData.gpuTemp = Math.round(data.gpu.temperature_c);
            const gpuEl = document.getElementById('idle-val-gpu');
            const gpuBar = document.getElementById('idle-bar-gpu');
            if (gpuEl) gpuEl.textContent = `${telemetryData.gpuPercent}% // ${telemetryData.gpuTemp}°C`;
            if (gpuBar) gpuBar.style.width = `${Math.min(100, telemetryData.gpuPercent)}%`;
        }

        if (data.ram) {
            telemetryData.ramPercent = Math.round(data.ram.percent || 0);
            const ramEl = document.getElementById('idle-val-ram');
            const ramBar = document.getElementById('idle-bar-ram');
            if (ramEl) ramEl.textContent = `${telemetryData.ramPercent}%`;
            if (ramBar) ramBar.style.width = `${Math.min(100, telemetryData.ramPercent)}%`;
        }

        if (data.network) {
            const down = data.network.download_speed_bps || 0;
            const up = data.network.upload_speed_bps || 0;
            const netEl = document.getElementById('idle-val-net');
            if (netEl) netEl.textContent = `↓ ${(down / 1024).toFixed(0)} kB/s ↑ ${(up / 1024).toFixed(0)} kB/s`;
        }

        if (data.system && data.system.battery_percent !== null && data.system.battery_percent !== undefined) {
            telemetryData.battery = `${Math.round(data.system.battery_percent)}%`;
            const batEl = document.getElementById('idle-battery-val');
            if (batEl) batEl.textContent = `BATTERY: ${telemetryData.battery}`;
        }
    }

    function updateMediaState(state) {
        if (!state) return;
        mediaData = {
            hasSession: Boolean(state.has_session && state.title),
            title: state.title || '',
            artist: state.artist || ''
        };
        const titleEl = document.getElementById('idle-music-title');
        const artistEl = document.getElementById('idle-music-artist');
        const statusEl = document.getElementById('idle-music-status');
        if (titleEl && mediaData.title) titleEl.textContent = mediaData.title;
        if (artistEl && mediaData.artist) artistEl.textContent = mediaData.artist;
        if (statusEl) statusEl.textContent = mediaData.hasSession ? 'WINDOWS GSMTC MEDIA' : 'MEDIA SESSION IDLE';
    }

    function mediaControl(action, event) {
        if (event) event.stopPropagation();
        if (typeof DeskOS !== 'undefined' && DeskOS.sendWebSocketMessage) {
            DeskOS.sendWebSocketMessage({
                type: 'control_action',
                action: 'media_action',
                media_action: action
            });
        }
    }

    function handleContainerClick(event) {
        // Prevent waking if tapped on theme selector or controls
        if (event.target.closest('.idle-top-bar') ||
            event.target.closest('.idle-theme-dock') ||
            event.target.closest('.idle-intensity-dock') ||
            event.target.closest('.idle-theme-btn') ||
            event.target.closest('.idle-intensity-btn') ||
            event.target.closest('.idle-music-card') ||
            event.target.closest('.idle-clock-wrap')) {
            return;
        }

        // Restore active workstation mode
        if (typeof DeskOS !== 'undefined' && DeskOS.setMode) {
            DeskOS.setMode('active', event);
        }
    }

    return {
        init,
        start,
        stop,
        setTheme,
        setIntensity,
        toggleClockFormat,
        updateClock,
        updateTelemetry,
        updateMediaState,
        mediaControl,
        handleContainerClick
    };
})();

window.IdleModeManager = IdleModeManager;
