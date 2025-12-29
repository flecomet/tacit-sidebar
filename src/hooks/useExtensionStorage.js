import { useState, useEffect } from 'react';
import { encrypt, decrypt } from '../utils/encryption';

/**
 * Custom hook to sync state with chrome.storage.local
 * Uses Async Web Crypto for sensitive data.
 * * @param {string} key - Storage key
 * @param {any} defaultValue - Default value
 * @param {boolean} isSensitive - If true, value will be encrypted
 */
export function useExtensionStorage(key, defaultValue, isSensitive = false) {
    const [state, setState] = useState(defaultValue);
    const [isLoaded, setIsLoaded] = useState(false);

    // Initial load
    useEffect(() => {
        const loadValue = async () => {
            try {
                let storedValue = null;

                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const result = await new Promise(resolve =>
                        chrome.storage.local.get([key], resolve)
                    );
                    storedValue = result[key];
                } else {
                    storedValue = localStorage.getItem(key);
                }

                if (storedValue !== undefined && storedValue !== null) {
                    let finalVal = storedValue;

                    if (isSensitive) {
                        finalVal = await decrypt(finalVal);
                    } else {
                        // Parse JSON for non-sensitive data if it looks like JSON
                        try {
                            finalVal = JSON.parse(finalVal);
                        } catch {
                            // Keep as string
                        }
                    }
                    setState(finalVal);
                }
            } catch (err) {
                console.error("Failed to load storage key:", key, err);
            } finally {
                setIsLoaded(true);
            }
        };

        loadValue();
    }, [key, isSensitive]);

    const setStoredValue = async (newValue) => {
        // Optimistic UI update
        setState(newValue);

        try {
            let valueToStore = newValue;

            // Stringify if not sensitive (crypto handles bytes, but we usually encrypt strings)
            // If sensitive, we encrypt the string representation
            if (typeof newValue !== 'string') {
                valueToStore = JSON.stringify(newValue);
            }

            if (isSensitive) {
                valueToStore = await encrypt(valueToStore);
            }

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({ [key]: valueToStore });
            } else {
                localStorage.setItem(key, valueToStore);
            }
        } catch (err) {
            console.error("Failed to save storage key:", key, err);
        }
    };

    return [state, setStoredValue, isLoaded];
}
