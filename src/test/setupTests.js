import { vi } from 'vitest';

// Define the chrome mock
const storageMap = {};
const chromeMock = {
    storage: {
        local: {
            get: vi.fn((keys, callback) => {
                let result = {};
                if (!keys) result = { ...storageMap };
                else if (typeof keys === 'string') result = { [keys]: storageMap[keys] };
                else if (Array.isArray(keys)) {
                    keys.forEach(k => result[k] = storageMap[k]);
                }

                // Support callback style
                if (typeof callback === 'function') {
                    callback(result);
                }
                // Return promise for async/await style usage in other places if any
                return Promise.resolve(result);
            }),
            set: vi.fn((items, callback) => {
                Object.assign(storageMap, items);
                if (typeof callback === 'function') {
                    callback();
                }
                return Promise.resolve();
            }),
            clear: vi.fn((callback) => {
                for (const key in storageMap) delete storageMap[key];
                if (typeof callback === 'function') {
                    callback();
                }
                return Promise.resolve();
            }),
        },
    },
    runtime: {
        getURL: vi.fn((path) => `chrome-extension://mock-id/${path}`),
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn(),
        },
    },
    tabs: {
        query: vi.fn(),
    },
    scripting: {
        executeScript: vi.fn(),
    },
    sidePanel: {
        setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
};

// Global polyfills/mocks
global.chrome = chromeMock;

// Mock FileReader if needed (though it exists in jsdom)
if (typeof FileReader === 'undefined') {
    global.FileReader = class {
        readAsText() { }
        readAsDataURL() { }
        readAsArrayBuffer() { }
    };
}

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Polyfill Web Crypto API with manual mock for stability in JSDOM
const mockCrypto = {
    subtle: {
        generateKey: vi.fn(async () => ({ type: 'secret', name: 'AES-GCM' })),
        exportKey: vi.fn(async () => ({ k: 'mock-key-data', alg: 'A128GCM', ext: true, kty: 'oct', ops: ['encrypt', 'decrypt'] })),
        importKey: vi.fn(async () => ({ type: 'secret', name: 'AES-GCM' })),
        encrypt: vi.fn(async (algorithm, key, data) => {
            // Return a mock buffer (concat "encrypted" to data)
            // We need to return an ArrayBuffer
            const str = new TextDecoder().decode(data);
            return new TextEncoder().encode('encrypted-' + str).buffer;
        }),
        decrypt: vi.fn(async (algorithm, key, data) => {
            // Remove "encrypted-" prefix
            const str = new TextDecoder().decode(data);
            if (str.startsWith('encrypted-')) {
                return new TextEncoder().encode(str.replace('encrypted-', '')).buffer;
            }
            throw new Error('Decryption failed');
        }),
    },
    getRandomValues: vi.fn((buffer) => {
        // Fill with random-ish values
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] = Math.floor(Math.random() * 256);
        }
        return buffer;
    })
};

// Force apply mock using Vitest stubGlobal for better compatibility
vi.stubGlobal('crypto', mockCrypto);

Object.defineProperty(global.window, 'crypto', {
    value: mockCrypto,
    writable: true,
    configurable: true,
});
