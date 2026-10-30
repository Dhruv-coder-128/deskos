/**
 * DESK OS — Calendar & Reminders Engine (Personal Space)
 * Interactive Monthly Calendar, Reminders Scheduler, and Background Alarm Checker.
 */

const CalendarModule = (() => {
    let currentViewDate = new Date();
    let selectedDateStr = formatDateKey(new Date());
    let reminders = [];
    let reminderCheckInterval = null;

    function formatDateKey(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    const DEFAULT_REMINDERS = [
        {
            id: 'rem_welcome',
            title: 'WORKSTATION CALIBRATION',
            date: formatDateKey(new Date()),
            time: '18:00',
            priority: 'HIGH',
            notified: false
        }
    ];

    return {
        async init() {
            const saved = await DeskStorage.get('personal_reminders', null);
            if (saved && Array.isArray(saved)) {
                reminders = saved;
            } else {
                reminders = [...DEFAULT_REMINDERS];
                await DeskStorage.set('personal_reminders', reminders);
            }

            this.renderCalendarGrid();
            this.renderRemindersList();
            this.startReminderChecker();
            this.bindEvents();
        },

        bindEvents() {
            const prevBtn = document.getElementById('cal-prev-month');
            const nextBtn = document.getElementById('cal-next-month');
            const todayBtn = document.getElementById('cal-today-btn');
            const addBtn = document.getElementById('add-reminder-btn');

            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    currentViewDate.setMonth(currentViewDate.getMonth() - 1);
                    this.renderCalendarGrid();
                    UIBridge.triggerHaptic('click');
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    currentViewDate.setMonth(currentViewDate.getMonth() + 1);
                    this.renderCalendarGrid();
                    UIBridge.triggerHaptic('click');
                });
            }

            if (todayBtn) {
                todayBtn.addEventListener('click', () => {
                    currentViewDate = new Date();
                    selectedDateStr = formatDateKey(new Date());
                    this.renderCalendarGrid();
                    this.renderRemindersList();
                    UIBridge.triggerHaptic('pulse');
                });
            }

            if (addBtn) {
                addBtn.addEventListener('click', () => this.addReminder());
            }
        },

        renderCalendarGrid() {
            const headerTitle = document.getElementById('cal-month-year');
            const gridContainer = document.getElementById('cal-days-grid');
            if (!gridContainer) return;

            const year = currentViewDate.getFullYear();
            const month = currentViewDate.getMonth();

            const monthNames = [
                'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
            ];

            if (headerTitle) {
                headerTitle.textContent = `${monthNames[month]} ${year}`;
            }

            gridContainer.innerHTML = '';

            // First day of month & total days
            const firstDayIndex = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const todayStr = formatDateKey(new Date());

            // Leading blank padding
            for (let i = 0; i < firstDayIndex; i++) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'cal-day-cell empty';
                gridContainer.appendChild(emptyCell);
            }

            // Month days
            for (let day = 1; day <= daysInMonth; day++) {
                const dayDate = new Date(year, month, day);
                const dayKey = formatDateKey(dayDate);

                const cell = document.createElement('div');
                const isToday = dayKey === todayStr;
                const isSelected = dayKey === selectedDateStr;
                const hasReminder = reminders.some(r => r.date === dayKey);

                cell.className = `cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasReminder ? 'has-reminder' : ''}`;
                cell.innerHTML = `
                    <span class="cal-day-num">${day}</span>
                    ${hasReminder ? '<span class="cal-reminder-dot"></span>' : ''}
                `;

                cell.addEventListener('click', () => {
                    selectedDateStr = dayKey;
                    this.renderCalendarGrid();
                    this.renderRemindersList();
                    UIBridge.triggerHaptic('click');
                });

                gridContainer.appendChild(cell);
            }
        },

        renderRemindersList() {
            const container = document.getElementById('reminders-list-container');
            const filterLabel = document.getElementById('active-date-reminders-label');
            if (!container) return;

            if (filterLabel) {
                filterLabel.textContent = `REMINDERS // ${selectedDateStr}`;
            }

            container.innerHTML = '';
            const matching = reminders.filter(r => r.date === selectedDateStr);

            if (matching.length === 0) {
                container.innerHTML = '<div style="padding: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--color-text-dim); text-align: center;">NO REMINDERS SCHEDULED FOR THIS DATE</div>';
                return;
            }

            matching.forEach(rem => {
                const row = document.createElement('div');
                row.className = `reminder-row ${rem.notified ? 'completed' : ''}`;
                row.innerHTML = `
                    <div style="flex: 1;">
                        <div class="reminder-title">${rem.title}</div>
                        <div class="reminder-meta">
                            <span>TIME: ${rem.time}</span>
                            <span class="status-pill ${rem.priority === 'HIGH' ? 'active' : ''}">${rem.priority}</span>
                        </div>
                    </div>
                    <button class="task-delete-btn" title="Delete Reminder">✕</button>
                `;

                const delBtn = row.querySelector('.task-delete-btn');
                delBtn.addEventListener('click', () => {
                    reminders = reminders.filter(r => r.id !== rem.id);
                    this.saveReminders();
                    this.renderCalendarGrid();
                    this.renderRemindersList();
                    UIBridge.triggerHaptic('click');
                });

                container.appendChild(row);
            });
        },

        addReminder() {
            const titleInput = document.getElementById('new-rem-title');
            const timeInput = document.getElementById('new-rem-time');
            const priorityInput = document.getElementById('new-rem-priority');

            if (!titleInput || !titleInput.value.trim()) return;

            const newRem = {
                id: 'rem_' + Date.now(),
                title: titleInput.value.trim(),
                date: selectedDateStr,
                time: timeInput && timeInput.value ? timeInput.value : '12:00',
                priority: priorityInput ? priorityInput.value : 'NORMAL',
                notified: false
            };

            reminders.push(newRem);
            titleInput.value = '';
            this.saveReminders();
            this.renderCalendarGrid();
            this.renderRemindersList();

            // Check / prompt notification permission if not yet granted
            if (!UIBridge.checkNotificationPermission()) {
                UIBridge.requestNotificationPermission();
            }

            AudioSynth.playChime('success');
            UIBridge.triggerHaptic('pulse');
        },

        startReminderChecker() {
            if (reminderCheckInterval) return;

            // Check every 10 seconds against current time
            reminderCheckInterval = setInterval(() => {
                const now = new Date();
                const todayKey = formatDateKey(now);
                const currentHhMm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                reminders.forEach(rem => {
                    if (!rem.notified && rem.date === todayKey && rem.time === currentHhMm) {
                        rem.notified = true;
                        this.saveReminders();
                        this.renderRemindersList();

                        AudioSynth.playChime('alert');
                        UIBridge.triggerHaptic('alarm');
                        UIBridge.showNotification('WORKSTATION REMINDER', `${rem.title} [${rem.time}]`);
                    }
                });
            }, 10000);
        },

        async saveReminders() {
            await DeskStorage.set('personal_reminders', reminders);
        }
    };
})();

