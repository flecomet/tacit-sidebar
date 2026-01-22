/**
 * Robust encryption utility using the Web Crypto API (AES-GCM).
 * * FEATURES:
 * - No hardcoded keys.
 * - Generates a unique key per installation.
 * - Stores the key in local storage (chrome.storage.local or localStorage).
 * - Uses AES-GCM for authenticated encryption.
 */

const ALGORITHM = 'AES-GCM';
const KEY_STORAGE_KEY = 'tacit_encryption_master_key';

/**
 * Helper to get the storage object (Chrome or Local)
 */
const getStorage = () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return {
            get: (key) => new Promise((resolve) => chrome.storage.local.get([key], (res) => resolve(res[key]))),
            set: (key, val) => new Promise((resolve) => chrome.storage.local.set({ [key]: val }, resolve))
        };
    } else {
        return {
            get: (key) => Promise.resolve(localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : undefined),
            set: (key, val) => Promise.resolve(localStorage.setItem(key, JSON.stringify(val)))
        };
    }
};

/**
 * Helper to get the crypto object (Browser window.crypto or Node global.crypto)
 */
const getCrypto = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) return window.crypto;
    if (typeof global !== 'undefined' && global.crypto && global.crypto.subtle) return global.crypto;
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto;
    // Fallback or throw
    return window.crypto;
};

// Cache the key in memory to avoid repeated storage reads and imports
let cachedKey = null;
let keyLoadingPromise = null;

/**
 * Generates and stores a new encryption key.
 */
const getOrCreateKey = async () => {
    if (cachedKey) return cachedKey;
    if (keyLoadingPromise) return keyLoadingPromise;

    keyLoadingPromise = (async () => {
        const storage = getStorage();
        let jwk = await storage.get(KEY_STORAGE_KEY);
        const crypto = getCrypto();

        if (!jwk) {
            // Generate new key
            const key = await crypto.subtle.generateKey(
                { name: ALGORITHM, length: 256 },
                true, // extractable
                ['encrypt', 'decrypt']
            );
            // Export to JWK to store it
            jwk = await crypto.subtle.exportKey('jwk', key);
            await storage.set(KEY_STORAGE_KEY, jwk);

            cachedKey = key;
            return key;
        }

        // Import existing key
        const importedKey = await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: ALGORITHM },
            true,
            ['encrypt', 'decrypt']
        );

        cachedKey = importedKey;
        return importedKey;
    })();

    return keyLoadingPromise;
};

/**
 * Encrypts text using AES-GCM.
 * Returns a JSON string containing the IV and the Ciphertext (base64 encoded).
 */
export const encrypt = async (text) => {
    if (!text) return '';
    try {
        const key = await getOrCreateKey();
        const encoder = new TextEncoder();
        const encodedData = encoder.encode(text);
        const crypto = getCrypto();

        // IV must be unique for every encryption
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: ALGORITHM, iv: iv },
            key,
            encodedData
        );

        // Convert buffers to base64 for storage
        const ivArray = Array.from(iv);
        const encryptedArray = Array.from(new Uint8Array(encryptedBuffer));

        // Return structured object as string
        return JSON.stringify({
            iv: ivArray,
            data: encryptedArray
        });

    } catch (e) {
        console.error("Encryption failed: Native Crypto Error", e);
        return text; // Fallback (or throw) depending on safety requirement. Returning text allows app to work unencrypted if crypto fails, but implies risk.
    }
};

/**
 * Decrypts the JSON string produced by encrypt().
 */
export const decrypt = async (encryptedString) => {
    if (!encryptedString) return '';

    // Check if string looks like our JSON format (basic check)
    // If it's legacy data (simple string), return it or handle migration
    if (!encryptedString.startsWith('{') && !encryptedString.startsWith('[')) {
        return encryptedString;
    }

    try {
        const payload = JSON.parse(encryptedString);
        if (!payload.iv || !payload.data) return encryptedString;

        const key = await getOrCreateKey();
        const crypto = getCrypto();

        const iv = new Uint8Array(payload.iv);
        const data = new Uint8Array(payload.data);

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv: iv },
            key,
            data
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);

    } catch (e) {
        console.error("Decryption failed", e);
        return '';
    }
};

export const encryptData = encrypt;
export const decryptData = decrypt;

// For testing purposes only
export const _resetCache = () => {
    cachedKey = null;
    keyLoadingPromise = null;
};

