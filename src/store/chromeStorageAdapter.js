/**
 * title: Chrome Storage Adapter
 * filepath: src/store/chromeStorageAdapter.js
 * 
 * Note: Encryption is NOT handled here. Sensitive data (API keys) is encrypted
 * at the application layer before storage. This adapter provides direct storage
 * access to avoid double-encryption overhead.
 */

export const chromeStorageAdapter = {
    getItem: async (name) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.get([name], (result) => {
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
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ [name]: value }, () => {
                    resolve();
                });
            });
        }
        // Fallback for development/testing
        try {
            localStorage.setItem(name, JSON.stringify(value));
        } catch (e) { } // ignore
        return Promise.resolve();
    },
    removeItem: async (name) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.remove([name], () => {
                    resolve();
                });
            });
        }
        // Fallback
        try {
            localStorage.removeItem(name);
        } catch (e) { }
        return Promise.resolve();
    }
};
