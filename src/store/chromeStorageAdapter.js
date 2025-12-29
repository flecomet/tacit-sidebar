/**
 * title: Chrome Storage Adapter
 * filepath: src/store/chromeStorageAdapter.js
 */

import { encryptData, decryptData } from '../utils/encryption';

export const chromeStorageAdapter = {
    getItem: async (name) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.get([name], async (result) => {
                    const value = result[name];
                    if (!value) {
                        resolve(null);
                        return;
                    }
                    const decrypted = await decryptData(value);
                    resolve(decrypted);
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
            const encrypted = await encryptData(value);
            return new Promise((resolve) => {
                chrome.storage.local.set({ [name]: encrypted }, () => {
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
