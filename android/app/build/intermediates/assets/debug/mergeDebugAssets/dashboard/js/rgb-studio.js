/**
 * DESK OS — Lenovo LOQ Advanced 4-Zone RGB Studio
 * Hardware-accurate keyboard lighting controller for Lenovo LOQ 15IRX9 (ITE 8295 / C993).
 *
 * Restored original layout:
 * - Original physical 4-zone keyboard chassis mapping with real-time key illumination.
 * - Side-by-side color picker and effects library cards.
 * - Original 12 Cyberpunk Quick Swatches + native picker.
 * - Original permanent profile cards with 4-zone preview strips and one-tap apply.
 * - Profile CRUD (create, rename, duplicate, edit, delete, export/import).
 * - Reliable hardware feedback state machine (updates UI only after confirmed hardware success).
 */

const RGBStudio = (function () {
    'use strict';

    // State
    let selectedZone = 0; // 0 = Zone 1, 1 = Zone 2, 2 = Zone 3, 3 = Zone 4, -1 = All
    let currentMode = 'wave_lr';
    let currentSpeed = 2;
    let currentBrightness = 2;
    let currentDirection = 'left_to_right';
    let currentColors = [
        [0, 240, 255],   // Zone 1: Cyan
        [255, 0, 127],   // Zone 2: Magenta
        [138, 43, 226],  // Zone 3: Violet
        [255, 230, 0]    // Zone 4: Amber
    ];
    let profiles = [];
    let activeProfileId = 'cyberpunk';
    let isMasterOn = true;
    let isApplying = false;
    let pendingEffectBtn = null;
    let applyTimeout = null;

    const CYBER_PALETTE = [
        { name: 'Cyan', hex: '#00F0FF', rgb: [0, 240, 255] },
        { name: 'Magenta', hex: '#FF007F', rgb: [255, 0, 128] },
        { name: 'Matrix', hex: '#00FF41', rgb: [0, 255, 65] },
        { name: 'Violet', hex: '#8A2BE2', rgb: [138, 43, 226] },
        { name: 'Amber', hex: '#FFE600', rgb: [255, 230, 0] },
        { name: 'Flame', hex: '#FF4500', rgb: [255, 69, 0] },
        { name: 'Red', hex: '#FF0033', rgb: [255, 0, 51] },
        { name: 'Ice', hex: '#00D2FF', rgb: [0, 210, 255] },
        { name: 'Blue', hex: '#0055FF', rgb: [0, 85, 255] },
        { name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255] },
        { name: 'Mint', hex: '#00FFAA', rgb: [0, 255, 170] },
        { name: 'Pink', hex: '#FF1493', rgb: [255, 20, 147] }
    ];

    function init() {
        console.log('[RGBStudio] Initializing restored 4-Zone RGB Studio...');
        renderCyberSwatches();
        bindEvents();
        updateKeyboardVisuals();
        requestServerState();
        requestServerProfiles();
    }

    function renderCyberSwatches() {
        const container = document.getElementById('rgb-swatches-grid');
        if (!container) return;
        let html = '';
        CYBER_PALETTE.forEach(c => {
            html += `
                <button type="button" class="rgb-swatch-btn" style="background-color: ${c.hex};" 
                        title="${c.name}" data-hex="${c.hex}" data-r="${c.rgb[0]}" data-g="${c.rgb[1]}" data-b="${c.rgb[2]}">
                </button>
            `;
        });
        container.innerHTML = html;
    }

    function bindEvents() {
        // Zone visual selection on keyboard chassis
        for (let i = 1; i <= 4; i++) {
            const zEl = document.getElementById(`kb-zone-${i}`);
            if (zEl) {
                zEl.addEventListener('click', () => selectZone(i - 1));
            }
        }

        const allZonesBtn = document.getElementById('rgb-btn-all-zones');
        if (allZonesBtn) {
            allZonesBtn.addEventListener('click', () => selectZone(-1));
        }

        // Color Swatches
        const swatchesContainer = document.getElementById('rgb-swatches-grid');
        if (swatchesContainer) {
            swatchesContainer.addEventListener('click', e => {
                const btn = e.target.closest('.rgb-swatch-btn');
                if (btn) {
                    const r = parseInt(btn.dataset.r, 10);
                    const g = parseInt(btn.dataset.g, 10);
                    const b = parseInt(btn.dataset.b, 10);
                    applyColorToSelectedZone(r, g, b);
                }
            });
        }

        // Native Color Picker input
        const colorPicker = document.getElementById('rgb-native-picker');
        if (colorPicker) {
            colorPicker.addEventListener('input', e => {
                const hex = e.target.value;
                const rgb = hexToRgb(hex);
                if (rgb) {
                    applyColorToSelectedZone(rgb.r, rgb.g, rgb.b);
                }
            });
        }

        // Master Backlight Toggle
        const masterToggle = document.getElementById('rgb-master-toggle');
        if (masterToggle) {
            masterToggle.addEventListener('click', toggleMasterPower);
        }

        // Speed Slider
        const speedSlider = document.getElementById('rgb-speed-slider');
        if (speedSlider) {
            speedSlider.addEventListener('input', e => {
                currentSpeed = parseInt(e.target.value, 10);
                const valEl = document.getElementById('rgb-speed-val');
                if (valEl) valEl.textContent = `${currentSpeed}x`;
                sendEffectUpdate();
            });
        }

        // Brightness Slider
        const brightSlider = document.getElementById('rgb-bright-slider');
        if (brightSlider) {
            brightSlider.addEventListener('input', e => {
                currentBrightness = parseInt(e.target.value, 10);
                const valEl = document.getElementById('rgb-bright-val');
                const labels = ['OFF', '50% (LOW)', '100% (HIGH)'];
                if (valEl) valEl.textContent = labels[currentBrightness] || `${currentBrightness}`;
                isMasterOn = (currentBrightness > 0);
                updateMasterToggleVisual();
                sendEffectUpdate();
            });
        }

        // Direction Toggle
        const dirToggle = document.getElementById('rgb-direction-toggle');
        if (dirToggle) {
            dirToggle.addEventListener('click', () => {
                currentDirection = (currentDirection === 'left_to_right') ? 'right_to_left' : 'left_to_right';
                dirToggle.textContent = currentDirection === 'left_to_right' ? 'DIRECTION: L → R' : 'DIRECTION: R → L';
                sendEffectUpdate();
            });
        }

        // Effect Buttons with Hardware Feedback
        const effectBtns = document.querySelectorAll('.rgb-effect-btn');
        effectBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const requestedEffect = btn.dataset.effect || 'static';
                selectEffect(requestedEffect, btn);
            });
        });

        // Save Custom Profile Button
        const saveProfBtn = document.getElementById('rgb-btn-save-profile');
        if (saveProfBtn) {
            saveProfBtn.addEventListener('click', promptSaveProfile);
        }

        // Export Profiles Button
        const exportBtn = document.getElementById('rgb-btn-export-profiles');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportProfiles);
        }

        // Import Profiles Button
        const importBtn = document.getElementById('rgb-btn-import-profiles');
        if (importBtn) {
            importBtn.addEventListener('click', promptImportProfiles);
        }
    }

    function selectZone(zoneIndex) {
        selectedZone = zoneIndex;

        for (let i = 1; i <= 4; i++) {
            const zEl = document.getElementById(`kb-zone-${i}`);
            const pEl = document.getElementById(`zone-pill-${i}`);
            const isSel = (zoneIndex === -1) || (zoneIndex === (i - 1));

            if (zEl) zEl.classList.toggle('selected', isSel);
            if (pEl) pEl.classList.toggle('active', zoneIndex === (i - 1));
        }

        const allBtn = document.getElementById('rgb-btn-all-zones');
        if (allBtn) {
            allBtn.classList.toggle('active', zoneIndex === -1);
        }

        const lbl = document.getElementById('rgb-selected-zone-label');
        if (lbl) {
            lbl.textContent = zoneIndex === -1 ? 'ALL ZONES' : `ZONE ${zoneIndex + 1}`;
        }

        if (zoneIndex >= 0 && zoneIndex < 4) {
            const c = currentColors[zoneIndex];
            const hex = rgbToHex(c[0], c[1], c[2]);
            const picker = document.getElementById('rgb-native-picker');
            const hexDisplay = document.getElementById('rgb-hex-display');
            if (picker) picker.value = hex;
            if (hexDisplay) hexDisplay.textContent = hex;
        }

        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('click');
        }
    }

    function applyColorToSelectedZone(r, g, b) {
        if (selectedZone === -1) {
            for (let i = 0; i < 4; i++) {
                currentColors[i] = [r, g, b];
            }
        } else if (selectedZone >= 0 && selectedZone < 4) {
            currentColors[selectedZone] = [r, g, b];
        }

        const hex = rgbToHex(r, g, b);
        const picker = document.getElementById('rgb-native-picker');
        const hexDisplay = document.getElementById('rgb-hex-display');
        if (picker) picker.value = hex;
        if (hexDisplay) hexDisplay.textContent = hex;

        updateKeyboardVisuals();

        // When custom color is picked, switch to static zone mode
        currentMode = 'static';
        document.querySelectorAll('.rgb-effect-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.effect === 'static');
        });

        sendAction({
            action: 'set_zones',
            colors: currentColors,
            brightness: currentBrightness
        });

        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('click');
        }
    }

    function selectEffect(effectName, btnEl) {
        if (isApplying) return;
        isApplying = true;
        pendingEffectBtn = btnEl;

        const badge = document.getElementById('rgb-effect-status-badge');
        if (badge) {
            badge.textContent = 'APPLYING...';
            badge.style.color = '#FFE600';
        }

        const profStatus = document.getElementById('rgb-profile-status');
        if (profStatus) {
            profStatus.textContent = `EFFECT: ${effectName.toUpperCase()}`;
        }

        if (btnEl) {
            btnEl.classList.add('evaluating');
        }

        sendAction({
            action: 'set_effect',
            mode: effectName,
            speed: currentSpeed,
            brightness: currentBrightness,
            direction: currentDirection,
            colors: currentColors
        });

        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('click');
        }

        clearTimeout(applyTimeout);
        applyTimeout = setTimeout(() => {
            if (isApplying) {
                isApplying = false;
                if (pendingEffectBtn) pendingEffectBtn.classList.remove('evaluating');
                if (badge) {
                    badge.textContent = 'READY';
                    badge.style.color = '';
                }
            }
        }, 3000);
    }

    function toggleMasterPower() {
        isMasterOn = !isMasterOn;
        currentBrightness = isMasterOn ? 2 : 0;

        const brightSlider = document.getElementById('rgb-bright-slider');
        const valEl = document.getElementById('rgb-bright-val');
        if (brightSlider) brightSlider.value = currentBrightness;
        if (valEl) valEl.textContent = isMasterOn ? '100% (HIGH)' : 'OFF';

        updateMasterToggleVisual();

        if (!isMasterOn) {
            sendAction({ action: 'turn_off' });
        } else {
            sendEffectUpdate();
        }

        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('click');
        }
    }

    function updateMasterToggleVisual() {
        const toggle = document.getElementById('rgb-master-toggle');
        if (toggle) {
            toggle.classList.toggle('active', isMasterOn);
            toggle.textContent = isMasterOn ? 'BACKLIGHT: ON' : 'BACKLIGHT: OFF';
        }
    }

    function sendEffectUpdate() {
        sendAction({
            action: 'set_effect',
            mode: currentMode,
            speed: currentSpeed,
            brightness: currentBrightness,
            direction: currentDirection,
            colors: currentColors
        });
    }

    function updateKeyboardVisuals() {
        for (let i = 0; i < 4; i++) {
            const c = currentColors[i];
            const rgbStr = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
            const hex = rgbToHex(c[0], c[1], c[2]);

            // Zone container block
            const zEl = document.getElementById(`kb-zone-${i + 1}`);
            if (zEl) {
                zEl.style.backgroundColor = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.12)`;
                zEl.style.borderColor = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.6)`;
                zEl.style.boxShadow = `0 0 15px rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.3)`;
            }

            // Zone pill button dot
            const pEl = document.getElementById(`zone-pill-${i + 1}`);
            if (pEl) {
                const dot = pEl.querySelector('.zone-dot');
                if (dot) dot.style.backgroundColor = hex;
            }
        }
    }

    function applyProfile(profileId) {
        if (isApplying) return;
        isApplying = true;

        const prof = profiles.find(p => p.id === profileId);
        const badge = document.getElementById('rgb-effect-status-badge');
        if (badge) {
            badge.textContent = 'APPLYING PROFILE...';
            badge.style.color = '#FFE600';
        }

        const profStatus = document.getElementById('rgb-profile-status');
        if (profStatus) {
            profStatus.textContent = `APPLYING: ${(prof ? prof.name : profileId).toUpperCase()}`;
        }

        sendAction({
            action: 'apply_profile',
            profile_id: profileId
        });

        if (typeof UIBridge !== 'undefined') {
            UIBridge.triggerHaptic('click');
        }

        clearTimeout(applyTimeout);
        applyTimeout = setTimeout(() => {
            if (isApplying) {
                isApplying = false;
                if (badge) {
                    badge.textContent = 'READY';
                    badge.style.color = '';
                }
            }
        }, 3000);
    }

    function renderProfilesCards() {
        const container = document.getElementById('rgb-profiles-list');
        if (!container) return;

        let html = '';
        profiles.forEach(p => {
            const isActive = (p.id === activeProfileId);
            const colors = p.colors || [[0, 240, 255], [255, 0, 128], [138, 43, 226], [255, 230, 0]];
            const isPreset = !!p.is_preset;

            html += `
                <div class="rgb-profile-card ${isActive ? 'active' : ''}" onclick="RGBStudio.applyProfile('${p.id}')">
                    <div class="profile-card-header">
                        <span class="profile-name" title="${p.name}">${p.name}</span>
                        <div class="profile-actions-strip" onclick="event.stopPropagation()">
                            ${isActive ? '<span class="profile-active-tag">ACTIVE</span>' : ''}
                            <button type="button" class="profile-action-mini-btn" title="Update with current colors/settings" onclick="RGBStudio.editProfile('${p.id}')">✏️</button>
                            <button type="button" class="profile-action-mini-btn" title="Duplicate profile" onclick="RGBStudio.duplicateProfile('${p.id}')">📋</button>
                            <button type="button" class="profile-action-mini-btn" title="Rename profile" onclick="RGBStudio.renameProfile('${p.id}')">🏷️</button>
                            ${!isPreset ? `<button type="button" class="profile-action-mini-btn" title="Delete custom profile" onclick="RGBStudio.deleteProfile('${p.id}')">🗑️</button>` : ''}
                        </div>
                    </div>
                    <div class="profile-color-strip">
                        <span style="background: rgb(${colors[0].join(',')});"></span>
                        <span style="background: rgb(${colors[1].join(',')});"></span>
                        <span style="background: rgb(${colors[2].join(',')});"></span>
                        <span style="background: rgb(${colors[3].join(',')});"></span>
                    </div>
                    <div class="profile-meta">
                        <span>MODE: ${(p.mode || p.effect || 'STATIC').toUpperCase()}</span>
                        <span>SPEED: ${p.speed || 1}x</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    function editProfile(profileId) {
        const p = profiles.find(item => item.id === profileId);
        if (!p) return;
        if (confirm(`Save current colors, effect (${currentMode.toUpperCase()}), and speed to profile "${p.name}"?`)) {
            sendAction({
                action: 'update_profile',
                profile_id: profileId,
                name: p.name,
                mode: currentMode,
                speed: currentSpeed,
                brightness: currentBrightness,
                direction: currentDirection,
                colors: currentColors
            });
        }
    }

    function duplicateProfile(profileId) {
        const p = profiles.find(item => item.id === profileId);
        if (!p) return;
        const newName = prompt(`Enter name for duplicate profile:`, `${p.name} (Copy)`);
        if (!newName || !newName.trim()) return;
        sendAction({
            action: 'duplicate_profile',
            profile_id: profileId,
            new_name: newName.trim()
        });
    }

    function renameProfile(profileId) {
        const p = profiles.find(item => item.id === profileId);
        if (!p) return;
        const newName = prompt(`Enter new name for profile:`, p.name);
        if (!newName || !newName.trim() || newName.trim() === p.name) return;
        sendAction({
            action: 'rename_profile',
            profile_id: profileId,
            new_name: newName.trim()
        });
    }

    function deleteProfile(profileId) {
        const p = profiles.find(item => item.id === profileId);
        if (!p) return;
        if (confirm(`Are you sure you want to delete profile "${p.name}"?`)) {
            sendAction({
                action: 'delete_profile',
                profile_id: profileId
            });
        }
    }

    function promptSaveProfile() {
        const name = prompt('Enter a name for this custom RGB profile:');
        if (!name || !name.trim()) return;

        sendAction({
            action: 'save_profile',
            name: name.trim(),
            mode: currentMode,
            speed: currentSpeed,
            brightness: currentBrightness,
            direction: currentDirection,
            colors: currentColors
        });
    }

    function exportProfiles() {
        const jsonStr = JSON.stringify(profiles, null, 2);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(jsonStr).then(() => {
                alert('Profiles JSON copied to clipboard!');
            }).catch(() => {
                prompt('Copy profiles JSON:', jsonStr);
            });
        } else {
            prompt('Copy profiles JSON:', jsonStr);
        }
    }

    function promptImportProfiles() {
        const input = prompt('Paste RGB profiles JSON to import:');
        if (!input) return;
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed) && parsed.length > 0) {
                sendAction({
                    action: 'import_profiles',
                    profiles: parsed
                });
            } else {
                alert('Invalid profiles array.');
            }
        } catch (e) {
            alert('Invalid JSON format: ' + e.message);
        }
    }

    function requestServerState() {
        if (typeof DeskOS !== 'undefined' && DeskOS.sendWebSocketMessage) {
            DeskOS.sendWebSocketMessage({ type: 'get_rgb_state' });
        }
    }

    function requestServerProfiles() {
        if (typeof DeskOS !== 'undefined' && DeskOS.sendWebSocketMessage) {
            DeskOS.sendWebSocketMessage({ type: 'get_rgb_profiles' });
        }
    }

    function onServerStateReceived(state) {
        if (!state) return;
        if (state.mode) currentMode = state.mode;
        if (state.speed !== undefined) {
            currentSpeed = state.speed;
            const speedSlider = document.getElementById('rgb-speed-slider');
            const valEl = document.getElementById('rgb-speed-val');
            if (speedSlider) speedSlider.value = currentSpeed;
            if (valEl) valEl.textContent = `${currentSpeed}x`;
        }
        if (state.brightness !== undefined) {
            currentBrightness = state.brightness;
            const brightSlider = document.getElementById('rgb-bright-slider');
            const valEl = document.getElementById('rgb-bright-val');
            const labels = ['OFF', '50% (LOW)', '100% (HIGH)'];
            if (brightSlider) brightSlider.value = currentBrightness;
            if (valEl) valEl.textContent = labels[currentBrightness] || `${currentBrightness}`;
            isMasterOn = (currentBrightness > 0);
            updateMasterToggleVisual();
        }
        if (state.direction) {
            currentDirection = state.direction;
            const dirToggle = document.getElementById('rgb-direction-toggle');
            if (dirToggle) {
                dirToggle.textContent = currentDirection === 'left_to_right' ? 'DIRECTION: L → R' : 'DIRECTION: R → L';
            }
        }
        if (state.colors && state.colors.length === 4) {
            currentColors = state.colors;
        }
        if (state.active_profile_id) {
            activeProfileId = state.active_profile_id;
            const prof = profiles.find(p => p.id === activeProfileId);
            const profStatus = document.getElementById('rgb-profile-status');
            if (profStatus) {
                profStatus.textContent = prof ? `PRESET: ${prof.name.toUpperCase()}` : `PRESET: ${activeProfileId.toUpperCase()}`;
            }
        }

        updateKeyboardVisuals();
        renderProfilesCards();

        // Update active effect button
        document.querySelectorAll('.rgb-effect-btn').forEach(b => {
            const match = (b.dataset.effect === currentMode);
            b.classList.toggle('active', match);
        });

        // Diagnostic accordion updates
        const devEl = document.getElementById('rgb-diag-model');
        const workerEl = document.getElementById('rgb-diag-worker');
        const stateEl = document.getElementById('rgb-diag-applied');
        if (devEl && state.keyboard_model) devEl.textContent = state.keyboard_model;
        if (workerEl) workerEl.textContent = state.controller_thread_alive ? 'ACTIVE' : 'IDLE';
        if (stateEl) stateEl.textContent = (state.applied_mode || currentMode).toUpperCase();
    }

    function onServerProfilesReceived(profList) {
        if (Array.isArray(profList)) {
            profiles = profList;
            renderProfilesCards();
        }
    }

    function onServerResultReceived(res) {
        isApplying = false;
        clearTimeout(applyTimeout);
        if (pendingEffectBtn) {
            pendingEffectBtn.classList.remove('evaluating');
        }

        const badge = document.getElementById('rgb-effect-status-badge');
        const errEl = document.getElementById('rgb-diag-error');
        const resEl = document.getElementById('rgb-diag-result');
        const stateEl = document.getElementById('rgb-diag-applied');

        if (res.success) {
            if (badge) {
                badge.textContent = 'ACTIVE // CONFIRMED';
                badge.style.color = 'var(--color-accent-primary)';
                setTimeout(() => { if (badge) { badge.textContent = 'READY'; badge.style.color = ''; } }, 2000);
            }
            if (resEl) resEl.textContent = 'SUCCESS';
            if (stateEl) stateEl.textContent = 'CONFIRMED';
            if (errEl) errEl.textContent = 'None';

            if (res.action === 'apply_profile' && res.state) {
                if (res.state.active_profile_id) {
                    activeProfileId = res.state.active_profile_id;
                }
                onServerStateReceived(res.state);
            } else if (res.action === 'set_effect' && res.state) {
                onServerStateReceived(res.state);
            } else if (res.action === 'save_profile' || res.action === 'update_profile' || res.action === 'duplicate_profile' || res.action === 'rename_profile' || res.action === 'delete_profile' || res.action === 'import_profiles') {
                if (res.profiles) {
                    profiles = res.profiles;
                    renderProfilesCards();
                }
                if (res.action === 'save_profile' && res.profile) {
                    activeProfileId = res.profile.id;
                    renderProfilesCards();
                }
            }
        } else {
            if (badge) {
                badge.textContent = 'FAILED';
                badge.style.color = '#FF0033';
            }
            if (resEl) resEl.textContent = 'FAILED';
            if (errEl) errEl.textContent = res.message || 'Hardware error';
            alert(`RGB Error: ${res.message || 'Failed to apply effect to hardware'}`);
        }
    }

    function sendAction(payload) {
        if (typeof DeskOS !== 'undefined' && DeskOS.sendWebSocketMessage) {
            DeskOS.sendWebSocketMessage({
                type: 'rgb_action',
                ...payload
            });
        }
    }

    // Helpers
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => {
            const hex = Math.max(0, Math.min(255, x)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    return {
        init,
        applyProfile,
        editProfile,
        duplicateProfile,
        renameProfile,
        deleteProfile,
        selectZone,
        promptSaveProfile,
        exportProfiles,
        promptImportProfiles,
        onServerStateReceived,
        onServerProfilesReceived,
        onServerResultReceived
    };
})();
