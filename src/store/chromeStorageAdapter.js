/**
 * title: Chrome Storage Adapter
 * filepath: src/store/chromeStorageAdapter.js
 * 
 * Note: Encryption is NOT handled here. Sensitive data (API keys) is encrypted
 * at the application layer before storage. This adapter provides direct storage
 * access to avoid double-encryption overhead.
 */

// While history encryption is being activated the background reads the saved settings blob as its source.
// Writes are held and coalesced so the panel cannot remove sessions from that blob before the read.
let heldWrites = null;

export function holdStorageWrites() {
    heldWrites ||= new Map();
}

export async function releaseStorageWrites() {
    const held = heldWrites;
    heldWrites = null;
    if (!held) return;
    for (const [name, value] of held) await chromeStorageAdapter.setItem(name, value);
}

const withSettingsLock = (task) => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('tacit-settings-write', task);
    return task();
};

export const chromeStorageAdapter = {
    getItem: async (name) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve, reject) => {
                chrome.storage.local.get([name], (result) => {
                    if (chrome.runtime?.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    const value = result[name];
                    if (!value) {
                        resolve(null);
                        return;
                    }
                    resolve(value);
                });
            });
        }
        // Fallback for development/testing
        try {
            const value = localStorage.getItem(name);
            return Promise.resolve(value ? JSON.parse(value) : null);
        } catch (e) {
            console.warn('LocalStorage fallback failed', e);
            return Promise.resolve(null);
        }
    },
    setItem: async (name, value) => {
        if (heldWrites) {
            heldWrites.set(name, value);
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return withSettingsLock(() => new Promise((resolve, reject) => {
                chrome.storage.local.set({ [name]: value }, () => {
                    if (chrome.runtime?.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    resolve();
                });
            }));
        }
        // Fallback for development/testing
        try {
            localStorage.setItem(name, JSON.stringify(value));
        } catch (e) { } // ignore
        return Promise.resolve();
    },
    removeItem: async (name) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return withSettingsLock(() => new Promise((resolve, reject) => {
                chrome.storage.local.remove([name], () => {
                    if (chrome.runtime?.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    resolve();
                });
            }));
        }
        // Fallback
        try {
            localStorage.removeItem(name);
        } catch (e) { }
        return Promise.resolve();
    }
};
