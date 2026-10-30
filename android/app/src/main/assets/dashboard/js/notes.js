/**
 * DESK OS — Notes Subsystem (Personal Space)
 * Full CRUD, search, debounced auto-save, and persistent IndexedDB storage.
 */

const NotesModule = (() => {
    let notes = [];
    let activeNoteId = null;
    let autoSaveTimer = null;

    const DEFAULT_NOTES = [
        {
            id: 'note_welcome',
            title: 'WORKSTATION BRIEFING',
            content: 'DESK OS // PERSONAL SPACE INITIALIZED\n\n- All notes and task lists are stored locally in IndexedDB.\n- Full offline operation.\n- Palette 3 terminal aesthetic.\n\nType freely to auto-save notes.',
            createdAt: Date.now(),
            updatedAt: Date.now()
        }
    ];

    return {
        async init() {
            const saved = await DeskStorage.get('personal_notes', null);
            if (saved && Array.isArray(saved) && saved.length > 0) {
                notes = saved;
            } else {
                notes = [...DEFAULT_NOTES];
                await DeskStorage.set('personal_notes', notes);
            }

            activeNoteId = notes[0].id;
            this.renderNotesList();
            this.loadActiveNote();
            this.bindEvents();
        },

        bindEvents() {
            const titleInput = document.getElementById('note-title-input');
            const bodyInput = document.getElementById('note-body-textarea');
            const searchInput = document.getElementById('notes-search-input');

            if (titleInput) {
                titleInput.addEventListener('input', () => this.scheduleAutoSave());
            }
            if (bodyInput) {
                bodyInput.addEventListener('input', () => this.scheduleAutoSave());
            }
            if (searchInput) {
                searchInput.addEventListener('input', (e) => this.filterNotes(e.target.value));
            }
        },

        renderNotesList(filterText = '') {
            const container = document.getElementById('notes-list-container');
            if (!container) return;

            container.innerHTML = '';
            const filtered = notes.filter(n =>
                n.title.toLowerCase().includes(filterText.toLowerCase()) ||
                n.content.toLowerCase().includes(filterText.toLowerCase())
            );

            if (filtered.length === 0) {
                container.innerHTML = '<div style="padding: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--color-text-dim); text-align: center;">NO NOTES FOUND</div>';
                return;
            }

            filtered.forEach(note => {
                const item = document.createElement('div');
                item.className = `note-list-item ${note.id === activeNoteId ? 'active' : ''}`;
                const preview = note.content.replace(/\n/g, ' ').substring(0, 45);
                const dateStr = new Date(note.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

                item.innerHTML = `
                    <div class="note-item-title">${note.title || 'UNTITLED'}</div>
                    <div class="note-item-preview">${preview || 'Empty note...'}</div>
                    <div class="note-item-meta">${dateStr}</div>
                `;

                item.addEventListener('click', () => {
                    this.setActiveNote(note.id);
                });

                container.appendChild(item);
            });
        },

        loadActiveNote() {
            const note = notes.find(n => n.id === activeNoteId);
            const titleInput = document.getElementById('note-title-input');
            const bodyInput = document.getElementById('note-body-textarea');
            const statusLabel = document.getElementById('note-save-status');

            if (!note) {
                if (titleInput) titleInput.value = '';
                if (bodyInput) bodyInput.value = '';
                if (statusLabel) statusLabel.textContent = 'NO NOTE SELECTED';
                return;
            }

            if (titleInput) titleInput.value = note.title;
            if (bodyInput) bodyInput.value = note.content;
            if (statusLabel) statusLabel.textContent = 'SYNCED';
        },

        setActiveNote(id) {
            activeNoteId = id;
            this.loadActiveNote();
            this.renderNotesList();
            UIBridge.triggerHaptic('click');
        },

        createNote() {
            const newNote = {
                id: 'note_' + Date.now(),
                title: 'NEW_RECORD_' + (notes.length + 1),
                content: '',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            notes.unshift(newNote);
            activeNoteId = newNote.id;
            this.saveNotes();
            this.renderNotesList();
            this.loadActiveNote();

            const titleInput = document.getElementById('note-title-input');
            if (titleInput) titleInput.focus();

            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('pulse');
        },

        deleteActiveNote() {
            if (!activeNoteId || notes.length <= 1) {
                // If only one note, simply clear it
                const note = notes[0];
                if (note) {
                    note.title = 'UNTITLED';
                    note.content = '';
                    note.updatedAt = Date.now();
                    this.saveNotes();
                    this.loadActiveNote();
                    this.renderNotesList();
                }
                return;
            }

            notes = notes.filter(n => n.id !== activeNoteId);
            activeNoteId = notes[0].id;
            this.saveNotes();
            this.renderNotesList();
            this.loadActiveNote();

            AudioSynth.playChime('click');
            UIBridge.triggerHaptic('warning');
        },

        scheduleAutoSave() {
            const statusLabel = document.getElementById('note-save-status');
            if (statusLabel) statusLabel.textContent = 'SAVING...';

            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                this.commitCurrentNote();
            }, 350);
        },

        commitCurrentNote() {
            const note = notes.find(n => n.id === activeNoteId);
            if (!note) return;

            const titleInput = document.getElementById('note-title-input');
            const bodyInput = document.getElementById('note-body-textarea');
            const statusLabel = document.getElementById('note-save-status');

            note.title = titleInput ? titleInput.value.trim() : 'UNTITLED';
            note.content = bodyInput ? bodyInput.value : '';
            note.updatedAt = Date.now();

            this.saveNotes();
            this.renderNotesList();

            if (statusLabel) statusLabel.textContent = 'AUTO-SAVED';
        },

        async saveNotes() {
            await DeskStorage.set('personal_notes', notes);
        },

        filterNotes(query) {
            this.renderNotesList(query);
        }
    };
})();

