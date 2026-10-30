/**
 * DESK OS — Timers Engine (Personal Space)
 * Pomodoro Work/Break Sessions, Precision Stopwatch with Laps, and Custom Countdown.
 */

const TimersModule = (() => {
    // -------------------------------------------------------------------------
    // 1. POMODORO TIMER
    // -------------------------------------------------------------------------
    const POMODORO_STATES = {
        WORK: 'WORK',
        BREAK: 'SHORT BREAK',
        LONG_BREAK: 'LONG BREAK'
    };

    let pomodoroState = POMODORO_STATES.WORK;
    let pomodoroWorkMinutes = 25;
    let pomodoroBreakMinutes = 5;
    let pomodoroLongBreakMinutes = 15;
    let pomodoroSecondsRemaining = 25 * 60;
    let pomodoroTimerId = null;
    let pomodoroCompletedSessions = 0;

    // -------------------------------------------------------------------------
    // 2. STOPWATCH
    // -------------------------------------------------------------------------
    let stopwatchStartTime = 0;
    let stopwatchElapsedTime = 0;
    let stopwatchTimerId = null;
    let stopwatchLaps = [];

    // -------------------------------------------------------------------------
    // 3. COUNTDOWN TIMER
    // -------------------------------------------------------------------------
    let countdownInitialSeconds = 5 * 60; // 5 min default
    let countdownSecondsRemaining = 5 * 60;
    let countdownTimerId = null;

    return {
        async init() {
            // Load saved Pomodoro session count and settings
            const settings = await DeskStorage.get('timer_settings', null);
            if (settings) {
                pomodoroWorkMinutes = settings.workMinutes || 25;
                pomodoroBreakMinutes = settings.breakMinutes || 5;
                pomodoroLongBreakMinutes = settings.longBreakMinutes || 15;
                pomodoroCompletedSessions = settings.completedSessions || 0;
            }

            pomodoroSecondsRemaining = pomodoroWorkMinutes * 60;
            this.updatePomodoroDisplay();
            this.updateStopwatchDisplay();
            this.updateCountdownDisplay();
        },

        // =====================================================================
        // POMODORO CONTROLS
        // =====================================================================
        startPomodoro() {
            if (pomodoroTimerId) return;

            pomodoroTimerId = setInterval(() => {
                if (pomodoroSecondsRemaining > 0) {
                    pomodoroSecondsRemaining--;
                    this.updatePomodoroDisplay();
                } else {
                    this.onPomodoroComplete();
                }
            }, 1000);

            this.updatePomodoroControls();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        pausePomodoro() {
            if (pomodoroTimerId) {
                clearInterval(pomodoroTimerId);
                pomodoroTimerId = null;
            }
            this.updatePomodoroControls();
            UIBridge.triggerHaptic('click');
        },

        resetPomodoro() {
            this.pausePomodoro();
            pomodoroSecondsRemaining = (pomodoroState === POMODORO_STATES.WORK ? pomodoroWorkMinutes : pomodoroBreakMinutes) * 60;
            this.updatePomodoroDisplay();
            this.updatePomodoroControls();
            UIBridge.triggerHaptic('pulse');
        },

        skipPomodoro() {
            this.pausePomodoro();
            if (pomodoroState === POMODORO_STATES.WORK) {
                pomodoroCompletedSessions++;
                pomodoroState = (pomodoroCompletedSessions % 4 === 0) ? POMODORO_STATES.LONG_BREAK : POMODORO_STATES.BREAK;
                pomodoroSecondsRemaining = (pomodoroState === POMODORO_STATES.LONG_BREAK ? pomodoroLongBreakMinutes : pomodoroBreakMinutes) * 60;
            } else {
                pomodoroState = POMODORO_STATES.WORK;
                pomodoroSecondsRemaining = pomodoroWorkMinutes * 60;
            }
            this.updatePomodoroDisplay();
            this.updatePomodoroControls();
            this.saveTimerSettings();
            UIBridge.triggerHaptic('click');
        },

        onPomodoroComplete() {
            this.pausePomodoro();
            AudioSynth.playChime('alarm');
            UIBridge.triggerHaptic('alarm');

            if (pomodoroState === POMODORO_STATES.WORK) {
                pomodoroCompletedSessions++;
                UIBridge.showNotification('POMODORO COMPLETE', `Session #${pomodoroCompletedSessions} finished! Time for a break.`);
                pomodoroState = (pomodoroCompletedSessions % 4 === 0) ? POMODORO_STATES.LONG_BREAK : POMODORO_STATES.BREAK;
                pomodoroSecondsRemaining = (pomodoroState === POMODORO_STATES.LONG_BREAK ? pomodoroLongBreakMinutes : pomodoroBreakMinutes) * 60;
            } else {
                UIBridge.showNotification('BREAK FINISHED', 'Break over. Ready to begin next workstation session?');
                pomodoroState = POMODORO_STATES.WORK;
                pomodoroSecondsRemaining = pomodoroWorkMinutes * 60;
            }

            this.saveTimerSettings();
            this.updatePomodoroDisplay();
            this.updatePomodoroControls();
        },

        updatePomodoroDisplay() {
            const mins = Math.floor(pomodoroSecondsRemaining / 60);
            const secs = pomodoroSecondsRemaining % 60;
            const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            const timeEl = document.getElementById('pomo-time-display');
            const stateEl = document.getElementById('pomo-state-label');
            const sessionEl = document.getElementById('pomo-sessions-label');
            const ringEl = document.getElementById('pomo-progress-ring');

            if (timeEl) timeEl.textContent = timeStr;
            if (stateEl) stateEl.textContent = pomodoroState;
            if (sessionEl) sessionEl.textContent = `COMPLETED: #${pomodoroCompletedSessions}`;

            if (ringEl) {
                const total = (pomodoroState === POMODORO_STATES.WORK ? pomodoroWorkMinutes : pomodoroBreakMinutes) * 60;
                const progress = total > 0 ? (total - pomodoroSecondsRemaining) / total : 0;
                const circumference = 2 * Math.PI * 52;
                ringEl.style.strokeDasharray = `${circumference}`;
                ringEl.style.strokeDashoffset = `${circumference * (1 - progress)}`;
            }
        },

        updatePomodoroControls() {
            const btn = document.getElementById('pomo-toggle-btn');
            if (btn) {
                btn.textContent = pomodoroTimerId ? 'PAUSE' : 'START';
                btn.className = `cyber-btn ${pomodoroTimerId ? 'active' : ''}`;
            }
        },

        // =====================================================================
        // STOPWATCH CONTROLS
        // =====================================================================
        startStopwatch() {
            if (stopwatchTimerId) return;

            stopwatchStartTime = Date.now() - stopwatchElapsedTime;
            stopwatchTimerId = setInterval(() => {
                stopwatchElapsedTime = Date.now() - stopwatchStartTime;
                this.updateStopwatchDisplay();
            }, 33); // ~30 FPS millisecond updates

            this.updateStopwatchControls();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        pauseStopwatch() {
            if (stopwatchTimerId) {
                clearInterval(stopwatchTimerId);
                stopwatchTimerId = null;
            }
            this.updateStopwatchControls();
            UIBridge.triggerHaptic('click');
        },

        resetStopwatch() {
            this.pauseStopwatch();
            stopwatchElapsedTime = 0;
            stopwatchLaps = [];
            this.updateStopwatchDisplay();
            this.renderStopwatchLaps();
            this.updateStopwatchControls();
            UIBridge.triggerHaptic('pulse');
        },

        recordLap() {
            if (stopwatchElapsedTime === 0) return;

            const lapTime = stopwatchElapsedTime;
            stopwatchLaps.unshift({
                index: stopwatchLaps.length + 1,
                timeMs: lapTime,
                formatted: this.formatStopwatchTime(lapTime)
            });

            this.renderStopwatchLaps();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        formatStopwatchTime(ms) {
            const totalSec = Math.floor(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            const centis = Math.floor((ms % 1000) / 10);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
        },

        updateStopwatchDisplay() {
            const el = document.getElementById('stopwatch-time-display');
            if (el) el.textContent = this.formatStopwatchTime(stopwatchElapsedTime);
        },

        renderStopwatchLaps() {
            const container = document.getElementById('stopwatch-laps-list');
            if (!container) return;

            container.innerHTML = '';
            if (stopwatchLaps.length === 0) {
                container.innerHTML = '<div style="font-family: var(--font-mono); font-size: 10px; color: var(--color-text-dim); text-align: center; padding: 6px;">NO LAPS RECORDED</div>';
                return;
            }

            stopwatchLaps.slice(0, 10).forEach(lap => {
                const row = document.createElement('div');
                row.className = 'telemetry-row';
                row.innerHTML = `
                    <span class="telemetry-label">LAP #${lap.index}</span>
                    <span class="telemetry-val cyan">${lap.formatted}</span>
                `;
                container.appendChild(row);
            });
        },

        updateStopwatchControls() {
            const btn = document.getElementById('stopwatch-toggle-btn');
            if (btn) {
                btn.textContent = stopwatchTimerId ? 'PAUSE' : 'START';
                btn.className = `cyber-btn ${stopwatchTimerId ? 'active' : ''}`;
            }
        },

        // =====================================================================
        // COUNTDOWN TIMER CONTROLS
        // =====================================================================
        startCountdown() {
            if (countdownTimerId) return;

            countdownTimerId = setInterval(() => {
                if (countdownSecondsRemaining > 0) {
                    countdownSecondsRemaining--;
                    this.updateCountdownDisplay();
                } else {
                    this.onCountdownComplete();
                }
            }, 1000);

            this.updateCountdownControls();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        pauseCountdown() {
            if (countdownTimerId) {
                clearInterval(countdownTimerId);
                countdownTimerId = null;
            }
            this.updateCountdownControls();
            UIBridge.triggerHaptic('click');
        },

        resetCountdown() {
            this.pauseCountdown();
            countdownSecondsRemaining = countdownInitialSeconds;
            this.updateCountdownDisplay();
            this.updateCountdownControls();
            UIBridge.triggerHaptic('pulse');
        },

        addCountdownTime(secondsToAdd) {
            countdownInitialSeconds += secondsToAdd;
            countdownSecondsRemaining += secondsToAdd;
            this.updateCountdownDisplay();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        setCountdownMinutes(mins) {
            this.pauseCountdown();
            countdownInitialSeconds = mins * 60;
            countdownSecondsRemaining = mins * 60;
            this.updateCountdownDisplay();
            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('click');
        },

        onCountdownComplete() {
            this.pauseCountdown();
            AudioSynth.playChime('alarm');
            UIBridge.triggerHaptic('alarm');
            UIBridge.showNotification('COUNTDOWN EXPIRED', 'Your workstation countdown timer has reached zero.');
            this.updateCountdownDisplay();
            this.updateCountdownControls();
        },

        updateCountdownDisplay() {
            const h = Math.floor(countdownSecondsRemaining / 3600);
            const m = Math.floor((countdownSecondsRemaining % 3600) / 60);
            const s = countdownSecondsRemaining % 60;

            const timeStr = h > 0
                ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            const timeEl = document.getElementById('countdown-time-display');
            const barEl = document.getElementById('countdown-progress-bar');

            if (timeEl) timeEl.textContent = timeStr;
            if (barEl) {
                const pct = countdownInitialSeconds > 0
                    ? Math.round((countdownSecondsRemaining / countdownInitialSeconds) * 100)
                    : 0;
                barEl.style.width = `${pct}%`;
            }
        },

        updateCountdownControls() {
            const btn = document.getElementById('countdown-toggle-btn');
            if (btn) {
                btn.textContent = countdownTimerId ? 'PAUSE' : 'START';
                btn.className = `cyber-btn ${countdownTimerId ? 'active' : ''}`;
            }
        },

        async saveTimerSettings() {
            await DeskStorage.set('timer_settings', {
                workMinutes: pomodoroWorkMinutes,
                breakMinutes: pomodoroBreakMinutes,
                longBreakMinutes: pomodoroLongBreakMinutes,
                completedSessions: pomodoroCompletedSessions
            });
        }
    };
})();

