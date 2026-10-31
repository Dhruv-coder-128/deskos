/**
 * DESK OS — Slot-Based Widget Customization Manager
 * Allows showing/hiding and reordering cards with persistent IndexedDB storage.
 */

const WidgetManager = (() => {
    const DEFAULT_CONFIG = [
        { id: 'card-clock', title: 'System Clock & Date', visible: true, order: 1 },
        { id: 'card-battery', title: 'Hardware Health (M01s)', visible: true, order: 2 },
        { id: 'card-pc', title: 'Host Workstation Link (PC)', visible: true, order: 3 },
        { id: 'card-pc-controls', title: 'PC Workstation Controls', visible: true, order: 4 },
        { id: 'card-pc-cpu', title: 'PC CPU Live Telemetry', visible: true, order: 5 },
        { id: 'card-pc-gpu', title: 'PC GPU (RTX 3050)', visible: true, order: 6 },
        { id: 'card-pc-sys', title: 'PC RAM, Storage & Net', visible: true, order: 7 },
        { id: 'card-sensors', title: 'Dynamic Sensors Lab (M01s)', visible: true, order: 8 },
        { id: 'card-controls', title: 'Panel Hardware Controls', visible: true, order: 9 },
        { id: 'card-notes', title: 'Personal Space Scratchpad', visible: true, order: 10 }
    ];

    let widgetConfig = [...DEFAULT_CONFIG];

    return {
        async init() {
            const saved = await DeskStorage.get('widget_config', null);
            if (saved && Array.isArray(saved)) {
                const savedIds = new Set(saved.map(s => s.id));
                const missing = DEFAULT_CONFIG.filter(d => !savedIds.has(d.id));
                widgetConfig = [...saved, ...missing];
            }
            this.applyConfig();
            this.renderCustomizationModal();
        },

        applyConfig() {
            const grid = document.getElementById('main-widget-grid');
            if (!grid) return;

            // Sort by order property
            widgetConfig.sort((a, b) => a.order - b.order);

            widgetConfig.forEach(cfg => {
                const el = document.getElementById(cfg.id);
                if (el) {
                    el.style.display = cfg.visible ? 'flex' : 'none';
                    el.style.order = cfg.order;
                }
            });
        },

        renderCustomizationModal() {
            const container = document.getElementById('widget-customizer-list');
            if (!container) return;

            container.innerHTML = '';
            widgetConfig.forEach((cfg, index) => {
                const item = document.createElement('div');
                item.className = 'widget-item';
                item.innerHTML = `
                    <label class="widget-toggle">
                        <input type="checkbox" id="toggle-${cfg.id}" ${cfg.visible ? 'checked' : ''}>
                        <span>${cfg.title}</span>
                    </label>
                    <div style="display: flex; gap: 4px;">
                        <button class="cyber-btn" style="padding: 4px 8px;" onclick="WidgetManager.moveCard(${index}, -1)">▲</button>
                        <button class="cyber-btn" style="padding: 4px 8px;" onclick="WidgetManager.moveCard(${index}, 1)">▼</button>
                    </div>
                `;

                const checkbox = item.querySelector(`#toggle-${cfg.id}`);
                checkbox.addEventListener('change', (e) => {
                    cfg.visible = e.target.checked;
                    this.saveAndApply();
                });

                container.appendChild(item);
            });
        },

        moveCard(index, direction) {
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= widgetConfig.length) return;

            // Swap order numbers
            const temp = widgetConfig[index];
            widgetConfig[index] = widgetConfig[targetIndex];
            widgetConfig[targetIndex] = temp;

            widgetConfig.forEach((item, idx) => {
                item.order = idx + 1;
            });

            this.saveAndApply();
            this.renderCustomizationModal();
            UIBridge.triggerHaptic('click');
        },

        async saveAndApply() {
            this.applyConfig();
            await DeskStorage.set('widget_config', widgetConfig);
        },

        resetDefaults() {
            widgetConfig = [...DEFAULT_CONFIG];
            this.saveAndApply();
            this.renderCustomizationModal();
            UIBridge.triggerHaptic('pulse');
        }
    };
})();

