import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromeStorageAdapter } from './chromeStorageAdapter';

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
        it('should save data directly to chrome.storage.local without encryption', async () => {
            const data = { foo: 'bar' };

            // Mock set to automatically call the callback
            global.chrome.storage.local.set.mockImplementation((items, callback) => {
                if (callback) callback();
            });

            await chromeStorageAdapter.setItem('test-key', data);

            // Data should be stored directly without encryption
            expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
                { 'test-key': data },
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
        it('should retrieve data directly from chrome.storage.local without decryption', async () => {
            const storedData = { foo: 'bar' };

            // Mock get implementation
            global.chrome.storage.local.get.mockImplementation((keys, callback) => {
                const key = keys[0];
                callback({ [key]: storedData });
            });

            const result = await chromeStorageAdapter.getItem('test-key');

            expect(global.chrome.storage.local.get).toHaveBeenCalledWith(['test-key'], expect.any(Function));
            expect(result).toEqual(storedData);
        });

        it('should return null if data does not exist', async () => {
            global.chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            const result = await chromeStorageAdapter.getItem('missing-key');

            expect(result).toBeNull();
        });

        it('should fallback to localStorage if chrome is undefined', async () => {
            delete global.chrome;
            const data = { foo: 'bar' };
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(data));

            const result = await chromeStorageAdapter.getItem('test-key');

            expect(result).toEqual(data);
        });
    });
});
