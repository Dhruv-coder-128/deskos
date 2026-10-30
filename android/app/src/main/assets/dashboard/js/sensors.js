/**
 * DESK OS — Dynamic Sensor Lab Presenter
 * Renders dynamically discovered hardware sensors and live telemetry.
 */

const SensorsLab = (() => {
    let sensorPollInterval = null;

    return {
        init(sensorData) {
            this.renderCapabilities(sensorData.sensors || []);
            this.startLiveStream();
        },

        renderCapabilities(sensors) {
            const container = document.getElementById('sensors-chips-container');
            if (!container) return;

            container.innerHTML = '';
            sensors.forEach(sensor => {
                const chip = document.createElement('div');
                chip.className = `sensor-chip ${sensor.available ? 'present' : 'absent'}`;
                chip.innerHTML = `
                    <span class="pulse-dot" style="width: 5px; height: 5px; ${sensor.available ? '' : 'background: #4B5563; box-shadow: none;'}"></span>
                    <span>${sensor.name}</span>
                `;
                container.appendChild(chip);
            });
        },

        startLiveStream() {
            if (sensorPollInterval) return;

            // Sample sensors every 100ms (10 Hz) for smooth vibration display
            sensorPollInterval = setInterval(() => {
                const readings = UIBridge.getLiveSensors();
                if (!readings) return;

                const xEl = document.getElementById('accel-x');
                const yEl = document.getElementById('accel-y');
                const zEl = document.getElementById('accel-z');

                if (xEl) xEl.textContent = readings.x || '0.00';
                if (yEl) yEl.textContent = readings.y || '0.00';
                if (zEl) zEl.textContent = readings.z || '9.81';

                const vib = parseFloat(readings.vibration || '0');
                CanvasGraphs.addVibrationPoint(vib);
            }, 100);
        },

        stopLiveStream() {
            if (sensorPollInterval) {
                clearInterval(sensorPollInterval);
                sensorPollInterval = null;
            }
        }
    };
})();

