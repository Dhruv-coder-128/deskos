/**
 * DESK OS — Multi-List Task Manager (Personal Space)
 * Multiple lists, checklist toggles, progress metrics, and persistent IndexedDB storage.
 */

const TasksModule = (() => {
    let taskLists = [];
    let activeListId = null;

    const DEFAULT_LISTS = [
        {
            id: 'list_daily',
            name: 'DAILY OPERATIONS',
            tasks: [
                { id: 't_1', text: 'Verify workstation hardware link', completed: true, createdAt: Date.now() },
                { id: 't_2', text: 'Calibrate sensor telemetry sparkline', completed: false, createdAt: Date.now() },
                { id: 't_3', text: 'Execute scheduled desk session', completed: false, createdAt: Date.now() }
            ]
        },
        {
            id: 'list_project',
            name: 'DESK OS ROADMAP',
            tasks: [
                { id: 't_p1', text: 'Phase 1: Android Shell & Cyberpunk Dashboard', completed: true, createdAt: Date.now() },
                { id: 't_p2', text: 'Phase 2: Complete Personal Space Suite', completed: true, createdAt: Date.now() },
                { id: 't_p3', text: 'Phase 3: Windows PC Agent Connectivity', completed: false, createdAt: Date.now() }
            ]
        }
    ];

    return {
        async init() {
            const saved = await DeskStorage.get('personal_tasks', null);
            if (saved && Array.isArray(saved) && saved.length > 0) {
                taskLists = saved;
            } else {
                taskLists = [...DEFAULT_LISTS];
                await DeskStorage.set('personal_tasks', taskLists);
            }

            activeListId = taskLists[0].id;
            this.renderListTabs();
            this.renderTasks();
            this.bindEvents();
        },

        bindEvents() {
            const newTaskInput = document.getElementById('new-task-input');
            const addTaskBtn = document.getElementById('add-task-btn');

            if (newTaskInput) {
                newTaskInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') this.addTask();
                });
            }
            if (addTaskBtn) {
                addTaskBtn.addEventListener('click', () => this.addTask());
            }
        },

        renderListTabs() {
            const container = document.getElementById('task-lists-tabs');
            if (!container) return;

            container.innerHTML = '';
            taskLists.forEach(list => {
                const tab = document.createElement('button');
                tab.className = `cyber-btn ${list.id === activeListId ? 'active' : ''}`;
                tab.style.padding = '5px 10px';
                tab.style.fontSize = '10px';
                tab.textContent = list.name;
                tab.addEventListener('click', () => {
                    activeListId = list.id;
                    this.renderListTabs();
                    this.renderTasks();
                    UIBridge.triggerHaptic('click');
                });
                container.appendChild(tab);
            });
        },

        renderTasks() {
            const list = taskLists.find(l => l.id === activeListId) || taskLists[0];
            if (!list) return;

            const container = document.getElementById('tasks-items-container');
            const progressLabel = document.getElementById('tasks-progress-label');
            const progressBar = document.getElementById('tasks-progress-bar');
            const listTitle = document.getElementById('active-task-list-title');

            if (listTitle) listTitle.textContent = list.name;

            const total = list.tasks.length;
            const completed = list.tasks.filter(t => t.completed).length;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            if (progressLabel) progressLabel.textContent = `${completed} / ${total} (${pct}%)`;
            if (progressBar) progressBar.style.width = `${pct}%`;

            if (!container) return;
            container.innerHTML = '';

            if (list.tasks.length === 0) {
                container.innerHTML = '<div style="padding: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--color-text-dim); text-align: center;">NO ACTIVE TASKS IN LIST</div>';
                return;
            }

            list.tasks.forEach(task => {
                const item = document.createElement('div');
                item.className = `task-row ${task.completed ? 'completed' : ''}`;
                item.innerHTML = `
                    <label class="task-checkbox-label">
                        <input type="checkbox" ${task.completed ? 'checked' : ''}>
                        <span class="task-text">${task.text}</span>
                    </label>
                    <button class="task-delete-btn" title="Delete Task">✕</button>
                `;

                const checkbox = item.querySelector('input');
                checkbox.addEventListener('change', () => {
                    task.completed = checkbox.checked;
                    this.saveTasks();
                    this.renderTasks();
                    if (task.completed) {
                        AudioSynth.playChime('success');
                        UIBridge.triggerHaptic('click');
                    }
                });

                const delBtn = item.querySelector('.task-delete-btn');
                delBtn.addEventListener('click', () => {
                    list.tasks = list.tasks.filter(t => t.id !== task.id);
                    this.saveTasks();
                    this.renderTasks();
                    UIBridge.triggerHaptic('click');
                });

                container.appendChild(item);
            });
        },

        addTask() {
            const input = document.getElementById('new-task-input');
            if (!input || !input.value.trim()) return;

            const list = taskLists.find(l => l.id === activeListId);
            if (!list) return;

            const newTask = {
                id: 't_' + Date.now(),
                text: input.value.trim(),
                completed: false,
                createdAt: Date.now()
            };

            list.tasks.push(newTask);
            input.value = '';
            this.saveTasks();
            this.renderTasks();

            AudioSynth.playChime('tick');
            UIBridge.triggerHaptic('pulse');
        },

        createList() {
            const name = prompt('ENTER LIST IDENTIFIER:');
            if (!name || !name.trim()) return;

            const newList = {
                id: 'list_' + Date.now(),
                name: name.trim().toUpperCase(),
                tasks: []
            };

            taskLists.push(newList);
            activeListId = newList.id;
            this.saveTasks();
            this.renderListTabs();
            this.renderTasks();

            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('pulse');
        },

        deleteActiveList() {
            if (taskLists.length <= 1) {
                alert('AT LEAST ONE TASK LIST MUST REMAIN ACTIVE');
                return;
            }

            if (!confirm('DELETE CURRENT TASK LIST?')) return;

            taskLists = taskLists.filter(l => l.id !== activeListId);
            activeListId = taskLists[0].id;
            this.saveTasks();
            this.renderListTabs();
            this.renderTasks();

            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('warning');
        },

        clearCompleted() {
            const list = taskLists.find(l => l.id === activeListId);
            if (!list) return;

            list.tasks = list.tasks.filter(t => !t.completed);
            this.saveTasks();
            this.renderTasks();
            UIBridge.triggerHaptic('click');
        },

        async saveTasks() {
            await DeskStorage.set('personal_tasks', taskLists);
        }
    };
})();

