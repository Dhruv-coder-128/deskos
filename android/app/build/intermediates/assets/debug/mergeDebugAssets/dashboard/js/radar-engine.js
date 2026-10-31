/**
 * DESK OS - Cyber Radar 2.0 Tactical Monitoring Engine
 * Integrates:
 * - Live Aircraft Radar via OpenSky Network REST API (True GPS Lat/Lon, Distance, Bearing, Altitude, Velocity)
 * - Nearby Bluetooth LE Radar via Android Native Bridge (Signal Strength RSSI, Proximity, Device Category)
 * - Safe Local Network Radar (LAN Nodes, Routers, and Tailscale Mesh VPN Peers)
 * Enforces rate limiting, honest zero-data empty states, and true mathematical bearings.
 */
const RadarEngine = (() => {
    // Observer Position (Defaults to Mumbai; overridden by GPS or user selection)
    let observer = {
        lat: 19.0760,
        lon: 72.8777,
        label: 'Mumbai Hub',
        isGps: false
    };

    const CITY_PRESETS = [
        { name: 'Mumbai (BOM)', lat: 19.0760, lon: 72.8777 },
        { name: 'New York (JFK)', lat: 40.7128, lon: -74.0060 },
        { name: 'London (LHR)', lat: 51.5074, lon: -0.1278 },
        { name: 'Tokyo (HND)', lat: 35.6762, lon: 139.6503 },
        { name: 'Singapore (SIN)', lat: 1.3521, lon: 103.8198 },
        { name: 'Dubai (DXB)', lat: 25.2048, lon: 55.2708 },
        { name: 'Berlin (BER)', lat: 52.5200, lon: 13.4050 },
        { name: 'Delhi (DEL)', lat: 28.6139, lon: 77.2090 }
    ];

    let currentRangeKm = 100; // 50, 100, 250
    let activeFilter = 'ALL'; // ALL, AIRCRAFT, BLUETOOTH, LAN, TAILSCALE

    // Target Stores
    let aircraftList = [];
    let bluetoothList = [];
    let networkList = [];

    let lastAircraftFetchTime = 0;
    let aircraftCooldownTimer = 0;
    let aircraftFetchStatus = 'IDLE'; // IDLE, LOADING, SUCCESS, RATE_LIMITED, ERROR
    let aircraftErrorMessage = null;
    let selectedTarget = null;
    let autoRefreshInterval = null;

    // Haversine formula for geodesic distance in kilometers
    function calculateDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371.0;
        const dLat = (lat2 - lat1) * Math.PI / 180.0;
        const dLon = (lon2 - lon1) * Math.PI / 180.0;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180.0) * Math.cos(lat2 * Math.PI / 180.0) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Initial bearing formula (0° = North, 90° = East, 180° = South, 270° = West)
    function calculateBearingDeg(lat1, lon1, lat2, lon2) {
        const phi1 = lat1 * Math.PI / 180.0;
        const phi2 = lat2 * Math.PI / 180.0;
        const deltaLambda = (lon2 - lon1) * Math.PI / 180.0;
        const y = Math.sin(deltaLambda) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) -
                  Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
        const theta = Math.atan2(y, x);
        return ((theta * 180.0 / Math.PI) + 360.0) % 360.0;
    }

    // Convert bearing degrees to compass cardinal direction
    function degToCardinal(deg) {
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const idx = Math.round(deg / 22.5) % 16;
        return dirs[idx];
    }

    // Stable angle for BLE/Network based on string hash
    function stringToAngle(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash % 360);
    }

    return {
        CITY_PRESETS,

        init() {
            // Load cached location preference if available
            try {
                const saved = localStorage.getItem('deskos_radar_observer');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed.lat && parsed.lon) observer = parsed;
                }
            } catch (_) {}

            // Try requesting GPS location silently if permission already granted
            this.tryDetectGpsLocation(true);
        },

        tryDetectGpsLocation(silent = false) {
            if (!navigator.geolocation) return;
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    observer = {
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude,
                        label: `GPS (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)})`,
                        isGps: true
                    };
                    try {
                        localStorage.setItem('deskos_radar_observer', JSON.stringify(observer));
                    } catch (_) {}
                    this.updateLocationHud();
                    this.fetchAircraft(true);
                },
                (err) => {
                    if (!silent) {
                        console.warn('[Radar] Geolocation error:', err);
                    }
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
            );
        },

        setObserver(lat, lon, label = 'Custom Position', isGps = false) {
            observer = { lat: Number(lat), lon: Number(lon), label, isGps };
            try {
                localStorage.setItem('deskos_radar_observer', JSON.stringify(observer));
            } catch (_) {}
            this.updateLocationHud();
            this.fetchAircraft(true);
        },

        getObserver() {
            return observer;
        },

        setRange(rangeKm) {
            currentRangeKm = Number(rangeKm);
            this.fetchAircraft(true);
        },

        getRange() {
            return currentRangeKm;
        },

        setFilter(filterName) {
            activeFilter = (filterName || 'ALL').toUpperCase();
        },

        getFilter() {
            return activeFilter;
        },

        startRadarLoop() {
            this.fetchAircraft();
            this.pollBluetooth();
            this.pollNetwork();

            if (!autoRefreshInterval) {
                // Poll aircraft every 30 seconds (respecting OpenSky anonymous rate limits)
                autoRefreshInterval = setInterval(() => {
                    this.fetchAircraft();
                    this.pollBluetooth();
                }, 30000);
            }
        },

        stopRadarLoop() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            if (UIBridge.stopBleScan) {
                UIBridge.stopBleScan();
            }
        },

        async fetchAircraft(force = false) {
            const now = Date.now();
            const elapsed = (now - lastAircraftFetchTime) / 1000;

            // Enforce 12-second minimum cooldown for OpenSky anonymous API limits
            if (!force && elapsed < 12) {
                return;
            }

            lastAircraftFetchTime = now;
            aircraftFetchStatus = 'LOADING';
            this.updateStatusHud();

            const latDelta = currentRangeKm / 111.0;
            const lonDelta = currentRangeKm / (111.0 * Math.max(0.2, Math.cos(observer.lat * Math.PI / 180.0)));

            const lamin = (observer.lat - latDelta).toFixed(4);
            const lamax = (observer.lat + latDelta).toFixed(4);
            const lomin = (observer.lon - lonDelta).toFixed(4);
            const lomax = (observer.lon + lonDelta).toFixed(4);

            const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

            // 1. Native Android Bridge fetch (Bypasses WebView CORS completely)
            if (typeof UIBridge !== 'undefined' && UIBridge.fetchOpenSky) {
                try {
                    const jsonStr = UIBridge.fetchOpenSky(lamin, lomin, lamax, lomax);
                    if (jsonStr) {
                        const data = JSON.parse(jsonStr);
                        if (data.error) {
                            if (data.error.includes('429')) {
                                aircraftFetchStatus = 'RATE_LIMITED';
                                aircraftErrorMessage = 'OpenSky rate limited (10s threshold). Retaining cached tracks.';
                                this.updateStatusHud();
                                return;
                            }
                        } else if (Array.isArray(data.states)) {
                            this.parseAndStoreRawStates(data.states);
                            return;
                        }
                    }
                } catch (ne) {
                    console.warn('[Radar] Native OpenSky fetch error:', ne);
                }
            }

            // 2. PC Agent WebSocket proxy fallback
            if (typeof UIBridge !== 'undefined' && UIBridge.requestAircraftData) {
                try {
                    UIBridge.requestAircraftData(lamin, lomin, lamax, lomax);
                } catch (_) {}
            }

            // 3. Direct browser fetch fallback
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 9000);

                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.status === 429) {
                    aircraftFetchStatus = 'RATE_LIMITED';
                    aircraftErrorMessage = 'OpenSky API rate limited (10s threshold). Retaining cached tracks.';
                    this.updateStatusHud();
                    return;
                }

                if (!response.ok) {
                    aircraftFetchStatus = 'ERROR';
                    aircraftErrorMessage = `OpenSky HTTP ${response.status}`;
                    this.updateStatusHud();
                    return;
                }

                const data = await response.json();
                this.parseAndStoreRawStates(data.states || []);

            } catch (err) {
                if (aircraftList.length === 0) {
                    aircraftFetchStatus = 'ERROR';
                    aircraftErrorMessage = err.name === 'AbortError' ? 'OpenSky network timeout' : (err.message || 'Network unreachable');
                    this.updateCounters();
                    this.updateStatusHud();
                }
            }
        },

        parseAndStoreRawStates(rawStates) {
            const parsed = [];
            (rawStates || []).forEach(s => {
                const icao = s[0];
                const callsign = (s[1] || '').trim() || (icao ? icao.toUpperCase() : 'UNKNOWN');
                const country = s[2] || 'International';
                const lon = s[5];
                const lat = s[6];
                const baroAltM = s[7]; // meters
                const onGround = Boolean(s[8]);
                const velMs = s[9]; // m/s
                const trueTrack = s[10] || 0; // heading deg
                const vertRateMs = s[11] || 0;
                const squawk = s[14] || 'N/A';

                if (lat != null && lon != null) {
                    const distKm = calculateDistanceKm(observer.lat, observer.lon, lat, lon);
                    if (distKm <= currentRangeKm * 1.05) {
                        const bearing = calculateBearingDeg(observer.lat, observer.lon, lat, lon);
                        parsed.push({
                            id: `ac_${icao}`,
                            type: 'AIRCRAFT',
                            icao24: icao,
                            callsign: callsign,
                            country: country,
                            lat: lat,
                            lon: lon,
                            distanceKm: Math.round(distKm * 10) / 10,
                            bearingDeg: Math.round(bearing),
                            cardinal: degToCardinal(bearing),
                            altitudeM: baroAltM != null ? Math.round(baroAltM) : null,
                            altitudeFt: baroAltM != null ? Math.round(baroAltM * 3.28084) : null,
                            speedKmh: velMs != null ? Math.round(velMs * 3.6) : null,
                            speedKnots: velMs != null ? Math.round(velMs * 1.94384) : null,
                            headingDeg: Math.round(trueTrack),
                            verticalRateMs: Math.round(vertRateMs * 10) / 10,
                            onGround: onGround,
                            squawk: squawk,
                            lastSeen: Date.now()
                        });
                    }
                }
            });

            // Sort closest first
            parsed.sort((a, b) => a.distanceKm - b.distanceKm);
            aircraftList = parsed;
            aircraftFetchStatus = 'SUCCESS';
            aircraftErrorMessage = null;
            this.updateCounters();
            this.updateStatusHud();
        },

        setAircraftError(err) {
            aircraftFetchStatus = 'ERROR';
            aircraftErrorMessage = err || 'API request failed';
            this.updateCounters();
            this.updateStatusHud();
        },

        pollBluetooth() {
            if (!UIBridge.getDiscoveredBleDevices) return;
            const bleRaw = UIBridge.getDiscoveredBleDevices() || [];
            const parsed = [];

            bleRaw.forEach(d => {
                const angle = stringToAngle(d.address || d.name);
                // Map RSSI (-40 to -95 dBm) to radial distance 0.15 to 0.92
                const normRssi = Math.max(-95, Math.min(-40, d.rssi));
                const radialFactor = 0.15 + (1.0 - (normRssi - (-95)) / 55.0) * 0.77;

                parsed.push({
                    id: `ble_${d.address}`,
                    type: 'BLUETOOTH',
                    name: d.name || 'BLE Beacon',
                    address: d.address,
                    rssi: d.rssi,
                    proximity: d.proximity || 'NEAR',
                    category: d.category || 'peripheral',
                    radialFactor: radialFactor,
                    bearingDeg: angle,
                    cardinal: degToCardinal(angle),
                    lastSeen: Date.now() - (d.ageMs || 0)
                });
            });

            bluetoothList = parsed;
            this.updateCounters();
        },

        pollNetwork() {
            if (UIBridge.requestNetworkDevices) {
                UIBridge.requestNetworkDevices();
            }
        },

        setNetworkDevices(devices) {
            if (!Array.isArray(devices)) return;
            const parsed = [];

            devices.forEach((dev, idx) => {
                const isHost = Boolean(dev.is_current_host);
                const isTs = Boolean(dev.is_tailscale);
                const angle = (idx * 45) % 360;
                const radialFactor = isHost ? 0.20 : (isTs ? 0.80 : 0.48);

                parsed.push({
                    id: dev.id || `net_${idx}`,
                    type: isTs ? 'TAILSCALE' : (isHost ? 'HOST' : 'LAN'),
                    hostname: dev.hostname || dev.ip,
                    ip: dev.ip,
                    mac: dev.mac,
                    isHost: isHost,
                    isTailscale: isTs,
                    status: dev.status || 'ONLINE',
                    os: dev.os,
                    radialFactor: radialFactor,
                    bearingDeg: angle,
                    cardinal: degToCardinal(angle),
                    lastSeen: dev.last_seen ? dev.last_seen * 1000 : Date.now()
                });
            });

            networkList = parsed;
            this.updateCounters();
        },

        getAllTargets() {
            let combined = [];

            if (activeFilter === 'ALL' || activeFilter === 'AIRCRAFT') {
                combined = combined.concat(aircraftList);
            }
            if (activeFilter === 'ALL' || activeFilter === 'BLUETOOTH') {
                combined = combined.concat(bluetoothList);
            }
            if (activeFilter === 'ALL' || activeFilter === 'LAN') {
                combined = combined.concat(networkList.filter(n => !n.isTailscale));
            }
            if (activeFilter === 'ALL' || activeFilter === 'TAILSCALE') {
                combined = combined.concat(networkList.filter(n => n.isTailscale));
            }

            return combined;
        },

        selectTarget(target) {
            selectedTarget = target;
            this.renderTargetDetailModal();
        },

        clearSelectedTarget() {
            selectedTarget = null;
            const modal = document.getElementById('radar-target-detail-card');
            if (modal) modal.style.display = 'none';
        },

        updateCounters() {
            const elAc = document.getElementById('radar-count-aircraft');
            const elBle = document.getElementById('radar-count-ble');
            const elLan = document.getElementById('radar-count-lan');
            const elTs = document.getElementById('radar-count-ts');

            const lanCount = networkList.filter(n => !n.isTailscale).length;
            const tsCount = networkList.filter(n => n.isTailscale).length;

            if (elAc) elAc.textContent = aircraftList.length;
            if (elBle) elBle.textContent = bluetoothList.length;
            if (elLan) elLan.textContent = lanCount;
            if (elTs) elTs.textContent = tsCount;
        },

        updateLocationHud() {
            const locEl = document.getElementById('radar-hud-location');
            if (locEl) {
                locEl.textContent = `${observer.label}`;
            }
        },

        updateStatusHud() {
            const statusEl = document.getElementById('radar-hud-status');
            if (!statusEl) return;

            if (aircraftFetchStatus === 'LOADING') {
                statusEl.textContent = 'SCANNING OPENSKY REST FEED...';
                statusEl.style.color = '#38BDF8';
            } else if (aircraftFetchStatus === 'RATE_LIMITED') {
                statusEl.textContent = 'OPENSKY COOLDOWN ACTIVE (CACHED DATA)';
                statusEl.style.color = '#F59E0B';
            } else if (aircraftFetchStatus === 'ERROR') {
                statusEl.textContent = `FEED ERROR: ${aircraftErrorMessage || 'UNAVAILABLE'}`;
                statusEl.style.color = '#EF4444';
            } else {
                statusEl.textContent = `${aircraftList.length} AIRCRAFT TRACKED // SPECTRUM SECURE`;
                statusEl.style.color = '#00FF47';
            }
        },

        renderTargetDetailModal() {
            const card = document.getElementById('radar-target-detail-card');
            if (!card || !selectedTarget) return;

            const t = selectedTarget;
            card.style.display = 'block';

            let typeBadge = '';
            let bodyHtml = '';

            if (t.type === 'AIRCRAFT') {
                typeBadge = `<span class="status-pill active">COMMERCIAL AIRCRAFT</span>`;
                bodyHtml = `
                    <div style="font-size: 15px; font-weight: 800; color: #00FF47; letter-spacing: 1px;">CALLSIGN: ${t.callsign}</div>
                    <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">ICAO24: <code>${t.icao24}</code> &bull; Origin: ${t.country}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; font-family: var(--font-mono);">
                        <div><b>Distance:</b> ${t.distanceKm} km (${Math.round(t.distanceKm * 0.539957)} NM)</div>
                        <div><b>Bearing:</b> ${t.bearingDeg}° (${t.cardinal})</div>
                        <div><b>Altitude:</b> ${t.altitudeM != null ? `${t.altitudeM} m (${t.altitudeFt} ft)` : 'N/A'}</div>
                        <div><b>Ground Speed:</b> ${t.speedKmh != null ? `${t.speedKmh} km/h (${t.speedKnots} kts)` : 'N/A'}</div>
                        <div><b>True Heading:</b> ${t.headingDeg}°</div>
                        <div><b>Vertical Rate:</b> ${t.verticalRateMs} m/s</div>
                        <div><b>Coordinates:</b> ${t.lat.toFixed(4)}, ${t.lon.toFixed(4)}</div>
                        <div><b>Squawk Code:</b> ${t.squawk}</div>
                    </div>
                `;
            } else if (t.type === 'BLUETOOTH') {
                typeBadge = `<span class="status-pill" style="color: #38BDF8; border-color: #38BDF8;">BLUETOOTH LE</span>`;
                bodyHtml = `
                    <div style="font-size: 15px; font-weight: 800; color: #38BDF8;">DEVICE: ${t.name}</div>
                    <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">CATEGORY: ${t.category.toUpperCase()} &bull; Proximity: ${t.proximity}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; font-family: var(--font-mono);">
                        <div><b>MAC / ID:</b> <code>${t.address}</code></div>
                        <div><b>Signal Strength:</b> ${t.rssi} dBm</div>
                        <div><b>Estimated Range:</b> ${t.proximity}</div>
                        <div><b>Sector:</b> ${t.bearingDeg}° (${t.cardinal})</div>
                    </div>
                `;
            } else {
                const isTs = t.type === 'TAILSCALE';
                typeBadge = `<span class="status-pill" style="color: ${isTs ? '#A855F7' : '#00FF47'};">${isTs ? 'TAILSCALE MESH' : 'LOCAL LAN NODE'}</span>`;
                bodyHtml = `
                    <div style="font-size: 15px; font-weight: 800; color: ${isTs ? '#A855F7' : '#00FF47'};">${t.hostname}</div>
                    <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">IP: <code>${t.ip}</code> ${t.os ? `&bull; OS: ${t.os}` : ''}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; font-family: var(--font-mono);">
                        <div><b>MAC Address:</b> ${t.mac || 'N/A'}</div>
                        <div><b>Link Status:</b> ${t.status}</div>
                        <div><b>Network Layer:</b> ${isTs ? 'Tailscale Mesh (WireGuard)' : 'Local Subnet'}</div>
                        <div><b>Host Type:</b> ${t.isHost ? 'DESK OS PC Workstation' : 'Network Client'}</div>
                    </div>
                `;
            }

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">
                    <div>${typeBadge}</div>
                    <button class="cyber-btn" onclick="RadarEngine.clearSelectedTarget()" style="padding: 2px 8px; min-height: 22px; font-size: 11px;">✕ CLOSE</button>
                </div>
                ${bodyHtml}
            `;
        }
    };
})();

