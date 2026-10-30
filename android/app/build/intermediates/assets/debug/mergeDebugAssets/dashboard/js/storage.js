/**
 * DESK OS — IndexedDB & Local Storage Manager
 * 100% Offline-ready local database for notes, tasks, and widget configurations.
 */

const DeskStorage = (() => {
    const DB_NAME = 'deskos_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'app_state';

    let dbInstance = null;

    function initDb() {
        return new Promise((resolve) => {
            if (!window.indexedDB) {
                console.warn('[Storage] IndexedDB not available, falling back to localStorage');
                resolve(null);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };

            request.onerror = () => {
                console.warn('[Storage] Failed to open IndexedDB, falling back to localStorage');
                resolve(null);
            };
        });
    }

    return {
        async get(key, defaultValue = null) {
            if (!dbInstance) await initDb();

            if (dbInstance) {
                return new Promise((resolve) => {
                    try {
                        const tx = dbInstance.transaction(STORE_NAME, 'readonly');
                        const store = tx.objectStore(STORE_NAME);
                        const req = store.get(key);
                        req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
                        req.onerror = () => resolve(defaultValue);
                    } catch {
                        resolve(defaultValue);
                    }
                });
            } else {
                try {
                    const item = localStorage.getItem(`deskos_${key}`);
                    return item ? JSON.parse(item) : defaultValue;
                } catch {
                    return defaultValue;
                }
            }
        },

        async set(key, value) {
            if (!dbInstance) await initDb();

            if (dbInstance) {
                return new Promise((resolve) => {
                    try {
                        const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
                        const store = tx.objectStore(STORE_NAME);
                        store.put({ key, value });
                        tx.oncomplete = () => resolve(true);
                        tx.onerror = () => resolve(false);
                    } catch {
                        resolve(false);
                    }
                });
            } else {
                try {
                    localStorage.setItem(`deskos_${key}`, JSON.stringify(value));
                    return true;
                } catch {
                    return false;
                }
            }
        }
    };
})();

