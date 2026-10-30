/**
 * DESK OS — Zero-Dependency Cyberpunk Web Audio Synthesizer
 * Generates futuristic audio alerts, timer completion chimes and haptic cues
 * completely offline with zero external audio files.
 */

const AudioSynth = (() => {
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    return {
        playTone(frequency, durationMs, type = 'sine', gainVal = 0.15) {
            try {
                const ctx = getAudioContext();
                if (!ctx) return;

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = type;
                osc.frequency.setValueAtTime(frequency, ctx.currentTime);

                gain.gain.setValueAtTime(gainVal, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (durationMs / 1000));

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start();
                osc.stop(ctx.currentTime + (durationMs / 1000));
            } catch (e) {
                console.warn('[AudioSynth] Audio play failed:', e);
            }
        },

        playChime(name) {
            const ctx = getAudioContext();
            if (!ctx) return;

            switch (name) {
                case 'success':
                    // Ascending cyberpunk two-tone
                    this.playTone(880, 100, 'sine', 0.12);
                    setTimeout(() => this.playTone(1760, 200, 'sine', 0.15), 110);
                    break;

                case 'alert':
                    // Dual pulse reminder alert
                    this.playTone(660, 150, 'triangle', 0.2);
                    setTimeout(() => this.playTone(880, 250, 'triangle', 0.22), 160);
                    break;

                case 'alarm':
                    // Pulsing triple alarm for Countdown / Pomodoro completion
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => {
                            this.playTone(1046.5, 120, 'square', 0.15); // C6
                        }, i * 200);
                    }
                    break;

                case 'tick':
                    // Subtle UI tick
                    this.playTone(1200, 30, 'sine', 0.05);
                    break;

                default:
                    this.playTone(440, 100, 'sine', 0.1);
            }
        }
    };
})();

