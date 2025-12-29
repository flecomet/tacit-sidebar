import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromeStorageAdapter } from './chromeStorageAdapter';
import * as encryption from '../utils/encryption';

// Mock encryption module
vi.mock('../utils/encryption', () => ({
    encryptData: vi.fn(),
    decryptData: vi.fn()
}));

describe('chromeStorageAdapter', () => {
    beforeEach(() => {
        // Mock chrome global
        global.chrome = {
            storage: {
                local: {
                    get: vi.fn(),
                    set: vi.fn(),
                    remove: vi.fn()
                }
            }
        };
        // Reset mocks
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete global.chrome;
    });

    describe('setItem', () => {
        it('should encrypt data before saving to chrome.storage.local', async () => {
            const data = { foo: 'bar' };
            const encryptedData = '{"iv":[], "data":[]}';

            encryption.encryptData.mockResolvedValue(encryptedData);

            // Mock set to automatically call the callback
            global.chrome.storage.local.set.mockImplementation((items, callback) => {
                if (callback) callback();
            });

            await chromeStorageAdapter.setItem('test-key', data);

            expect(encryption.encryptData).toHaveBeenCalledWith(data);
            expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
                { 'test-key': encryptedData },
                expect.any(Function)
            );
        });

        it('should fallback to localStorage if chrome is undefined', async () => {
            delete global.chrome;
            const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

            const data = { foo: 'bar' };
            await chromeStorageAdapter.setItem('test-key', data);

            expect(setItemSpy).toHaveBeenCalledWith('test-key', JSON.stringify(data));
        });
    });

    describe('getItem', () => {
        it('should decrypt data retrieved from chrome.storage.local', async () => {
            const encryptedData = '{"iv":[], "data":[]}';
            const decryptedData = { foo: 'bar' };

            // Mock get implementation
            global.chrome.storage.local.get.mockImplementation((keys, callback) => {
                const key = keys[0];
                callback({ [key]: encryptedData });
            });

            encryption.decryptData.mockResolvedValue(decryptedData);

            const result = await chromeStorageAdapter.getItem('test-key');

            expect(global.chrome.storage.local.get).toHaveBeenCalledWith(['test-key'], expect.any(Function));
            expect(encryption.decryptData).toHaveBeenCalledWith(encryptedData);
            expect(result).toEqual(decryptedData);
        });

        it('should return null if data does not exist', async () => {
            global.chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            const result = await chromeStorageAdapter.getItem('missing-key');

            expect(result).toBeNull();
            expect(encryption.decryptData).not.toHaveBeenCalled();
        });

        it('should fallback to localStorage if chrome is undefined', async () => {
            delete global.chrome;
            const data = { foo: 'bar' };
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(data));

            const result = await chromeStorageAdapter.getItem('test-key');

            // Fallback logic does NOT use decryption
            expect(result).toEqual(data);
        });
    });
});
